// Login/senha: a segunda camada de acesso ao painel profissional, na frente
// da carteira. Fica so aqui - o cookie de sessao e HttpOnly, o front nunca
// le nem guarda o token, so reage ao {usuario} que cada rota devolve.
import { BrowserProvider } from "ethers";

async function chamar(rota, corpo) {
    const resposta = await fetch(`/api/auth/${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(corpo)
    });
    const dados = await resposta.json().catch(() => ({}));
    // Erros 5xx trazem a mensagem interna do servidor: nao vale mostrar.
    if (resposta.status >= 500) throw new Error("Não foi possível concluir agora. Tente novamente em instantes.");
    if (!resposta.ok) throw new Error(dados.erro ?? "Não foi possível concluir a operação.");
    return dados;
}

export const criarConta = (nome, email, senha) =>
    chamar("cadastrar", { nome, email, senha });

export const entrar = (email, senha) => chamar("entrar", { email, senha });

export async function sair() {
    await fetch("/api/auth/sair", { method: "POST", credentials: "same-origin" });
}

export async function usuarioLogado() {
    const resposta = await fetch("/api/auth/eu", { credentials: "same-origin" });
    if (!resposta.ok) return null;
    const { usuario } = await resposta.json();
    return usuario;
}

// Assina uma mensagem com a carteira ja conectada para provar que ela
// pertence a quem esta logado, e associa as duas identidades no banco.
// `emailDaConta` precisa ser o e-mail exato da sessao: o servidor recompoe a
// mesma mensagem a partir do cookie e compara as assinaturas.
export async function vincularCarteira(carteira, emailDaConta) {
    if (!window.ethereum) throw new Error("Carteira não conectada.");
    const assinante = await new BrowserProvider(window.ethereum).getSigner();

    const emitidoEm = Date.now();
    const mensagem = `KmChain: vincular a carteira ${carteira} à conta ${emailDaConta} em ${emitidoEm}`;
    const assinatura = await assinante.signMessage(mensagem);

    return chamar("vincular-carteira", { carteira, emitidoEm, assinatura });
}
