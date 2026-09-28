// Conexao unica (pool) com o banco SQL, compartilhada por todas as functions.
// Guarda apenas o que NAO pode ir para a blockchain: login das entidades
// credenciadas, os dados sensiveis de cada servico (CPF do proprietario,
// placa e quem, de fato, realizou o registro) e o indice dos documentos.
import pg from "pg";
import { indisponivel, ehFalhaDeRede } from "./_http.js";

const { Pool } = pg;

let pool;
function conexao() {
    if (!pool) {
        if (!process.env.DATABASE_URL) throw indisponivel("banco_nao_configurado");
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            // A maioria dos provedores gerenciados (Neon, Supabase, Vercel
            // Postgres) exige TLS mas usa certificado que o driver nao valida
            // por padrao; sslmode=require na URL ja cobre a maioria dos casos.
            ssl: process.env.DATABASE_URL.includes("sslmode=disable")
                ? false
                : { rejectUnauthorized: false }
        });
    }
    return pool;
}

// Os testes trocam o Postgres real por um em memoria (PGlite); o resto do
// codigo so conhece `bd()`.
const executorPadrao = {
    consulta: (texto, valores) => conexao().query(texto, valores),
    script: (texto) => conexao().query(texto)
};
let executor = executorPadrao;
let migrado = null;

export function definirExecutor(novo) {
    executor = novo ?? executorPadrao;
    migrado = null;
}

