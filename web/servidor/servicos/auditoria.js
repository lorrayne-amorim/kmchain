// Trilha das acoes administrativas relevantes. Fica so no banco: a blockchain
// guarda os eventos de quilometragem, nao a rotina administrativa.
import { bd } from "../nucleo/banco.js";

export const ACOES = {
    ORGANIZACAO_CRIADA: "organizacao_criada",
    ORGANIZACAO_CREDENCIADA: "organizacao_credenciada",
    ORGANIZACAO_SUSPENSA: "organizacao_suspensa",
    ORGANIZACAO_REATIVADA: "organizacao_reativada",
    ORGANIZACAO_ALTERADA: "organizacao_alterada",
    ADMINISTRADOR_DEFINIDO: "administrador_definido",
    ADMINISTRADOR_REMOVIDO: "administrador_removido",
    CARTEIRA_DEFINIDA: "carteira_definida",
    FUNCIONARIO_CADASTRADO: "funcionario_cadastrado",
    FUNCIONARIO_DESATIVADO: "funcionario_desativado",
    FUNCIONARIO_REATIVADO: "funcionario_reativado",
    CORRECAO_SOLICITADA: "correcao_solicitada",
    CORRECAO_APROVADA: "correcao_aprovada",
    CORRECAO_REJEITADA: "correcao_rejeitada"
};

// Registra uma acao feita por `acesso` (conta e organizacao de quem agiu).
// `detalhes` nao deve levar CPF nem outros dados pessoais.
export async function registrarAuditoria(acao, acesso, alvo, detalhes = {}) {
    await bd(
        `INSERT INTO auditoria (acao, usuario_id, organizacao_id, alvo_tipo, alvo_id, detalhes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [acao, acesso.usuario.id, acesso.organizacao.id, alvo.tipo, String(alvo.id), JSON.stringify(detalhes)]
    );
}

// Ultimas acoes, da mais recente para a mais antiga, com filtro opcional por acao.
export async function listarAuditoria({ acao, limite = 200 } = {}) {
    const r = await bd(
        `SELECT a.id, a.acao, a.alvo_tipo, a.alvo_id, a.detalhes, a.criado_em,
                u.nome AS usuario_nome, o.nome_fantasia AS organizacao_nome
         FROM auditoria a
         LEFT JOIN usuarios u ON u.id = a.usuario_id
         LEFT JOIN organizacoes o ON o.id = a.organizacao_id
         WHERE $1::text IS NULL OR a.acao = $1
         ORDER BY a.criado_em DESC, a.id DESC LIMIT $2`,
        [acao || null, Math.min(Number(limite) || 200, 500)]
    );
    return r.rows;
}
