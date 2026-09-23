// Lista as contas cadastradas (login) para o DETRAN localizar quem ja pediu
// acesso e ainda precisa ser credenciado em cadeia. So quem tem DETRAN_ROLE
// ou e o admin do contrato enxerga essa lista.
import { bd } from "../_db.js";
import { verificarPapel } from "../_chain.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const { emitidoEm, assinatura } = req.body ?? {};
        const mensagem = `KmChain: listar contas pendentes em ${emitidoEm}`;
        const quemAssinou = await verificarPapel(mensagem, emitidoEm, assinatura, [
            "DEFAULT_ADMIN_ROLE",
            "DETRAN_ROLE"
        ]);
        if (!quemAssinou) return res.status(403).json({ erro: "Carteira sem credencial para ver esta lista." });

        const r = await bd(
            `SELECT nome, email, papel_solicitado, carteira, criado_em
             FROM usuarios ORDER BY criado_em DESC LIMIT 200`
        );
        res.status(200).json({ contas: r.rows });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
