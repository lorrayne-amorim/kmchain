// Quem esta logado agora, direto do banco (nao so do token) - assim, se o
// DETRAN ja vinculou uma carteira a conta, o front enxerga na hora.
import { bd } from "../_db.js";
import { sessaoAtual } from "../_sessao.js";

export default async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ erro: "Use GET." });

    const sessao = sessaoAtual(req);
    if (!sessao) return res.status(200).json({ usuario: null });

    try {
        const r = await bd(
            "SELECT id, nome, email, papel_solicitado, carteira FROM usuarios WHERE id = $1",
            [sessao.id]
        );
        res.status(200).json({ usuario: r.rows[0] ?? null });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
