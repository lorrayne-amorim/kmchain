// Sessao de login (segunda camada de acesso, alem da carteira credenciada).
// Token assinado por HMAC-SHA256, no mesmo espirito do resto do backend:
// nada de biblioteca externa de JWT, so node:crypto - e sem estado em banco,
// o proprio token carrega e prova quem e o usuario.
import { createHmac, timingSafeEqual } from "node:crypto";

const NOME_COOKIE = "kmchain_sessao";
const VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function segredo() {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new Error("SESSION_SECRET não configurada.");
    return s;
}

const base64url = (buf) => Buffer.from(buf).toString("base64url");

function assinar(dados) {
    return base64url(createHmac("sha256", segredo()).update(dados).digest());
}

export function criarToken(payload) {
    const corpo = base64url(JSON.stringify({ ...payload, exp: Date.now() + VALIDADE_MS }));
    return `${corpo}.${assinar(corpo)}`;
}

export function lerToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [corpo, assinatura] = token.split(".");
    const esperada = assinar(corpo);
    const a = Buffer.from(assinatura);
    const b = Buffer.from(esperada);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    try {
        const dados = JSON.parse(Buffer.from(corpo, "base64url").toString());
        if (!dados.exp || dados.exp < Date.now()) return null;
        return dados;
    } catch {
        return null;
    }
}

function lerCookie(req, nome) {
    const cru = req.headers.cookie;
    if (!cru) return null;
    for (const parte of cru.split(";")) {
        const i = parte.indexOf("=");
        if (i === -1) continue;
        if (parte.slice(0, i).trim() === nome) return decodeURIComponent(parte.slice(i + 1).trim());
    }
    return null;
}

// Sessao atual (ou null) a partir do cookie da requisicao.
export function sessaoAtual(req) {
    return lerToken(lerCookie(req, NOME_COOKIE));
}

export function definirCookieSessao(res, token) {
    const seguro = process.env.VERCEL ? "Secure; " : ""; // permite testar em http local
    res.setHeader(
        "Set-Cookie",
        `${NOME_COOKIE}=${token}; HttpOnly; ${seguro}SameSite=Lax; Path=/; Max-Age=${VALIDADE_MS / 1000}`
    );
}

export function limparCookieSessao(res) {
    res.setHeader("Set-Cookie", `${NOME_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Exige sessao valida; responde 401 e devolve null se nao houver.
export function exigirSessao(req, res) {
    const sessao = sessaoAtual(req);
    if (!sessao) {
        res.status(401).json({ erro: "Faça login para continuar." });
        return null;
    }
    return sessao;
}
