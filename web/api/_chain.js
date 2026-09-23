// Confere permissao direto na blockchain, a partir de uma mensagem assinada
// pela carteira - o mesmo padrao usado em api/documento.js. Nunca existe uma
// lista paralela de quem pode o que: a fonte da verdade e sempre o contrato.
import { verifyMessage, JsonRpcProvider, Contract } from "ethers";
import abi from "../src/lib/KmChainRegistry.abi.json";
import { endereco } from "../src/lib/endereco.json";

const JANELA_MS = 2 * 60 * 1000;

function contrato() {
    return new Contract(endereco, abi, new JsonRpcProvider(process.env.RPC_URL));
}

// Verifica a assinatura de `mensagem` e devolve o endereco que assinou se,
// e somente se, ele tiver ao menos um dos papeis em `nomesDePapel`.
// Devolve null caso contrario (assinatura invalida, expirada ou sem papel).
export async function verificarPapel(mensagem, emitidoEm, assinatura, nomesDePapel) {
    if (Math.abs(Date.now() - Number(emitidoEm)) > JANELA_MS) return null;

    let quemAssinou;
    try {
        quemAssinou = verifyMessage(mensagem, assinatura);
    } catch {
        return null;
    }

    const c = contrato();
    for (const nome of nomesDePapel) {
        const papel = await c[nome]();
        if (await c.hasRole(papel, quemAssinou)) return quemAssinou;
    }
    return null;
}
