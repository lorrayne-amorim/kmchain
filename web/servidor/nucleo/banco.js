// Conexao unica (pool) com o banco SQL, compartilhada por todas as rotas.
// Guarda o que fica FORA da blockchain (off-chain): contas, cadastro das
// organizacoes e seus funcionarios, identificacao dos veiculos, dados do
// proprietario, o complemento de cada evento registrado em cadeia, as
// solicitacoes de correcao, o indice dos documentos e a auditoria.
import pg from "pg";
import { indisponivel, ehFalhaDeRede } from "./http.js";

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

// Ambiente local de demonstracao (DATABASE_URL=pglite:memoria): Postgres em
// memoria, que nasce vazio a cada execucao, junto com o no Hardhat local.
let local;
function bancoLocal() {
    local ??= import("@electric-sql/pglite").then(async ({ PGlite }) => {
        const db = new PGlite();
        await db.waitReady;
        return db;
    });
    return local;
}
const ehLocal = () => process.env.DATABASE_URL?.startsWith("pglite:");

async function consultaLocal(texto, valores) {
    const r = await (await bancoLocal()).query(texto, valores);
    const temLinhas = r.fields && r.fields.length > 0;
    return { rows: r.rows, rowCount: temLinhas ? r.rows.length : (r.affectedRows ?? 0) };
}

