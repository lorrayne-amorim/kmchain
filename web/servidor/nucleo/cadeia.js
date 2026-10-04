// Acesso de leitura ao contrato. O servidor nunca assina transacoes: ele le
// o estado da blockchain para conferir o que o navegador diz ter registrado
// e para saber, direto do contrato, a que organizacao cada carteira pertence.
import { verifyMessage, JsonRpcProvider, Contract, Interface } from "ethers";
import abi from "../../src/lib/KmChainRegistryV2.abi.json" with { type: "json" };
import enderecoJson from "../../src/lib/endereco.json" with { type: "json" };
import { JANELA_ASSINATURA_MS } from "../../src/lib/mensagens.js";
import { ErroHttp, indisponivel, ehFalhaDeRede } from "./http.js";

export function enderecoContrato() {
    const endereco = process.env.KMCHAIN_ENDERECO || enderecoJson.endereco;
    if (!endereco) throw indisponivel("contrato_nao_configurado");
    return endereco.toLowerCase();
}
export const interfaceContrato = new Interface(abi);

let cache = { url: null, provedor: null };
export function provedor() {
    const url = process.env.RPC_URL;
    if (!url) throw indisponivel("rpc_nao_configurado");
    if (cache.url !== url) {
        cache.provedor?.destroy(); // senao o antigo segue tentando detectar a rede
        cache = { url, provedor: new JsonRpcProvider(url, undefined, { staticNetwork: true }) };
    }
    return cache.provedor;
}

export function encerrarProvedor() {
    cache.provedor?.destroy();
    cache = { url: null, provedor: null };
}

export const contrato = () => new Contract(enderecoContrato(), abi, provedor());

// Chamada ao no: falha de rede vira 503, nao 500 com mensagem crua.
export async function naRede(promessa) {
    try {
        return await promessa;
    } catch (erro) {
        if (ehFalhaDeRede(erro) || erro?.code === "UNKNOWN_ERROR") throw indisponivel("rpc_indisponivel");
        throw erro;
    }
}

// Mesma regra da tela e do contrato (ver src/lib/chassi.js).
export { chaveDoChassi } from "../../src/lib/chassi.js";

// Endereco que assinou `mensagem`, ou 400 se expirada ou invalida.
export function recuperarAssinante(mensagem, emitidoEm, assinatura) {
    const instante = Number(emitidoEm);
    if (!Number.isFinite(instante) || Math.abs(Date.now() - instante) > JANELA_ASSINATURA_MS) {
        throw new ErroHttp(400, "assinatura_expirada", "A assinatura expirou. Tente de novo.");
    }
    try {
        return verifyMessage(mensagem, assinatura);
    } catch {
        throw new ErroHttp(400, "assinatura_invalida", "Não foi possível validar a assinatura. Tente de novo.");
    }
}

const ESPERA_RECIBO_MS = 8000;
const INTERVALO_RECIBO_MS = 1000;

// Recibo de uma transacao confirmada com sucesso, com os eventos que o
// contrato do KmChain emitiu nela e a data do bloco.
export async function transacaoConfirmada(txHash) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash ?? "")) {
        throw new ErroHttp(400, "transacao_invalida", "Identificador de transação inválido.");
    }
    const rede = provedor();
    // O navegador so chama depois de ver a transacao confirmada, mas o no
    // usado pelo servidor pode estar um pouco atrasado: tenta por alguns segundos.
    let recibo = null;
    for (const limite = Date.now() + ESPERA_RECIBO_MS; ;) {
        recibo = await naRede(rede.getTransactionReceipt(txHash));
        if (recibo || Date.now() + INTERVALO_RECIBO_MS > limite) break;
        await new Promise((resolve) => setTimeout(resolve, INTERVALO_RECIBO_MS));
    }
    if (!recibo) {
        throw new ErroHttp(409, "transacao_pendente", "A transação ainda não foi confirmada na rede. Tente novamente em instantes.");
    }
    if (recibo.status !== 1) throw new ErroHttp(422, "transacao_falhou", "A transação não foi concluída na rede.");

    const endereco = enderecoContrato();
    const eventos = [];
    for (const log of recibo.logs) {
        if (log.address.toLowerCase() !== endereco) continue;
        try {
            const evento = interfaceContrato.parseLog(log);
            if (evento) eventos.push(evento);
        } catch {
            // log de outro formato: ignora
        }
    }
    if (eventos.length === 0) {
        throw new ErroHttp(422, "contrato_diferente", "A transação não registrou nada no contrato do KmChain.");
    }
    const bloco = await naRede(rede.getBlock(recibo.blockNumber));
    return { eventos, registradoEm: bloco.timestamp, txHash: txHash.toLowerCase() };
}
