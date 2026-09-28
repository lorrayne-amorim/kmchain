// Sessao de login.
// GET: quem esta logado agora, direto do banco (nao so do token) - assim, se
//      o DETRAN ja vinculou uma carteira a conta, o front enxerga na hora.
// DELETE: sai (apaga o cookie). Fica na mesma function para caber no limite
//      de functions por deploy do plano da Vercel.
import { bd } from "../_db.js";
import { responderErro } from "../_http.js";
import { limparCookieSessao, sessaoAtual } from "../_sessao.js";

export default async function handler(req, res) {
    if (req.method === "DELETE") {
        limparCookieSessao(res);
        return res.status(200).json({ ok: true });
    }
    if (req.method !== "GET") return res.status(405).json({ erro: "Use GET ou DELETE.", codigo: "metodo" });

    const sessao = sessaoAtual(req);
    if (!sessao) return res.status(200).json({ usuario: null });

    try {
        const r = await bd(
            "SELECT id, nome, email, carteira FROM usuarios WHERE id = $1",
            [sessao.id]
        );
        res.status(200).json({ usuario: r.rows[0] ?? null });
    } catch (erro) {
        responderErro(res, erro, "auth/eu");
    }
}
