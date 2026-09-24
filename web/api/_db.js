// Conexao unica (pool) com o banco SQL, compartilhada por todas as functions.
// Guarda apenas o que NAO pode ir para a blockchain: login das entidades
// credenciadas e os dados sensiveis de cada servico (CPF do proprietario,
// placa/modelo/ano no momento e quem, de fato, realizou o registro).
import pg from "pg";

const { Pool } = pg;

let pool;
function conexao() {
    if (!pool) {
        if (!process.env.DATABASE_URL) {
            throw new Error("DATABASE_URL não configurada.");
        }
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

let migrado = null;

// Cria as tabelas na primeira consulta de cada instancia quente da function.
// Idempotente (IF NOT EXISTS), entao pode rodar a cada cold start sem risco.
function migrar() {
    if (!migrado) {
        migrado = conexao().query(`
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
        `).then(() => true);
    }
    return migrado;
}

export async function bd(texto, valores) {
    await migrar();
    return conexao().query(texto, valores);
}
