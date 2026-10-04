// Solicitacoes de correcao de quilometragem.
//
// Oficinas, empresas de vistoria e seguradoras apontam um evento que
// consideram errado e propoem o valor correto, com justificativa e
// evidencia. O DETRAN decide:
//   - REJEITADA: fica so no banco, como historico administrativo;
//   - APROVADA: o DETRAN assina no contrato um NOVO evento de correcao, que
//     referencia o original. O evento original nunca e alterado.
import { chaveDoChassi, contrato, naRede } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import * as correcoes from "../repositorios/correcoes.js";
import { buscarEvento } from "../repositorios/eventos.js";
import { ACOES, registrarAuditoria } from "./auditoria.js";
import { ehDetran } from "./autorizacao.js";
import { registrarEvento } from "./eventos.js";
import { eventoPorCodigo } from "../../src/lib/eventos.js";
import { chassiValido, normalizarChassi } from "../../src/lib/validar.js";
import { limparNome } from "../../src/lib/veiculo.js";

const TEXTO_MINIMO = 10;
const TEXTO_MAXIMO = 1000;

const inteiro = (valor) => (/^\d+$/.test(String(valor ?? "")) ? Number(valor) : null);

// Evento do contrato pelo indice, ou null se o veiculo nao tiver esse evento.
async function eventoEmCadeia(chave, indice) {
    const historico = await naRede(contrato().getHistorico(chave));
    return indice < historico.length ? historico[indice] : null;
}

// Cria uma solicitacao de correcao sem alterar o evento original registrado na blockchain.
export async function criarSolicitacaoDeCorrecao(corpo, acesso) {
    const d = corpo ?? {};
    const chassi = normalizarChassi(d.chassi);
    if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");
    const chave = chaveDoChassi(chassi);

    const indice = inteiro(d.indice);
    const original = indice === null ? null : await eventoEmCadeia(chave, indice);
    if (!original) throw new ErroHttp(404, "evento_nao_encontrado", "O registro questionado não existe no histórico deste veículo.");
    if ((await naRede(contrato().correcaoDe(chave, indice))) !== 0n) {
        throw new ErroHttp(409, "evento_ja_corrigido", "Este registro já foi corrigido.");
    }

    const erros = {};
    const kmSolicitada = inteiro(d.kmSolicitada);
    if (kmSolicitada === null) erros.kmSolicitada = "Informe a quilometragem considerada correta.";
    else if (BigInt(kmSolicitada) === original.km) erros.kmSolicitada = "A quilometragem proposta é igual à registrada.";
    const justificativa = limparNome(d.justificativa);
    if (justificativa.length < TEXTO_MINIMO || justificativa.length > TEXTO_MAXIMO) {
        erros.justificativa = "Descreva o erro encontrado (de 10 a 1000 caracteres).";
    }

    // Evidencia: um documento enviado por quem solicita e/ou uma vistoria ja
    // registrada no historico do mesmo veiculo.
    const hashEvidencia = d.hashEvidencia || null;
    const vistoriaIndice = d.vistoriaIndice === undefined || d.vistoriaIndice === null || d.vistoriaIndice === "" ? null : inteiro(d.vistoriaIndice);
    if (!hashEvidencia && vistoriaIndice === null) {
        erros.evidencia = "Anexe um documento ou indique uma vistoria registrada como evidência.";
    }
    if (hashEvidencia && !(await correcoes.documentoEnviadoPor(hashEvidencia, acesso.usuario.id))) {
        erros.evidencia = "O documento de evidência precisa ser enviado pela sua conta.";
    }
    if (vistoriaIndice !== null) {
        const vistoria = vistoriaIndice === indice ? null : await eventoEmCadeia(chave, vistoriaIndice);
        if (!vistoria || !eventoPorCodigo(vistoria.tipo)?.vistoria) {
            erros.vistoriaIndice = "Escolha uma vistoria registrada no histórico deste veículo.";
        }
    }
    if (Object.keys(erros).length > 0) {
        throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });
    }

    let solicitacao;
    try {
        solicitacao = await correcoes.inserirSolicitacao({
            chassi, indiceOriginal: indice, kmOriginal: original.km.toString(), kmSolicitada, justificativa,
            organizacaoId: acesso.organizacao.id, usuarioId: acesso.usuario.id, hashEvidencia, vistoriaIndice
        });
    } catch (erro) {
        if (erro?.code === "23505") {
            throw new ErroHttp(409, "solicitacao_em_analise", "Já existe uma solicitação em análise para este registro.");
        }
        throw erro;
    }
    await registrarAuditoria(ACOES.CORRECAO_SOLICITADA, acesso, { tipo: "solicitacao_correcao", id: solicitacao.id }, {
        chassi, indice, kmOriginal: Number(original.km), kmSolicitada
    });
    return solicitacao;
}

