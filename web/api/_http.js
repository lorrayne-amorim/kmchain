// Respostas de erro das rotas /api. Regra: o navegador recebe um codigo
// estavel e uma frase que a pessoa entende; detalhe interno (mensagem do
// banco, do RPC, stack) fica so no log do servidor, e sem dados pessoais.

// Erro esperado, com status e codigo definidos pela propria rota.
// `extra` vai junto na resposta (ex.: { campos } com o erro de cada campo).
export class ErroHttp extends Error {
    constructor(status, codigo, mensagem, extra = {}) {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
        this.extra = extra;
    }
}

// Falha de infraestrutura (RPC, banco, IPFS fora do ar): 503, tente de novo.
export const indisponivel = (codigo, mensagem = "Serviço temporariamente indisponível. Tente novamente em instantes.") =>
    new ErroHttp(503, codigo, mensagem);

const CODIGOS_DE_REDE = new Set([
    "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN", "EPIPE",
    "NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"
]);

export function ehFalhaDeRede(erro) {
    for (let e = erro; e; e = e.cause) {
        if (CODIGOS_DE_REDE.has(e.code)) return true;
        // Classes 08 (conexao) e 57P (servidor saindo) do Postgres.
        if (typeof e.code === "string" && /^(08|57P)/.test(e.code)) return true;
        if (e instanceof TypeError && e.message === "fetch failed") return true;
    }
    return false;
}

// `texto: true` para respostas abertas direto numa aba (link de documento).
export function responderErro(res, erro, rota, { texto = false } = {}) {
    const enviar = (status, corpo) => {
        if (!texto) return res.status(status).json(corpo);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        return res.status(status).send(corpo.erro);
    };

    if (erro instanceof ErroHttp) {
        if (erro.status >= 500) console.error(`[${rota}] ${erro.codigo}`);
        return enviar(erro.status, { erro: erro.message, codigo: erro.codigo, ...erro.extra });
    }

    // Nunca a mensagem do erro: ela pode trazer valores de consulta SQL.
    const origem = String(erro?.stack ?? "").split("\n").find((l) => /[\\/]api[\\/]/.test(l))?.trim() ?? "";
    if (ehFalhaDeRede(erro)) {
        console.error(`[${rota}] indisponivel ${erro?.code ?? erro?.name ?? ""} ${origem}`);
        return enviar(503, {
            erro: "Serviço temporariamente indisponível. Tente novamente em instantes.",
            codigo: "indisponivel"
        });
    }
    console.error(`[${rota}] falha interna ${erro?.name ?? ""} ${erro?.code ?? ""} ${origem}`);
    return enviar(500, { erro: "Não foi possível concluir a operação.", codigo: "interno" });
}

export function exigirMetodo(req, metodos) {
    if (!metodos.includes(req.method)) throw new ErroHttp(405, "metodo", `Use ${metodos.join(" ou ")}.`);
}
