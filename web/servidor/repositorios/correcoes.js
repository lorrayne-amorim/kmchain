// Consultas da tabela solicitacoes_correcao.
import { bd } from "../nucleo/banco.js";

const SELECAO = `
    SELECT s.*, o.nome_fantasia AS organizacao_nome, o.tipo AS organizacao_tipo,
           u.nome AS solicitante_nome, a.nome AS analista_nome
    FROM solicitacoes_correcao s
    JOIN organizacoes o ON o.id = s.organizacao_id
    JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN usuarios a ON a.id = s.analisada_por`;

export async function inserirSolicitacao(s) {
    const r = await bd(
        `INSERT INTO solicitacoes_correcao
            (chassi, indice_original, km_original, km_solicitada, justificativa, organizacao_id, usuario_id,
             hash_evidencia, vistoria_indice)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [s.chassi, s.indiceOriginal, s.kmOriginal, s.kmSolicitada, s.justificativa, s.organizacaoId, s.usuarioId, s.hashEvidencia, s.vistoriaIndice]
    );
    return r.rows[0];
}

export async function buscarSolicitacao(id) {
    const r = await bd(`${SELECAO} WHERE s.id = $1`, [id]);
    return r.rows[0] ?? null;
}

// Solicitacoes de uma organizacao (ou de todas, se `organizacaoId` for
// null), pendentes primeiro.
export async function listarSolicitacoes(organizacaoId, situacao) {
    const r = await bd(
        `${SELECAO}
         WHERE ($1::int IS NULL OR s.organizacao_id = $1) AND ($2::text IS NULL OR s.situacao = $2)
         ORDER BY (s.situacao = 'PENDENTE') DESC, s.solicitada_em DESC LIMIT 200`,
        [organizacaoId, situacao || null]
    );
    return r.rows;
}

// Grava a decisao so se a solicitacao ainda estiver pendente; devolve a
// linha decidida ou null (ja decidida por outra pessoa).
export async function decidirSolicitacao(id, d) {
    const r = await bd(
        `UPDATE solicitacoes_correcao
         SET situacao = $2, analisada_por = $3, analisada_em = now(), motivo_decisao = $4,
             correcao_indice = $5, correcao_tx = $6
         WHERE id = $1 AND situacao = 'PENDENTE'
         RETURNING *`,
        [id, d.situacao, d.analisadaPor, d.motivo, d.correcaoIndice ?? null, d.correcaoTx ?? null]
    );
    return r.rows[0] ?? null;
}

export async function documentoEnviadoPor(hash, usuarioId) {
    const r = await bd("SELECT 1 FROM documentos WHERE hash = $1 AND enviado_por = $2", [hash, usuarioId]);
    return r.rowCount > 0;
}
