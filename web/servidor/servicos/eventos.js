// Eventos com quilometragem.
//
// A transacao e assinada no navegador, pela carteira de quem registra; o
// contrato decide se ela pode (vinculo ativo, organizacao ativa, tipo de
// evento permitido). O servidor entra em dois momentos:
//   - ANTES da assinatura, conferindo permissao e dados complementares, para
//     a pessoa nao gravar em cadeia algo que depois seria recusado aqui;
//   - DEPOIS, guardando o complemento off-chain (quem registrou, proprietario
//     numa transferencia, seguradora contratante). Nessa hora nada do que o
//     navegador diz sobre o evento e aceito: quilometragem, tipo, data,
//     municipio, organizacao e responsavel sao lidos do proprio contrato.
//
// Idempotente: reenviar a mesma transacao nao cria um segundo registro.
import { chaveDoChassi, contrato, naRede, transacaoConfirmada } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import * as eventos from "../repositorios/eventos.js";
import { buscarOrganizacao, buscarOrganizacaoPorIdCadeia } from "../repositorios/organizacoes.js";
import { ehDetran, validarOrganizacaoPodeRegistrarEvento } from "./autorizacao.js";
import { validarCadastro } from "./cadastroVeiculo.js";
import { verificarLocalizacaoDoRegistro } from "./localizacao.js";
import { TIPO_EVENTO, rotuloDoEvento, SEM_REFERENCIA } from "../../src/lib/eventos.js";
import { municipioValido } from "../../src/lib/municipios.js";
import { chassiValido, normalizarChassi, soDigitos } from "../../src/lib/validar.js";
import { limparNome, problemaDaDataDoEvento, problemasDoProprietario } from "../../src/lib/veiculo.js";

const JUSTIFICATIVA_MINIMA = 10;

function chassiDoCorpo(corpo) {
    const chassi = normalizarChassi(corpo?.chassi);
    if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");
    return chassi;
}

// Dados que so alguns tipos de evento exigem e que ficam fora da blockchain:
// novo proprietario (transferencia de propriedade) e seguradora contratante
// (vistoria feita por empresa de vistoria a pedido de uma seguradora).
async function validarComplementoDoEvento(tipo, corpo) {
    if (corpo.placa || corpo.uf) {
        throw new ErroHttp(400, "dados_nao_permitidos", "Placa e UF mudam por alteração cadastral, não por evento.");
    }
    const complemento = { proprietario: null, seguradoraId: null };

    const temProprietario = Boolean(corpo.cpfProprietario || corpo.nomeProprietario);
    if (tipo === TIPO_EVENTO.TRANSFERENCIA_PROPRIEDADE) {
        const erros = problemasDoProprietario(corpo.nomeProprietario, corpo.cpfProprietario);
        if (Object.keys(erros).length > 0) {
            throw new ErroHttp(400, "proprietario_invalido", "Informe o nome e o CPF do novo proprietário.", { campos: erros });
        }
        complemento.proprietario = { nome: limparNome(corpo.nomeProprietario), cpf: soDigitos(corpo.cpfProprietario) };
    } else if (temProprietario) {
        throw new ErroHttp(400, "dados_nao_permitidos", "Dados do proprietário só são registrados no cadastro ou na transferência de propriedade.");
    }

    if (tipo === TIPO_EVENTO.VISTORIA_SEGURADORA) {
        const seguradora = await buscarOrganizacao(Number(corpo.seguradoraId) || 0);
        if (!seguradora || seguradora.tipo !== "SEGURADORA" || seguradora.id_cadeia === null) {
            throw new ErroHttp(400, "seguradora_invalida", "Escolha a seguradora que solicitou a vistoria.", { campos: { seguradoraId: "Escolha uma seguradora credenciada." } });
        }
        complemento.seguradoraId = seguradora.id;
    } else if (corpo.seguradoraId) {
        throw new ErroHttp(400, "dados_nao_permitidos", "A seguradora contratante só se aplica à vistoria a pedido de seguradora.");
    }
    return complemento;
}