// Os testes trocam o Postgres real por um em memoria (PGlite); o resto do
// codigo so conhece `bd()`.
const executorPadrao = {
    consulta: (texto, valores) => (ehLocal() ? consultaLocal(texto, valores) : conexao().query(texto, valores)),
    script: async (texto) => (ehLocal() ? (await bancoLocal()).exec(texto) : conexao().query(texto))
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

    -- Complemento off-chain de cada evento registrado em cadeia. A tabela se
    -- chamava registros_privados; os indices mantem o nome antigo para a
    -- migracao continuar idempotente em bancos ja criados.
    DO $$
    BEGIN
        IF to_regclass('registros_privados') IS NOT NULL AND to_regclass('eventos') IS NULL THEN
            ALTER TABLE registros_privados RENAME TO eventos;
        END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS eventos (
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
        ON eventos (chassi);
    -- Dados conferidos na propria transacao, nao enviados pelo navegador.
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS quilometragem BIGINT;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS registrado_em_cadeia TIMESTAMPTZ;
    -- Uma transacao gera no maximo um registro privado (reenvio e seguro).
    CREATE UNIQUE INDEX IF NOT EXISTS registros_privados_tx_unica
        ON eventos (lower(tx_hash));

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

    -- Data e hora do EVENTO (quando a vistoria, revisao etc. aconteceu),
    -- informada por quem registrou. A data do bloco (registrado_em_cadeia) e
    -- outra coisa: quando o registro entrou na blockchain.
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS observada_em TIMESTAMPTZ;

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

    -- Organizacoes credenciadas pelo DETRAN. O contrato guarda so o
    -- identificador (id_cadeia), o tipo, a situacao e o administrador; os
    -- dados cadastrais e o endereco ficam aqui.
    CREATE TABLE IF NOT EXISTS organizacoes (
        id                 SERIAL PRIMARY KEY,
        id_cadeia          INTEGER UNIQUE,
        tipo               TEXT NOT NULL CHECK (tipo IN ('DETRAN', 'OFICINA', 'VISTORIA', 'SEGURADORA')),
        razao_social       TEXT NOT NULL,
        nome_fantasia      TEXT NOT NULL,
        cnpj               TEXT UNIQUE,
        telefone           TEXT,
        email              TEXT,
        cep                TEXT,
        logradouro         TEXT,
        numero             TEXT,
        complemento        TEXT,
        bairro             TEXT,
        municipio_ibge     INTEGER,
        latitude           DOUBLE PRECISION,
        longitude          DOUBLE PRECISION,
        situacao           TEXT NOT NULL DEFAULT 'pendente'
                           CHECK (situacao IN ('pendente', 'ativa', 'suspensa')),
        administrador_id   INTEGER REFERENCES usuarios(id),
        credenciada_em     TIMESTAMPTZ,
        credenciamento_tx  TEXT,
        criada_por         INTEGER REFERENCES usuarios(id),
        criado_em          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- O DETRAN e a organizacao 1 do contrato e ja nasce credenciado.
    INSERT INTO organizacoes (id_cadeia, tipo, razao_social, nome_fantasia, situacao, credenciada_em)
    SELECT 1, 'DETRAN', 'Departamento Estadual de Trânsito', 'DETRAN', 'ativa', now()
    WHERE NOT EXISTS (SELECT 1 FROM organizacoes WHERE id_cadeia = 1);

    -- Nomes DATADOS: uma mudanca de razao social ou nome fantasia entra como
    -- linha nova, e o nome da epoca de cada evento continua recuperavel.
    CREATE TABLE IF NOT EXISTS organizacao_nomes (
        id              SERIAL PRIMARY KEY,
        organizacao_id  INTEGER NOT NULL REFERENCES organizacoes(id),
        razao_social    TEXT NOT NULL,
        nome_fantasia   TEXT NOT NULL,
        vigente_desde   TIMESTAMPTZ NOT NULL DEFAULT now(),
        registrado_por  INTEGER REFERENCES usuarios(id)
    );

    -- Vinculo de cada conta com uma organizacao. Espelha o contrato (que e
    -- quem autoriza); desativar nao apaga a linha.
    CREATE TABLE IF NOT EXISTS membros (
        id              SERIAL PRIMARY KEY,
        organizacao_id  INTEGER NOT NULL REFERENCES organizacoes(id),
        usuario_id      INTEGER NOT NULL REFERENCES usuarios(id),
        carteira        TEXT NOT NULL,
        papel           TEXT NOT NULL CHECK (papel IN ('administrador', 'funcionario')),
        ativo           BOOLEAN NOT NULL DEFAULT true,
        vinculado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
        desativado_em   TIMESTAMPTZ,
        UNIQUE (organizacao_id, usuario_id)
    );

    -- Carteira do administrador indicado no cadastro: e para ela que o
    -- credenciamento e assinado, tenha a pessoa conta ou nao.
    ALTER TABLE organizacoes ADD COLUMN IF NOT EXISTS administrador_carteira TEXT;

    -- Carteiras ja vinculadas a uma organizacao no contrato cuja pessoa ainda
    -- nao criou conta. Quando a conta vincula a carteira, a linha vira membro.
    CREATE TABLE IF NOT EXISTS vinculos_sem_conta (
        carteira        TEXT PRIMARY KEY,
        organizacao_id  INTEGER NOT NULL REFERENCES organizacoes(id),
        papel           TEXT NOT NULL CHECK (papel IN ('administrador', 'funcionario')),
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- O que o contrato v2 guarda de cada evento, espelhado para listagens, e
    -- o que so existe aqui (seguradora contratante, justificativa).
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS contrato TEXT NOT NULL DEFAULT 'v1';
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS indice INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS tipo_codigo INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS municipio_ibge INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS organizacao_id INTEGER REFERENCES organizacoes(id);
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS seguradora_id INTEGER REFERENCES organizacoes(id);
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS referencia_indice INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS hash_documento TEXT;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS justificativa TEXT;

    -- Verificacao da localizacao do dispositivo no momento do registro,
    -- comparada com o endereco cadastrado da organizacao. Fica so aqui: a
    -- blockchain guarda o municipio do evento, nunca as coordenadas.
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_situacao TEXT
        CHECK (localizacao_situacao IN ('VERIFICADA', 'FORA_DA_AREA', 'BAIXA_PRECISAO', 'INDISPONIVEL', 'SEM_REFERENCIA'));
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_latitude DOUBLE PRECISION;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_longitude DOUBLE PRECISION;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_precisao INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_distancia INTEGER;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_capturada_em TIMESTAMPTZ;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_motivo TEXT;
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS localizacao_justificativa TEXT;
    CREATE INDEX IF NOT EXISTS eventos_organizacao_idx ON eventos (organizacao_id, registrado_em_cadeia);
    CREATE UNIQUE INDEX IF NOT EXISTS eventos_indice_unico ON eventos (chassi, indice) WHERE contrato = 'v2';

    -- Solicitacoes de correcao abertas pelas organizacoes e decididas pelo
    -- DETRAN. A rejeitada fica so aqui; a aprovada vira um evento em cadeia.
    CREATE TABLE IF NOT EXISTS solicitacoes_correcao (
        id               SERIAL PRIMARY KEY,
        chassi           TEXT NOT NULL,
        indice_original  INTEGER NOT NULL,
        km_original      BIGINT NOT NULL,
        km_solicitada    BIGINT NOT NULL,
        justificativa    TEXT NOT NULL,
        organizacao_id   INTEGER NOT NULL REFERENCES organizacoes(id),
        usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
        hash_evidencia   TEXT,
        vistoria_indice  INTEGER,
        situacao         TEXT NOT NULL DEFAULT 'PENDENTE'
                         CHECK (situacao IN ('PENDENTE', 'APROVADA', 'REJEITADA')),
        solicitada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
        analisada_por    INTEGER REFERENCES usuarios(id),
        analisada_em     TIMESTAMPTZ,
        motivo_decisao   TEXT,
        correcao_indice  INTEGER,
        correcao_tx      TEXT
    );
    -- Um evento tem no maximo uma solicitacao em analise.
    CREATE UNIQUE INDEX IF NOT EXISTS solicitacoes_correcao_pendente_unica
        ON solicitacoes_correcao (chassi, indice_original) WHERE situacao = 'PENDENTE';

    -- Trilha das acoes administrativas (credenciamento, funcionarios,
    -- correcoes). Fica fora da blockchain.
    CREATE TABLE IF NOT EXISTS auditoria (
        id              SERIAL PRIMARY KEY,
        acao            TEXT NOT NULL,
        usuario_id      INTEGER REFERENCES usuarios(id),
        organizacao_id  INTEGER REFERENCES organizacoes(id),
        alvo_tipo       TEXT,
        alvo_id         TEXT,
        detalhes        JSONB NOT NULL DEFAULT '{}',
        criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auditoria_criado_idx ON auditoria (criado_em);
`;

// Cria as tabelas na primeira consulta de cada instancia quente do servidor.
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
