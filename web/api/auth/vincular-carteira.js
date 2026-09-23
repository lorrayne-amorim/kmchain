// Associa a carteira MetaMask a conta de login - so registra QUEM e o dono
// da carteira para fins de auditoria interna; nao concede nenhum papel em
// cadeia (isso continua sendo so o DETRAN, via CredenciarEntidade).
import { verifyMessage } from "ethers";
import { bd } from "../_db.js";
import { exigirSessao } from "../_sessao.js";

const JANELA_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    const sessao = exigirSessao(req, res);
    if (!sessao) return;

    try {
        const { carteira, emitidoEm, assinatura } = req.body ?? {};
        if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
            return res.status(400).json({ erro: "Endereço de carteira inválido." });
        }
        if (Math.abs(Date.now() - Number(emitidoEm)) > JANELA_MS) {
            return res.status(400).json({ erro: "Assinatura expirada. Tente de novo." });
        }

        const mensagem = `KmChain: vincular a carteira ${carteira} à conta ${sessao.email} em ${emitidoEm}`;
        let quemAssinou;
        try {
            quemAssinou = verifyMessage(mensagem, assinatura);
        } catch {
            return res.status(400).json({ erro: "Assinatura inválida." });
        }
        if (quemAssinou.toLowerCase() !== carteira.toLowerCase()) {
            return res.status(400).json({ erro: "A assinatura não corresponde à carteira informada." });
        }

        await bd("UPDATE usuarios SET carteira = $1 WHERE id = $2", [carteira, sessao.id]);
        res.status(200).json({ ok: true, carteira });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
