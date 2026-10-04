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
