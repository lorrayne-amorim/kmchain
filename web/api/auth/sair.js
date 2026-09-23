import { limparCookieSessao } from "../_sessao.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });
    limparCookieSessao(res);
    res.status(200).json({ ok: true });
}
