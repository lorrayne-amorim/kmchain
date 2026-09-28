// Guarda, fora da blockchain, o que ela nunca deveria expor e o que nao
// precisa estar la: identificacao completa do veiculo, placa, UF de registro,
// proprietario (todos DATADOS) e QUEM, de fato, fez cada registro.
//
// O navegador so informa QUAL transacao acabou de confirmar e os dados
// privados. Todo o resto e conferido aqui, na propria rede: a transacao
// existe e deu certo, foi para o contrato do KmChain, saiu da carteira
// vinculada a esta conta e o evento dela corresponde ao chassi informado.
// Tipo, quilometragem, modelo e ano vem do evento; no cadastro, o servidor
// ainda confere que o evento tem exatamente o modelo e o ano validados.
//
// Idempotente: reenviar a mesma transacao nao cria um segundo registro, o
// que permite tentar de novo quando a gravacao privada falha depois de a
// transacao ja ter sido confirmada.
import { bd } from "../_db.js";
import { validarCadastro } from "../_cadastro.js";
import { CREDENCIADAS, chaveDoChassi, enderecoContrato, exigirContaComPapel, interfaceContrato, naRede, provedor } from "../_chain.js";
import { ErroHttp, exigirMetodo, responderErro } from "../_http.js";
import { chassiValido, normalizarChassi, soDigitos } from "../../src/lib/validar.js";
import { limparNome, problemaDaObservacao, problemasDoProprietario } from "../../src/lib/veiculo.js";

// Ordem do enum TipoEvento do contrato.
const TIPOS = ["Cadastro", "Vistoria", "Revisão", "Transferência", "Sinistro", "Correção"];
const ESPERA_RECIBO_MS = 8000;

// Le o que a transacao realmente fez no contrato.
function eventoDaTransacao(recibo) {
    const contrato = enderecoContrato();
    let cadastro = null, leitura = null, correcao = null;
    for (const log of recibo.logs) {
        if (log.address.toLowerCase() !== contrato) continue;
        let evento;
        try {
            evento = interfaceContrato.parseLog(log);
        } catch {
            continue;
        }
        if (evento?.name === "VeiculoCadastrado") cadastro = evento.args;
        if (evento?.name === "LeituraRegistrada") leitura = evento.args;
        if (evento?.name === "LeituraCorrigida") correcao = evento.args;
    }
    if (cadastro && leitura) {
        return { tipo: "Cadastro", chassiHash: cadastro.chassiHash, km: leitura.quilometragem, modelo: cadastro.modelo, ano: Number(cadastro.ano) };
    }
    if (leitura) return { tipo: TIPOS[Number(leitura.tipo)], chassiHash: leitura.chassiHash, km: leitura.quilometragem };
    if (correcao) return { tipo: "Correção", chassiHash: correcao.chassiHash, km: correcao.kmCorreta };
    return null;
}

async function transacaoConferida(txHash, carteira, chassi) {
    const rede = provedor();
    const recibo = await naRede(rede.waitForTransaction(txHash, 1, ESPERA_RECIBO_MS).catch((erro) => {
        if (erro?.code === "TIMEOUT") return null;
        throw erro;
    }));
    if (!recibo) {
        throw new ErroHttp(409, "transacao_pendente", "A transação ainda não foi confirmada na rede. Tente novamente em instantes.");
    }
    if (recibo.status !== 1) throw new ErroHttp(422, "transacao_falhou", "A transação não foi concluída na rede.");
    if (recibo.to?.toLowerCase() !== enderecoContrato()) {
        throw new ErroHttp(422, "contrato_diferente", "A transação não é do contrato do KmChain.");
    }
    if (recibo.from.toLowerCase() !== carteira) {
        throw new ErroHttp(403, "transacao_de_outra_carteira", "A transação não foi assinada pela carteira vinculada à sua conta.");
    }
    const evento = eventoDaTransacao(recibo);
    if (!evento) throw new ErroHttp(422, "sem_evento", "A transação não registrou leitura nem cadastro.");
    if (evento.chassiHash !== chaveDoChassi(chassi)) {
        throw new ErroHttp(422, "chassi_nao_confere", "O chassi informado não corresponde ao da transação.");
    }
    const bloco = await naRede(rede.getBlock(recibo.blockNumber));
    return { evento, registradoEm: bloco.timestamp };
}

// Cadastro: tudo numa instrucao so (CTEs), para nao sobrar veiculo sem placa
// ou registro sem veiculo se algo falhar no meio.
async function gravarCadastro(dados, evento, contexto) {
    const { usuario, carteira, txHash, registradoEm } = contexto;
    if (evento.modelo !== dados.emCadeia.modelo || evento.ano !== dados.emCadeia.ano || evento.km.toString() !== dados.kmInicial) {
        throw new ErroHttp(422, "dados_nao_conferem", "Modelo, ano ou quilometragem gravados em cadeia não conferem com o cadastro enviado.");
    }
    // As informacoes datadas valem a partir do registro em cadeia.
    return bd(
        `WITH registro AS (
            INSERT INTO registros_privados
                (chassi, modelo, ano, tipo_evento, quilometragem, observada_em, usuario_id,
                 usuario_nome, usuario_email, carteira, tx_hash, registrado_em_cadeia)
            VALUES ($1, $2, $3, 'Cadastro', $4, $5, $6, $7, $8, $9, $10, to_timestamp($11))
            RETURNING id
         ), veiculo AS (
            INSERT INTO veiculos (chassi, chave, marca_id, marca_nome, modelo, ano_fabricacao, ano_modelo, cadastro_tx, cadastrado_por)
            VALUES ($1, $12, $13, $14, $15, $16, $3, $10, $6)
            RETURNING chassi
         ), placa AS (
            INSERT INTO veiculo_placas (chassi, placa, vigente_desde, origem, tx_hash, registrado_por)
            VALUES ($1, $17, to_timestamp($11), 'cadastro', $10, $6)
         ), uf AS (
            INSERT INTO veiculo_ufs (chassi, uf, vigente_desde, origem, tx_hash, registrado_por)
            VALUES ($1, $18, to_timestamp($11), 'cadastro', $10, $6)
         ), dono AS (
            INSERT INTO veiculo_proprietarios (chassi, nome, cpf, vigente_desde, origem, tx_hash, registrado_por)
            VALUES ($1, $19, $20, to_timestamp($11), 'cadastro', $10, $6)
         )
         SELECT id FROM registro`,
        [
            dados.chassi, dados.emCadeia.modelo, dados.anoModelo, dados.kmInicial, dados.observadaEm,
            usuario.id, usuario.nome, usuario.email, carteira, txHash, registradoEm,
            dados.chave, dados.marca.id, dados.marca.nome, dados.modelo, dados.anoFabricacao,
            dados.placa, dados.uf, dados.nomeProprietario, dados.cpfProprietario
        ]
    );
}