// Confere, antes da assinatura, se quem pede pode registrar o evento e se
// os dados estao em ordem.
export async function conferirEvento(corpo, acesso) {
    const dados = corpo ?? {};
    const tipo = Number(dados.tipo);
    validarOrganizacaoPodeRegistrarEvento(acesso.vinculo, tipo);
    chassiDoCorpo(dados);

    const erros = {};
    if (!/^\d+$/.test(String(dados.km ?? ""))) erros.km = "Informe a quilometragem.";
    const data = problemaDaDataDoEvento(dados.dataEvento);
    if (data) erros.dataEvento = data;
    if (!municipioValido(dados.municipio)) erros.municipio = "Escolha a UF e a cidade do evento.";
    if (Object.keys(erros).length > 0) {
        throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });
    }
    await validarComplementoDoEvento(tipo, dados);
    // Recusa aqui, antes da assinatura, o registro sem localizacao verificada
    // e sem justificativa. A situacao e decidida pelo servidor.
    const { situacao, distancia } = verificarLocalizacaoDoRegistro(dados, acesso.organizacao);
    return { ok: true, localizacao: { situacao, distancia } };
}

// Le do contrato o evento que a transacao registrou para este veiculo.
async function eventoDaTransacao(txHash, chassi) {
    const { eventos: emitidos, registradoEm, txHash: tx } = await transacaoConfirmada(txHash);
    const chave = chaveDoChassi(chassi);
    const doVeiculo = emitidos.filter((e) => e.name === "EventoRegistrado" && e.args.chave === chave);
    if (doVeiculo.length === 0) {
        throw new ErroHttp(422, "chassi_nao_confere", "O chassi informado não corresponde ao da transação.");
    }
    // Uma transacao em lote pode registrar varios eventos; o complemento tem
    // de corresponder a exatamente um.
    if (doVeiculo.length > 1) {
        throw new ErroHttp(422, "varios_registros", "A transação tem mais de um evento deste veículo; não é possível saber a qual o complemento se refere.");
    }
    const indice = Number(doVeiculo[0].args.indice);
    const emCadeia = await naRede(contrato().getEvento(chave, indice));
    return { indice, emCadeia, registradoEm, txHash: tx };
}

// Guarda o complemento off-chain de um evento ja confirmado em cadeia.
// `solicitacao` e a solicitacao de correcao que o evento efetiva, se houver.
export async function registrarEvento(corpo, acesso, { solicitacao = null } = {}) {
    const dados = corpo ?? {};
    const chassi = chassiDoCorpo(dados);

    // Reenvio da mesma transacao: responde sem repetir as verificacoes.
    const existente = await eventos.buscarEventoPorTransacao(dados.txHash);
    if (existente) {
        if (existente.usuario_id !== acesso.usuario.id) {
            throw new ErroHttp(409, "transacao_ja_usada", "Esta transação já foi registrada por outra conta.");
        }
        return { ok: true, jaRegistrado: true, indice: existente.indice };
    }

    const { indice, emCadeia, registradoEm, txHash } = await eventoDaTransacao(dados.txHash, chassi);
    // A autoria vem do contrato (a carteira que ele viu chamar), e nao de
    // quem enviou a transacao: com conta inteligente ou transacao
    // patrocinada, o envelope sai de outro endereco.
    if (emCadeia.responsavel.toLowerCase() !== acesso.carteira) {
        throw new ErroHttp(403, "transacao_de_outra_carteira", "O evento não foi registrado pela carteira vinculada à sua conta.");
    }
    const organizacao = await buscarOrganizacaoPorIdCadeia(Number(emCadeia.organizacao));
    if (!organizacao) throw new ErroHttp(409, "organizacao_sem_cadastro", "A organização do evento não tem cadastro no KMChain.");

    const tipo = Number(emCadeia.tipo);
    const referencia = Number(emCadeia.referencia);
    const evento = {
        chassi,
        tipoCodigo: tipo,
        tipoRotulo: rotuloDoEvento(tipo),
        km: emCadeia.km.toString(),
        dataEvento: new Date(Number(emCadeia.dataEvento) * 1000),
        registradoEm,
        municipio: Number(emCadeia.municipio),
        organizacaoId: organizacao.id,
        usuario: acesso.usuario,
        carteira: acesso.carteira,
        txHash,
        indice,
        referencia: referencia === SEM_REFERENCIA ? null : referencia,
        hashDocumento: /^0x0+$/.test(emCadeia.hashDocumento) ? null : emCadeia.hashDocumento
    };

    try {
        if (tipo === TIPO_EVENTO.CADASTRO_INICIAL) await gravarCadastro(dados, evento, registradoEm);
        else if (tipo === TIPO_EVENTO.CORRECAO) await gravarCorrecao(dados, evento, solicitacao);
        else await gravarEventoComum(dados, evento, organizacao, registradoEm);
    } catch (erro) {
        // Dois envios simultaneos da mesma transacao: o segundo perde a
        // corrida no indice unico, e isso e o mesmo que "ja registrado".
        if (erro?.code === "23505") return { ok: true, jaRegistrado: true, indice };
        throw erro;
    }
    return { ok: true, jaRegistrado: false, indice };
}

