// Consultas das tabelas organizacoes e organizacao_nomes.
import { bd } from "../nucleo/banco.js";

const primeira = (r) => r.rows[0] ?? null;

export const buscarOrganizacao = async (id) =>
    primeira(await bd("SELECT * FROM organizacoes WHERE id = $1", [id]));

export const buscarOrganizacaoPorIdCadeia = async (idCadeia) =>
    primeira(await bd("SELECT * FROM organizacoes WHERE id_cadeia = $1", [idCadeia]));

export const buscarOrganizacaoPorCnpj = async (cnpj) =>
    primeira(await bd("SELECT id FROM organizacoes WHERE cnpj = $1", [cnpj]));

// Cria a organizacao como pendente, com o primeiro nome datado.
export async function inserirOrganizacao(d, criadaPor) {
    const r = await bd(
        `WITH nova AS (
            INSERT INTO organizacoes
                (tipo, razao_social, nome_fantasia, cnpj, telefone, email, cep, logradouro, numero,
                 complemento, bairro, municipio_ibge, latitude, longitude, administrador_id, criada_por, administrador_carteira)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING *
         ), nome AS (
            INSERT INTO organizacao_nomes (organizacao_id, razao_social, nome_fantasia, registrado_por)
            SELECT id, razao_social, nome_fantasia, $16 FROM nova
         )
         SELECT * FROM nova`,
        [
            d.tipo, d.razaoSocial, d.nomeFantasia, d.cnpj, d.telefone, d.email, d.cep, d.logradouro, d.numero,
            d.complemento, d.bairro, d.municipio, d.latitude, d.longitude, d.administradorId, criadaPor, d.administradorCarteira
        ]
    );
    return r.rows[0];
}

// Atualiza os dados cadastrais; se o nome mudou, guarda o novo como linha datada.
export async function atualizarCadastro(id, d, registradoPor) {
    const r = await bd(
        `WITH anterior AS (
            SELECT razao_social, nome_fantasia FROM organizacoes WHERE id = $1
         ), atualizada AS (
            UPDATE organizacoes SET
                razao_social = $2, nome_fantasia = $3, telefone = $4, email = $5, cep = $6, logradouro = $7,
                numero = $8, complemento = $9, bairro = $10, municipio_ibge = $11, latitude = $12, longitude = $13
            WHERE id = $1
            RETURNING *
         ), nome AS (
            INSERT INTO organizacao_nomes (organizacao_id, razao_social, nome_fantasia, registrado_por)
            SELECT $1, $2, $3, $14 FROM anterior
            WHERE anterior.razao_social <> $2 OR anterior.nome_fantasia <> $3
            RETURNING id
         )
         SELECT atualizada.*, (SELECT count(*) FROM nome)::int AS nomes_novos FROM atualizada`,
        [
            id, d.razaoSocial, d.nomeFantasia, d.telefone, d.email, d.cep, d.logradouro, d.numero,
            d.complemento, d.bairro, d.municipio, d.latitude, d.longitude, registradoPor
        ]
    );
    return r.rows[0];
}

export const marcarCredenciada = (id, idCadeia, txHash, credenciadaEm) => bd(
    `UPDATE organizacoes
     SET id_cadeia = $2, credenciamento_tx = $3, credenciada_em = to_timestamp($4), situacao = 'ativa'
     WHERE id = $1`,
    [id, idCadeia, txHash, credenciadaEm]
);

export const definirSituacao = (id, situacao) =>
    bd("UPDATE organizacoes SET situacao = $2 WHERE id = $1", [id, situacao]);

// Carteira do administrador indicado, enquanto a organizacao esta pendente.
export const definirCarteiraDoIndicado = (usuarioId, carteira) => bd(
    "UPDATE organizacoes SET administrador_carteira = lower($2) WHERE administrador_id = $1 AND id_cadeia IS NULL",
    [usuarioId, carteira]
);

// O que qualquer pessoa pode ver: nome, tipo, endereco e situacao das
// organizacoes ja credenciadas. Sem CNPJ, contato ou administrador.
export async function listarOrganizacoesPublicas() {
    const r = await bd(
        `SELECT o.id, o.id_cadeia, o.tipo, o.nome_fantasia, o.cep, o.logradouro, o.numero, o.complemento,
                o.bairro, o.municipio_ibge, o.latitude, o.longitude, o.situacao, o.credenciada_em,
                (SELECT json_agg(json_build_object('nome', n.nome_fantasia, 'desde', n.vigente_desde) ORDER BY n.vigente_desde, n.id)
                 FROM organizacao_nomes n WHERE n.organizacao_id = o.id) AS nomes
         FROM organizacoes o
         WHERE o.id_cadeia IS NOT NULL
         ORDER BY o.nome_fantasia`
    );
    return r.rows;
}

// Cadastro completo, com o administrador, para a gestao pelo DETRAN.
export async function listarOrganizacoesCompletas() {
    const r = await bd(
        `SELECT o.*, u.nome AS indicado_nome, u.email AS indicado_email,
                (SELECT string_agg(a.nome, ', ' ORDER BY a.nome) FROM membros m JOIN usuarios a ON a.id = m.usuario_id
                 WHERE m.organizacao_id = o.id AND m.ativo AND m.papel = 'administrador') AS administradores,
                (SELECT count(*)::int FROM vinculos_sem_conta s WHERE s.organizacao_id = o.id AND s.papel = 'administrador') AS administradores_sem_conta,
                (SELECT count(*)::int FROM membros m WHERE m.organizacao_id = o.id AND m.ativo) AS funcionarios_ativos
         FROM organizacoes o
         LEFT JOIN usuarios u ON u.id = o.administrador_id
         ORDER BY (o.situacao = 'pendente') DESC, o.nome_fantasia`
    );
    return r.rows;
}
