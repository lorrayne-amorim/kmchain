// Devolve os registros privados de um chassi - CPF do proprietario e quem
// realizou cada servico. Dupla exigencia: sessao de login valida E carteira
// com DETRAN_ROLE provada por assinatura (o mesmo padrao de api/documento.js).
import { bd } from "../_db.js";
import { exigirSessao } from "../_sessao.js";
import { verificarPapel } from "../_chain.js";

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    const sessao = exigirSessao(req, res);
    if (!sessao) return;

    try {
        const { chassi, emitidoEm, assinatura } = req.body ?? {};
        const chassiLimpo = String(chassi ?? "").trim().toUpperCase();
        if (chassiLimpo.length !== 17) return res.status(400).json({ erro: "Chassi inválido." });

        const mensagem = `KmChain: consultar registros privados de ${chassiLimpo} em ${emitidoEm}`;
        const quemAssinou = await verificarPapel(mensagem, emitidoEm, assinatura, ["DEFAULT_ADMIN_ROLE", "DETRAN_ROLE"]);
        if (!quemAssinou) return res.status(403).json({ erro: "Carteira sem credencial DETRAN." });

        const r = await bd(
            `SELECT placa, modelo, ano, cpf_proprietario, nome_proprietario,
                    tipo_evento, usuario_nome, usuario_email, carteira, tx_hash, criado_em
             FROM registros_privados
             WHERE chassi = $1
             ORDER BY criado_em DESC`,
            [chassiLimpo]
        );
        res.status(200).json({ registros: r.rows });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