async function gravarCadastro(dados, evento, registradoEm) {
    // Quilometragem, data e municipio valem os do contrato; o que se valida
    // do corpo e a identificacao do veiculo.
    const veiculo = await validarCadastro(
        { ...dados, chassi: evento.chassi, kmInicial: evento.km, dataEvento: evento.dataEvento.toISOString(), municipio: evento.municipio },
        new Date(registradoEm * 1000)
    );
    return eventos.inserirCadastro(evento, veiculo);
}

async function gravarCorrecao(dados, evento, solicitacao) {
    if (solicitacao) {
        if (evento.referencia !== solicitacao.indice_original || evento.km !== String(solicitacao.km_solicitada)) {
            throw new ErroHttp(422, "correcao_nao_confere", "A correção registrada em cadeia não corresponde à solicitação.");
        }
        return eventos.inserirEvento({ ...evento, justificativa: solicitacao.justificativa });
    }
    // Correcao de oficio do DETRAN: a justificativa e obrigatoria.
    const justificativa = limparNome(dados.justificativa);
    if (justificativa.length < JUSTIFICATIVA_MINIMA) {
        throw new ErroHttp(400, "justificativa_invalida", "Informe a justificativa da correção.", { campos: { justificativa: "Descreva o motivo da correção." } });
    }
    return eventos.inserirEvento({ ...evento, justificativa });
}

async function gravarEventoComum(dados, evento, organizacao, registradoEm) {
    const { proprietario, seguradoraId } = await validarComplementoDoEvento(evento.tipoCodigo, dados);
    // A localizacao e conferida contra a organizacao gravada no evento, com
    // a data do bloco como referencia para a idade da captura.
    const localizacao = verificarLocalizacaoDoRegistro(dados, organizacao, registradoEm * 1000);
    if (proprietario) return eventos.inserirEventoComProprietario({ ...evento, localizacao }, proprietario);
    return eventos.inserirEvento({ ...evento, seguradoraId, localizacao });
}

// Eventos da organizacao de quem pede, com a situacao da localizacao de
// cada um. O DETRAN ve os de todas (ou de uma organizacao escolhida), com
// as coordenadas capturadas, a distancia e a justificativa, e pode filtrar
// os registros com localizacao divergente ou nao verificada.
export async function listarEventosDaOrganizacao(acesso, { organizacaoId, localizacao } = {}) {
    if (!ehDetran(acesso)) return eventos.listarEventos(acesso.organizacao.id);
    return eventos.listarEventos(organizacaoId ? Number(organizacaoId) : null, { comLocalizacao: true, filtro: localizacao });
}
