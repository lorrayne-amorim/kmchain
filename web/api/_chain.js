// Confere permissao direto na blockchain. Nunca existe uma lista paralela de
// quem pode o que: a fonte da verdade e sempre o contrato.
//
// Modelo de acesso das rotas sensiveis (duas camadas):
//   1. sessao de login valida (a PESSOA);
//   2. carteira vinculada a essa conta, com o papel exigido em cadeia (a
//      PERMISSAO). Nas leituras sensiveis, a carteira ainda assina uma
//      mensagem na hora, provando que esta nas maos de quem pede.
import { verifyMessage, JsonRpcProvider, Contract, Interface, ZeroHash, id } from "ethers";
import abi from "../src/lib/KmChainRegistry.abi.json" with { type: "json" };
import enderecoJson from "../src/lib/endereco.json" with { type: "json" };
import { JANELA_ASSINATURA_MS } from "../src/lib/mensagens.js";
import { bd } from "./_db.js";
import { ErroHttp, indisponivel, ehFalhaDeRede } from "./_http.js";
import { sessaoAtual } from "./_sessao.js";

export const enderecoContrato = () => (process.env.KMCHAIN_ENDERECO || enderecoJson.endereco).toLowerCase();
export const interfaceContrato = new Interface(abi);

// Identificadores dos papeis, calculados localmente (sao constantes do
// contrato) para nao gastar uma chamada RPC em cada um.
const ID_PAPEL = {
    admin: ZeroHash,
    detran: id("DETRAN_ROLE"),
    vistoria: id("VISTORIA_ROLE"),
    oficina: id("OFICINA_ROLE")
};
export const CREDENCIADAS = ["detran", "vistoria", "oficina"];

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
export { chaveDoChassi } from "../src/lib/chassi.js";

export async function papeisDe(endereco) {
    const c = contrato();
    const nomes = Object.keys(ID_PAPEL);
    const valores = await naRede(Promise.all(nomes.map((n) => c.hasRole(ID_PAPEL[n], endereco))));
    return Object.fromEntries(nomes.map((n, i) => [n, valores[i]]));
}

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

// Camada 1: sessao valida e a conta ainda existe no banco.
export async function exigirConta(req) {
    const sessao = sessaoAtual(req);
    if (!sessao) throw new ErroHttp(401, "sem_sessao", "Faça login para continuar.");
    const r = await bd("SELECT id, nome, email, carteira FROM usuarios WHERE id = $1", [sessao.id]);
    const usuario = r.rows[0];
    if (!usuario) throw new ErroHttp(401, "sem_sessao", "Faça login para continuar.");
    return usuario;
}

function exigirPapel(papeis, aceitos) {
    if (!aceitos.some((p) => papeis[p])) {
        throw new ErroHttp(403, "sem_papel", "A carteira vinculada à sua conta não tem a função necessária.");
    }
}

// Camadas 1 e 2, sem assinatura na hora: usado quando a acao sozinha nao
// entrega dado nenhum (ex.: enviar um comprovante).
export async function exigirContaComPapel(req, aceitos) {
    const usuario = await exigirConta(req);
    if (!usuario.carteira) {
        throw new ErroHttp(403, "carteira_nao_vinculada", "Vincule a carteira da entidade à sua conta para continuar.");
    }
    const papeis = await papeisDe(usuario.carteira);
    exigirPapel(papeis, aceitos);
    return { usuario, carteira: usuario.carteira.toLowerCase(), papeis };
}

// Camadas 1 e 2 com assinatura na hora, para leituras sensiveis. A
// mensagem e montada pela rota (com o e-mail da SESSAO), nunca aceita pronta.
export async function exigirCarteiraAssinada(req, aceitos, montarMensagem) {
    const usuario = await exigirConta(req);
    if (!usuario.carteira) {
        throw new ErroHttp(403, "carteira_nao_vinculada", "Vincule a carteira da entidade à sua conta para continuar.");
    }
    const { emitidoEm, assinatura } = req.body ?? {};
    const assinante = recuperarAssinante(montarMensagem(usuario.email, emitidoEm), emitidoEm, assinatura);
    if (assinante.toLowerCase() !== usuario.carteira.toLowerCase()) {
        throw new ErroHttp(403, "carteira_diferente", "A carteira conectada não é a vinculada à sua conta. Troque de conta na MetaMask.");
    }
    const papeis = await papeisDe(assinante);
    exigirPapel(papeis, aceitos);
    return { usuario, carteira: assinante.toLowerCase(), papeis };
}
