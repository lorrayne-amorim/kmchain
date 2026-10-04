// APAGA TODOS OS DADOS do banco configurado em DATABASE_URL (.env.local),
// preservando as tabelas. Existe para recomecar a demonstracao junto com um
// contrato novo: banco e blockchain precisam nascer vazios ao mesmo tempo.
//
// NAO HA COMO DESFAZER. Contas, organizacoes, veiculos, eventos, correcoes,
// auditoria e o indice dos comprovantes sao apagados. Os eventos ja gravados
// na blockchain e os arquivos no IPFS continuam onde estao, mas o sistema
// deixa de aponta-los.
//
// Protecoes, todas obrigatorias:
//   1. KMCHAIN_PERMITIR_RESET=sim no ambiente;
//   2. --banco=<nome>, igual ao nome do banco da DATABASE_URL;
//   3. recusa em ambiente de producao (VERCEL ou NODE_ENV=production);
//   4. digitar APAGAR quando o script perguntar, depois de ver o que sera apagado.
//
// Uso: KMCHAIN_PERMITIR_RESET=sim npm run demo:resetar -- --banco=<nome>
//      (--apenas-listar mostra o que seria apagado e sai)
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

// Dados que o cenario de demonstracao recria. A ordem nao importa: o
// TRUNCATE ... CASCADE trata as chaves estrangeiras.
const TABELAS = [
    "auditoria", "solicitacoes_correcao", "eventos", "membros", "vinculos_sem_conta", "organizacao_nomes", "organizacoes",
    "veiculo_placas", "veiculo_ufs", "veiculo_proprietarios", "veiculos",
    "tokens_documento", "acessos_documentos", "documentos", "marcas_adicionais", "usuarios"
];

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
const apenasListar = process.argv.includes("--apenas-listar");
const recusar = (motivo) => { console.error(`Reset recusado: ${motivo}`); process.exit(1); };

if (process.env.VERCEL || process.env.NODE_ENV === "production") recusar("ambiente de producao.");
const url = process.env.DATABASE_URL
    ?? readFileSync(path.join(raiz, ".env.local"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1].trim();
if (!url || url.startsWith("pglite:")) recusar("DATABASE_URL nao aponta para um Postgres (o ambiente local ja nasce vazio).");
const { hostname, pathname } = new URL(url);
const banco = pathname.slice(1);

if (!apenasListar) {
    if (process.env.KMCHAIN_PERMITIR_RESET !== "sim") recusar("defina KMCHAIN_PERMITIR_RESET=sim para confirmar que e isso mesmo.");
    if (argumento("banco") !== banco) recusar(`informe --banco=<nome do banco>. A DATABASE_URL aponta para "${banco}" em ${hostname}.`);
}

const cliente = new pg.Client({ connectionString: url, ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false } });
await cliente.connect();

const existentes = (await cliente.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")).rows.map((l) => l.table_name);
// Bancos que ainda nao receberam a migracao tem a tabela com o nome antigo.
const alvos = [...TABELAS, "registros_privados"].filter((t) => existentes.includes(t));

console.log(`Banco "${banco}" em ${hostname}\n`);
let total = 0;
for (const tabela of alvos) {
    const n = (await cliente.query(`SELECT count(*)::int AS n FROM "${tabela}"`)).rows[0].n;
    total += n;
    console.log(`  ${tabela.padEnd(24)} ${n} linha(s)`);
}

if (apenasListar) {
    console.log(`\n${total} linha(s) seriam apagadas. Nada foi alterado.`);
} else {
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resposta = await terminal.question(`\n${total} linha(s) serao apagadas de forma definitiva. Digite APAGAR para continuar: `);
    terminal.close();
    if (resposta.trim() !== "APAGAR") {
        await cliente.end();
        recusar("confirmacao nao digitada. Nada foi alterado.");
    }
    await cliente.query(`TRUNCATE ${alvos.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
    // O DETRAN e a organizacao 1 de qualquer contrato novo (mesma linha da migracao).
    if (existentes.includes("organizacoes")) {
        await cliente.query(
            `INSERT INTO organizacoes (id_cadeia, tipo, razao_social, nome_fantasia, situacao, credenciada_em)
             VALUES (1, 'DETRAN', 'Departamento Estadual de Trânsito', 'DETRAN', 'ativa', now())`
        );
    }
    console.log("Dados apagados. As tabelas foram preservadas.");
}
await cliente.end();
