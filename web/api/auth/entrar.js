import bcrypt from "bcryptjs";
import { bd } from "../_db.js";
import { criarToken, definirCookieSessao } from "../_sessao.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const email = String(req.body?.email ?? "").trim().toLowerCase();
        const senha = String(req.body?.senha ?? "");

        const r = await bd(
            "SELECT id, nome, email, senha_hash, papel_solicitado, carteira FROM usuarios WHERE email = $1",
            [email]
        );
        const linha = r.rows[0];

        // Mesma mensagem para e-mail inexistente e senha errada, de proposito.
        if (!linha || !(await bcrypt.compare(senha, linha.senha_hash))) {
            return res.status(401).json({ erro: "E-mail ou senha incorretos." });
        }

        definirCookieSessao(res, criarToken({ id: linha.id, email: linha.email, nome: linha.nome }));
        delete linha.senha_hash;
        res.status(200).json({ usuario: linha });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
