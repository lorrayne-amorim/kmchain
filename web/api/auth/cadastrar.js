// Cria a conta de login (email + senha) de uma entidade que ainda vai ser
// credenciada pelo DETRAN em cadeia. Essa conta, por si so, NAO da nenhum
// acesso ao contrato - e so a segunda camada, que fica na frente da carteira.
import bcrypt from "bcryptjs";
import { bd } from "../_db.js";
import { criarToken, definirCookieSessao } from "../_sessao.js";

const PAPEIS_VALIDOS = new Set(["detran", "vistoria", "oficina"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const { nome, email, senha, papelSolicitado } = req.body ?? {};

        const nomeLimpo = String(nome ?? "").trim();
        const emailLimpo = String(email ?? "").trim().toLowerCase();

        if (nomeLimpo.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
        if (!EMAIL_RE.test(emailLimpo)) return res.status(400).json({ erro: "E-mail inválido." });
        if (String(senha ?? "").length < 8) {
            return res.status(400).json({ erro: "A senha precisa ter pelo menos 8 caracteres." });
        }
        if (!PAPEIS_VALIDOS.has(papelSolicitado)) {
            return res.status(400).json({ erro: "Selecione a entidade que você representa." });
        }

        const existente = await bd("SELECT id FROM usuarios WHERE email = $1", [emailLimpo]);
        if (existente.rowCount > 0) {
            return res.status(409).json({ erro: "Já existe uma conta com este e-mail." });
        }

        const senhaHash = await bcrypt.hash(senha, 12);
        const r = await bd(
            `INSERT INTO usuarios (nome, email, senha_hash, papel_solicitado)
             VALUES ($1, $2, $3, $4)
             RETURNING id, nome, email, papel_solicitado, carteira`,
            [nomeLimpo, emailLimpo, senhaHash, papelSolicitado]
        );
        const usuario = r.rows[0];

        definirCookieSessao(res, criarToken({ id: usuario.id, email: usuario.email, nome: usuario.nome }));
        res.status(201).json({ usuario });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