async function gravarLeitura(corpo, chassi, evento, contexto) {
    const { usuario, carteira, txHash, registradoEm } = contexto;
    const correcao = evento.tipo === "Correção";

    // A correcao diz o que o hodometro marcava na leitura corrigida: nao ha
    // observacao nova. As demais leituras exigem a data da observacao,
    // conferida contra a data do bloco (nao pode ser depois do registro).
    let observadaEm = null;
    if (!correcao) {
        const problema = problemaDaObservacao(corpo.observadaEm, registradoEm * 1000);
        if (problema) throw new ErroHttp(400, "observacao_invalida", problema, { campos: { observadaEm: problema } });
        observadaEm = new Date(corpo.observadaEm);
    }

    const transferencia = evento.tipo === "Transferência";
    const temProprietario = Boolean(corpo.cpfProprietario || corpo.nomeProprietario);
    if (corpo.placa || corpo.uf) {
        throw new ErroHttp(400, "dados_nao_permitidos", "Placa e UF mudam por alteração cadastral, não por leitura.");
    }
    if (temProprietario && !transferencia) {
        throw new ErroHttp(400, "dados_nao_permitidos", "Dados do proprietário só são registrados em cadastro ou transferência.");
    }
    if (transferencia) {
        const erros = problemasDoProprietario(corpo.nomeProprietario, corpo.cpfProprietario);
        if (erros.cpfProprietario) throw new ErroHttp(400, "cpf_invalido", "CPF inválido.", { campos: erros });
        if (erros.nomeProprietario) throw new ErroHttp(400, "nome_invalido", "Informe o nome do proprietário.", { campos: erros });
    }

    // Na transferencia, o novo proprietario passa a valer na data da
    // observacao (a vistoria da transferencia); o anterior continua na tabela.
    return bd(
        `WITH registro AS (
            INSERT INTO registros_privados
                (chassi, tipo_evento, quilometragem, observada_em, usuario_id, usuario_nome,
                 usuario_email, carteira, tx_hash, registrado_em_cadeia)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10))
            RETURNING id
         ), dono AS (
            INSERT INTO veiculo_proprietarios (chassi, nome, cpf, vigente_desde, origem, tx_hash, registrado_por)
            SELECT $1, $11, $12, $4, 'transferencia', $9, $5 WHERE $13::boolean
         )
         SELECT id FROM registro`,
        [
            chassi, evento.tipo, evento.km.toString(), observadaEm, usuario.id, usuario.nome,
            usuario.email, carteira, txHash, registradoEm,
            transferencia ? limparNome(corpo.nomeProprietario) : null,
            transferencia ? soDigitos(corpo.cpfProprietario) : null,
            transferencia
        ]
    );
}

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const { usuario, carteira } = await exigirContaComPapel(req, CREDENCIADAS);
        const corpo = req.body ?? {};

        const { txHash } = corpo;
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
            throw new ErroHttp(400, "transacao_invalida", "Identificador de transação inválido.");
        }
        const chassi = normalizarChassi(corpo.chassi);
        if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

        // Reenvio da mesma transacao: responde sem repetir as verificacoes.
        const existente = await bd("SELECT usuario_id FROM registros_privados WHERE lower(tx_hash) = lower($1)", [txHash]);
        if (existente.rowCount > 0) {
            if (existente.rows[0].usuario_id !== usuario.id) {
                throw new ErroHttp(409, "transacao_ja_usada", "Esta transação já tem registro privado de outra conta.");
            }
            return res.status(200).json({ ok: true, jaRegistrado: true });
        }

        const { evento, registradoEm } = await transacaoConferida(txHash, carteira, chassi);
        const contexto = { usuario, carteira, txHash: txHash.toLowerCase(), registradoEm };

        try {
            if (evento.tipo === "Cadastro") {
                const dados = await validarCadastro({ ...corpo, chassi }, new Date(registradoEm * 1000));
                await gravarCadastro(dados, evento, contexto);
            } else {
                await gravarLeitura(corpo, chassi, evento, contexto);
            }
        } catch (erro) {
            // Dois envios simultaneos da mesma transacao: o segundo perde a
            // corrida no indice unico, e isso e o mesmo que "ja registrado".
            if (erro?.code === "23505") return res.status(200).json({ ok: true, jaRegistrado: true });
            throw erro;
        }
        res.status(201).json({ ok: true, jaRegistrado: false });
    } catch (erro) {
        responderErro(res, erro, "privado/registrar");
    }
}
