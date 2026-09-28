// Login/senha: a segunda camada de acesso ao painel profissional, na frente
// da carteira. Fica so aqui - o cookie de sessao e HttpOnly, o front nunca
// le nem guarda o token, so reage ao {usuario} que cada rota devolve.
import { BrowserProvider } from "ethers";
import { chamarApi } from "./api";
import { mensagemVinculo } from "./mensagens";

const chamar = (rota, corpo) => chamarApi(`auth/${rota}`, { corpo });

export const criarConta = (nome, email, senha) =>
    chamar("cadastrar", { nome, email, senha });

export const entrar = (email, senha) => chamar("entrar", { email, senha });

export async function sair() {
    await fetch("/api/auth/eu", { method: "DELETE", credentials: "same-origin" });
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
    const assinatura = await assinante.signMessage(mensagemVinculo(carteira, emailDaConta, emitidoEm));

    return chamar("vincular-carteira", { carteira, emitidoEm, assinatura });
}