// O DETRAN ve todas as solicitacoes; as demais organizacoes, so as proprias.
export function listarSolicitacoes(acesso, situacao) {
    return correcoes.listarSolicitacoes(ehDetran(acesso) ? null : acesso.organizacao.id, situacao);
}

async function solicitacaoAcessivel(id, acesso) {
    const solicitacao = await correcoes.buscarSolicitacao(Number(id) || 0);
    if (!solicitacao || (!ehDetran(acesso) && solicitacao.organizacao_id !== acesso.organizacao.id)) {
        throw new ErroHttp(404, "solicitacao_nao_encontrada", "Solicitação não encontrada.");
    }
    return solicitacao;
}

// Tudo o que o DETRAN precisa para analisar: a solicitacao, o evento
// questionado e a vistoria indicada como evidencia, com organizacao,
// responsavel, data e local de cada um.
export async function detalharSolicitacao(id, acesso) {
    const solicitacao = await solicitacaoAcessivel(id, acesso);
    const [original, vistoria] = await Promise.all([
        buscarEvento(solicitacao.chassi, solicitacao.indice_original),
        solicitacao.vistoria_indice === null ? null : buscarEvento(solicitacao.chassi, solicitacao.vistoria_indice)
    ]);
    return { solicitacao, original, vistoria };
}

function motivoDaDecisao(corpo) {
    const motivo = limparNome(corpo?.motivo);
    if (motivo.length < TEXTO_MINIMO || motivo.length > TEXTO_MAXIMO) {
        throw new ErroHttp(400, "motivo_invalido", "Informe o motivo da decisão.", { campos: { motivo: "Descreva o motivo da decisão (de 10 a 1000 caracteres)." } });
    }
    return motivo;
}

function exigirPendente(solicitacao) {
    if (solicitacao.situacao !== "PENDENTE") {
        throw new ErroHttp(409, "solicitacao_ja_decidida", "Esta solicitação já foi decidida.");
    }
}

// Rejeita a solicitacao. Nada vai para a blockchain: a decisao fica no banco.
export async function rejeitarSolicitacao(id, corpo, acesso) {
    const solicitacao = await solicitacaoAcessivel(id, acesso);
    exigirPendente(solicitacao);
    const motivo = motivoDaDecisao(corpo);
    const decidida = await correcoes.decidirSolicitacao(solicitacao.id, {
        situacao: "REJEITADA", analisadaPor: acesso.usuario.id, motivo
    });
    if (!decidida) throw new ErroHttp(409, "solicitacao_ja_decidida", "Esta solicitação já foi decidida.");
    await registrarAuditoria(ACOES.CORRECAO_REJEITADA, acesso, { tipo: "solicitacao_correcao", id: solicitacao.id }, {
        chassi: solicitacao.chassi, indice: solicitacao.indice_original
    });
    return decidida;
}

// Aprova a solicitacao depois que o DETRAN registrou a correcao em cadeia.
// O servidor confere que a transacao e a correcao DESTA solicitacao (mesmo
// evento referenciado e mesma quilometragem) antes de marcar a aprovacao.
export async function aprovarSolicitacao(id, corpo, acesso) {
    const solicitacao = await solicitacaoAcessivel(id, acesso);
    exigirPendente(solicitacao);
    const motivo = motivoDaDecisao(corpo);

    const { indice } = await registrarEvento({ chassi: solicitacao.chassi, txHash: corpo.txHash }, acesso, { solicitacao });
    // Vale tambem para o reenvio de uma transacao ja registrada: o contrato
    // tem de apontar este evento como a correcao do registro questionado.
    const chave = chaveDoChassi(solicitacao.chassi);
    const [correcaoEmCadeia, evento] = await Promise.all([
        naRede(contrato().correcaoDe(chave, solicitacao.indice_original)),
        eventoEmCadeia(chave, indice)
    ]);
    if (Number(correcaoEmCadeia) !== indice || evento.km.toString() !== String(solicitacao.km_solicitada)) {
        throw new ErroHttp(422, "correcao_nao_confere", "A correção registrada em cadeia não corresponde à solicitação.");
    }
    const decidida = await correcoes.decidirSolicitacao(solicitacao.id, {
        situacao: "APROVADA", analisadaPor: acesso.usuario.id, motivo,
        correcaoIndice: indice, correcaoTx: String(corpo.txHash).toLowerCase()
    });
    if (!decidida) throw new ErroHttp(409, "solicitacao_ja_decidida", "Esta solicitação já foi decidida.");
    await registrarAuditoria(ACOES.CORRECAO_APROVADA, acesso, { tipo: "solicitacao_correcao", id: solicitacao.id }, {
        chassi: solicitacao.chassi, indice: solicitacao.indice_original, correcaoIndice: indice,
        kmSolicitada: Number(solicitacao.km_solicitada)
    });
    return decidida;
}
