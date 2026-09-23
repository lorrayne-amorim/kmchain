// Guarda, fora da blockchain, o que ela nunca deveria expor: CPF do
// proprietario atual, e principalmente QUEM (pessoa, nao so carteira) fez o
// servico. So aceita quem tem sessao de login valida - a segunda camada.
import { bd } from "../_db.js";
import { exigirSessao } from "../_sessao.js";

const EVENTOS_VALIDOS = new Set([
    "Cadastro", "Vistoria", "Revisão", "Transferência", "Sinistro", "Correção"
]);

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    const sessao = exigirSessao(req, res);
    if (!sessao) return;

    try {
        const {
            chassi, placa, modelo, ano,
            cpfProprietario, nomeProprietario,
            tipoEvento, carteira, txHash
        } = req.body ?? {};

        const chassiLimpo = String(chassi ?? "").trim().toUpperCase();
        if (chassiLimpo.length !== 17) return res.status(400).json({ erro: "Chassi inválido." });
        if (!EVENTOS_VALIDOS.has(tipoEvento)) return res.status(400).json({ erro: "Tipo de evento inválido." });

        await bd(
            `INSERT INTO registros_privados
                (chassi, placa, modelo, ano, cpf_proprietario, nome_proprietario,
                 tipo_evento, usuario_id, usuario_nome, usuario_email, carteira, tx_hash)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
                chassiLimpo,
                placa ? String(placa).trim().toUpperCase() : null,
                modelo ? String(modelo).trim() : null,
                ano ? Number(ano) : null,
                cpfProprietario ? String(cpfProprietario).replace(/\D/g, "") : null,
                nomeProprietario ? String(nomeProprietario).trim() : null,
                tipoEvento,
                sessao.id,
                sessao.nome,
                sessao.email,
                carteira ?? null,
                txHash ?? null
            ]
        );

        res.status(201).json({ ok: true });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}
