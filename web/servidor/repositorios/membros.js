// Consultas de contas e de seus vinculos com organizacoes (tabela membros).
import { bd } from "../nucleo/banco.js";

const primeira = (r) => r.rows[0] ?? null;

export const buscarContaPorEmail = async (email) =>
    primeira(await bd("SELECT id, nome, email, carteira FROM usuarios WHERE email = $1", [email]));

export const buscarContaPorCarteira = async (carteira) =>
    primeira(await bd("SELECT id, nome, email, carteira FROM usuarios WHERE lower(carteira) = lower($1)", [carteira]));

// Grava a carteira de uma conta. O indice unico recusa (23505) a carteira
// que ja pertence a outra conta.
export const definirCarteira = (usuarioId, carteira) =>
    bd("UPDATE usuarios SET carteira = $2, carteira_vinculada_em = now() WHERE id = $1", [usuarioId, carteira.toLowerCase()]);

export const buscarMembro = async (organizacaoId, usuarioId) =>
    primeira(await bd("SELECT * FROM membros WHERE organizacao_id = $1 AND usuario_id = $2", [organizacaoId, usuarioId]));

// Grava o vinculo como o contrato o mostra agora. Devolve a linha anterior
// (ou null), para quem chama saber o que mudou.
export async function salvarMembro({ organizacaoId, usuarioId, carteira, papel, ativo }) {
    const anterior = await buscarMembro(organizacaoId, usuarioId);
    await bd(
        `INSERT INTO membros (organizacao_id, usuario_id, carteira, papel, ativo, desativado_em)
         VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN NULL ELSE now() END)
         ON CONFLICT (organizacao_id, usuario_id) DO UPDATE
         SET carteira = EXCLUDED.carteira, papel = EXCLUDED.papel, ativo = EXCLUDED.ativo,
             desativado_em = CASE WHEN EXCLUDED.ativo THEN NULL
                                  WHEN membros.ativo THEN now()
                                  ELSE membros.desativado_em END`,
        [organizacaoId, usuarioId, carteira.toLowerCase(), papel, ativo]
    );
    return anterior;
}

export const buscarVinculoSemConta = async (carteira) =>
    primeira(await bd("SELECT * FROM vinculos_sem_conta WHERE carteira = lower($1)", [carteira]));

export const salvarVinculoSemConta = (carteira, organizacaoId, papel) => bd(
    `INSERT INTO vinculos_sem_conta (carteira, organizacao_id, papel) VALUES (lower($1), $2, $3)
     ON CONFLICT (carteira) DO UPDATE SET organizacao_id = EXCLUDED.organizacao_id, papel = EXCLUDED.papel`,
    [carteira, organizacaoId, papel]
);

export const removerVinculoSemConta = (carteira) =>
    bd("DELETE FROM vinculos_sem_conta WHERE carteira = lower($1)", [carteira]);

// Tira da equipe a linha de uma carteira (com conta ou aguardando conta).
// Devolve quem saiu, ou null se a carteira nao estava na equipe.
export async function removerDaEquipe(organizacaoId, carteira) {
    const r = await bd(
        `DELETE FROM membros m USING usuarios u
         WHERE u.id = m.usuario_id AND m.organizacao_id = $1 AND lower(m.carteira) = lower($2)
         RETURNING u.id, u.nome`,
        [organizacaoId, carteira]
    );
    const s = await bd("DELETE FROM vinculos_sem_conta WHERE organizacao_id = $1 AND carteira = lower($2) RETURNING carteira", [organizacaoId, carteira]);
    if (r.rows.length === 0 && s.rows.length === 0) return null;
    return { id: r.rows[0]?.id ?? null, nome: r.rows[0]?.nome ?? null };
}

export async function listarVinculosSemConta(organizacaoId) {
    const r = await bd("SELECT carteira, papel, criado_em FROM vinculos_sem_conta WHERE organizacao_id = $1 ORDER BY criado_em", [organizacaoId]);
    return r.rows;
}

export async function listarMembros(organizacaoId) {
    const r = await bd(
        `SELECT m.id, m.papel, m.ativo, m.carteira, m.vinculado_em, m.desativado_em, u.nome, u.email
         FROM membros m JOIN usuarios u ON u.id = m.usuario_id
         WHERE m.organizacao_id = $1
         ORDER BY m.ativo DESC, (m.papel = 'administrador') DESC, u.nome`,
        [organizacaoId]
    );
    return r.rows;
}
