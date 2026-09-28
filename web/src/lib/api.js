// Chamada as rotas /api com o mesmo tratamento de erro em todo o app: a
// pessoa ve o motivo real (sem login, carteira errada, sem funcao, servico
// fora do ar) em vez de uma mensagem generica unica.
import { BrowserProvider } from "ethers";

// Conta logada no painel, para as assinaturas levarem o e-mail certo.
let contaAtual = null;
export const definirContaAtual = (usuario) => { contaAtual = usuario; };

export function emailDaConta() {
    if (!contaAtual?.email) throw new Error("Faça login para continuar.");
    return contaAtual.email;
}

// `dados` e o corpo da resposta (ex.: `campos` com o erro de cada campo).
export class ErroApi extends Error {
    constructor(mensagem, status, codigo, dados = {}) {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
        this.dados = dados;
    }
}

export async function chamarApi(rota, { metodo = "POST", corpo, padrao = "Não foi possível concluir a operação." } = {}) {
    let resposta;
    try {
        resposta = await fetch(`/api/${rota}`, {
            method: metodo,
            headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: corpo === undefined ? undefined : JSON.stringify(corpo)
        });
    } catch {
        throw new ErroApi("Não foi possível falar com o servidor. Verifique sua conexão e tente novamente.", 0, "sem_conexao");
    }

    const dados = await resposta.json().catch(() => ({}));
    if (resposta.ok) return dados;

    // As rotas so devolvem em `erro` frases pensadas para a pessoa; 500 sem
    // codigo conhecido fica com a mensagem padrao da tela.
    if (resposta.status === 503) {
        throw new ErroApi("Um serviço do sistema está indisponível agora. Tente novamente em instantes.", 503, dados.codigo);
    }
    if (resposta.status === 413) throw new ErroApi("O arquivo é grande demais. Envie até 3 MB.", 413, "arquivo_grande");
    if (resposta.status >= 500 || !dados.erro) throw new ErroApi(padrao, resposta.status, dados.codigo);
    throw new ErroApi(dados.erro, resposta.status, dados.codigo, dados);
}

// Assina `montar(email, emitidoEm)` com a carteira ativa na MetaMask.
export async function assinarComCarteira(montar) {
    if (!window.ethereum) throw new Error("Conecte a carteira vinculada à sua conta.");
    const assinante = await new BrowserProvider(window.ethereum).getSigner();
    const emitidoEm = Date.now();
    const assinatura = await assinante.signMessage(montar(emailDaConta(), emitidoEm));
    return { emitidoEm, assinatura };
}