const MIGRACAO = `
    CREATE TABLE IF NOT EXISTS usuarios (
        id               SERIAL PRIMARY KEY,
        nome             TEXT NOT NULL,
        email            TEXT NOT NULL UNIQUE,
        senha_hash       TEXT NOT NULL,
        carteira         TEXT,
        criado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Versao antiga pedia a funcao no cadastro; hoje quem define e o
    -- DETRAN, em cadeia, entao a coluna sai de bancos ja criados.
    ALTER TABLE usuarios DROP COLUMN IF EXISTS papel_solicitado;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS carteira_vinculada_em TIMESTAMPTZ;

    -- Uma carteira pertence a uma conta so. Bancos antigos podem ter
    -- vinculos repetidos: nesse caso o indice espera a limpeza manual e a
    -- regra continua valendo pela rota vincular-carteira.
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM usuarios WHERE carteira IS NOT NULL
            GROUP BY lower(carteira) HAVING count(*) > 1
        ) THEN
            CREATE UNIQUE INDEX IF NOT EXISTS usuarios_carteira_unica ON usuarios (lower(carteira));
        END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS registros_privados (
        id                SERIAL PRIMARY KEY,
        chassi            TEXT NOT NULL,
        placa             TEXT,
        modelo            TEXT,
        ano               INTEGER,
        cpf_proprietario  TEXT,
        nome_proprietario TEXT,
        tipo_evento       TEXT NOT NULL,
        usuario_id        INTEGER REFERENCES usuarios(id),
        usuario_nome      TEXT NOT NULL,
        usuario_email     TEXT NOT NULL,
        carteira          TEXT,
        tx_hash           TEXT,
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS registros_privados_chassi_idx
        ON registros_privados (chassi);
    -- Dados conferidos na propria transacao, nao enviados pelo navegador.
    ALTER TABLE registros_privados ADD COLUMN IF NOT EXISTS quilometragem BIGINT;
    ALTER TABLE registros_privados ADD COLUMN IF NOT EXISTS registrado_em_cadeia TIMESTAMPTZ;
    -- Uma transacao gera no maximo um registro privado (reenvio e seguro).
    CREATE UNIQUE INDEX IF NOT EXISTS registros_privados_tx_unica
        ON registros_privados (lower(tx_hash));

    -- Indice dos comprovantes: o CID fica aqui, e nao nos metadados do
    -- Pinata, junto de quem enviou (base da regra de acesso).
    CREATE TABLE IF NOT EXISTS documentos (
        hash         TEXT PRIMARY KEY,
        cid          TEXT NOT NULL,
        mime         TEXT NOT NULL,
        tamanho      INTEGER NOT NULL,
        chassi       TEXT,
        enviado_por  INTEGER REFERENCES usuarios(id),
        carteira     TEXT,
        criado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Trilha de auditoria de quem pediu cada comprovante (sem dados do
    -- proprietario e sem o conteudo).
    CREATE TABLE IF NOT EXISTS acessos_documentos (
        id              SERIAL PRIMARY KEY,
        hash_documento  TEXT NOT NULL,
        usuario_id      INTEGER REFERENCES usuarios(id),
        carteira        TEXT,
        resultado       TEXT NOT NULL,
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS acessos_documentos_usuario_idx
        ON acessos_documentos (usuario_id, criado_em);

    -- Quando o hodometro foi observado (informado por quem registrou). A
    -- data do bloco (registrado_em_cadeia) e outra coisa: o registro.
    ALTER TABLE registros_privados ADD COLUMN IF NOT EXISTS observada_em TIMESTAMPTZ;

    -- Marcas fora da lista-base (src/dados/marcas.json): entram como
    -- proposta e so viram marca da lista depois de aprovadas pelo admin.
    CREATE TABLE IF NOT EXISTS marcas_adicionais (
        id                TEXT PRIMARY KEY,
        nome              TEXT NOT NULL,
        nome_normalizado  TEXT NOT NULL UNIQUE,
        situacao          TEXT NOT NULL DEFAULT 'pendente'
                          CHECK (situacao IN ('pendente', 'aprovada', 'rejeitada')),
        proposta_por      INTEGER REFERENCES usuarios(id),
        revisada_por      INTEGER REFERENCES usuarios(id),
        criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
        revisado_em       TIMESTAMPTZ
    );

    -- Identificacao do veiculo (nao muda). O chassi e o identificador.
    CREATE TABLE IF NOT EXISTS veiculos (
        chassi          TEXT PRIMARY KEY,
        chave           TEXT NOT NULL UNIQUE,
        marca_id        TEXT NOT NULL,
        marca_nome      TEXT NOT NULL,
        modelo          TEXT NOT NULL,
        ano_fabricacao  INTEGER NOT NULL,
        ano_modelo      INTEGER NOT NULL,
        cadastro_tx     TEXT NOT NULL UNIQUE,
        cadastrado_por  INTEGER REFERENCES usuarios(id),
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Informacoes DATADAS: cada mudanca e uma linha nova com a data em que
    -- passou a valer; nada e sobrescrito. A vigente e a de maior vigente_desde.
    -- Sem chave estrangeira para veiculos: veiculos cadastrados antes desta
    -- tabela existir tambem recebem mudancas (ex.: transferencia).
    CREATE TABLE IF NOT EXISTS veiculo_placas (
        id              SERIAL PRIMARY KEY,
        chassi          TEXT NOT NULL,
        placa           TEXT NOT NULL,
        vigente_desde   TIMESTAMPTZ NOT NULL,
        origem          TEXT NOT NULL,
        tx_hash         TEXT,
        registrado_por  INTEGER REFERENCES usuarios(id),
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS veiculo_ufs (
        id              SERIAL PRIMARY KEY,
        chassi          TEXT NOT NULL,
        uf              TEXT NOT NULL,
        vigente_desde   TIMESTAMPTZ NOT NULL,
        origem          TEXT NOT NULL,
        tx_hash         TEXT,
        registrado_por  INTEGER REFERENCES usuarios(id),
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS veiculo_proprietarios (
        id              SERIAL PRIMARY KEY,
        chassi          TEXT NOT NULL,
        nome            TEXT NOT NULL,
        cpf             TEXT NOT NULL,
        vigente_desde   TIMESTAMPTZ NOT NULL,
        origem          TEXT NOT NULL,
        tx_hash         TEXT,
        registrado_por  INTEGER REFERENCES usuarios(id),
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Veiculos cadastrados em cadeia antes da identificacao privada recebem
    -- a identificacao depois ("complemento"), sem transacao propria.
    ALTER TABLE veiculos ALTER COLUMN cadastro_tx DROP NOT NULL;
    ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT 'cadastro';

    CREATE INDEX IF NOT EXISTS veiculo_placas_chassi_idx ON veiculo_placas (chassi, vigente_desde);
    CREATE INDEX IF NOT EXISTS veiculo_ufs_chassi_idx ON veiculo_ufs (chassi, vigente_desde);
    CREATE INDEX IF NOT EXISTS veiculo_proprietarios_chassi_idx ON veiculo_proprietarios (chassi, vigente_desde);

    -- Links de uso unico para abrir um comprovante. So o hash do token e
    -- guardado: quem le o banco nao consegue usar um link ainda valido.
    CREATE TABLE IF NOT EXISTS tokens_documento (
        token_hash      TEXT PRIMARY KEY,
        hash_documento  TEXT NOT NULL,
        usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
        expira_em       TIMESTAMPTZ NOT NULL,
        usado_em        TIMESTAMPTZ
    );
`;

// Cria as tabelas na primeira consulta de cada instancia quente da function.
// Idempotente (IF NOT EXISTS), entao pode rodar a cada cold start sem risco.
function migrar() {
    if (!migrado) {
        migrado = executor.script(MIGRACAO).then(() => true);
        migrado.catch(() => { migrado = null; }); // tenta de novo na proxima chamada
    }
    return migrado;
}

export async function bd(texto, valores) {
    try {
        await migrar();
        return await executor.consulta(texto, valores);
    } catch (erro) {
        if (ehFalhaDeRede(erro)) throw indisponivel("banco_indisponivel");
        throw erro;
    }
}
