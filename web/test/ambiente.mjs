// Ambiente de teste de integracao das rotas /api, sem servico externo real:
//   - blockchain: no Hardhat local com o contrato implantado do zero;
//   - banco: Postgres em memoria (PGlite), com a mesma migracao do _db.js;
//   - IPFS/Pinata: simulado aqui, guardando os envios em memoria.
// Todos os dados sao ficticios (contas publicas de teste do Hardhat,
// e-mails @exemplo.test e CPFs gerados).
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet } from "ethers";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const pastaContratos = path.join(aqui, "..", "..", "contratos");
const PORTA = 8547;

// Chaves publicas e conhecidas das contas de teste do Hardhat (nunca usar fora daqui).
export const CHAVES = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
];

let no;
export async function iniciarBlockchain() {
    execSync("npx hardhat compile --quiet", { cwd: pastaContratos, stdio: "ignore" });
    no = spawn("npx", ["hardhat", "node", "--port", String(PORTA)], { cwd: pastaContratos, shell: true });
    await new Promise((resolve, reject) => {
        const limite = setTimeout(() => reject(new Error("Hardhat node não iniciou")), 60000);
        no.stdout.on("data", (d) => {
            if (String(d).includes("Started HTTP")) {
                clearTimeout(limite);
                resolve();
            }
        });
        no.on("exit", (codigo) => reject(new Error(`Hardhat node saiu (${codigo})`)));
    });

    const rpc = `http://127.0.0.1:${PORTA}`;
    const provedor = new JsonRpcProvider(rpc, undefined, { staticNetwork: true, cacheTimeout: -1 });
    const carteiras = CHAVES.map((k) => new NonceManager(new Wallet(k, provedor)));

    const artefato = JSON.parse(readFileSync(
        path.join(pastaContratos, "artifacts", "contracts", "KmChainRegistry.sol", "KmChainRegistry.json"), "utf8"
    ));
    const fabrica = new ContractFactory(artefato.abi, artefato.bytecode, carteiras[0]);
    const contrato = await fabrica.deploy();
    await contrato.waitForDeployment();

    process.env.RPC_URL = rpc;
    process.env.KMCHAIN_ENDERECO = await contrato.getAddress();
    return { provedor, carteiras, contrato, abi: artefato.abi, bytecode: artefato.bytecode };
}

// Artefato compilado de um contrato (ex.: o auxiliar de teste de conta inteligente).
export function lerArtefato(arquivoSol, nome) {
    return JSON.parse(readFileSync(path.join(pastaContratos, "artifacts", "contracts", arquivoSol, `${nome}.json`), "utf8"));
}

export function pararBlockchain() {
    if (!no) return;
    if (process.platform === "win32") {
        try { execSync(`taskkill /PID ${no.pid} /T /F`, { stdio: "ignore" }); } catch { /* ja encerrado */ }
    } else {
        no.kill();
    }
}

export async function iniciarBanco(definirExecutor) {
    const db = new PGlite();
    await db.waitReady;
    const executor = {
        consulta: async (texto, valores) => {
            const r = await db.query(texto, valores);
            const temLinhas = r.fields && r.fields.length > 0;
            return { rows: r.rows, rowCount: temLinhas ? r.rows.length : (r.affectedRows ?? 0) };
        },
        script: (texto) => db.exec(texto)
    };
    definirExecutor(executor);
    return { db, executor };
}

// Pinata e gateway IPFS simulados; o resto (RPC local) passa direto.
export function simularIpfs() {
    const arquivos = new Map(); // cid -> bytes
    const envios = [];          // o que foi mandado ao Pinata, para inspecao
    const fetchReal = globalThis.fetch;
    let contador = 0;

    globalThis.fetch = async (url, opcoes = {}) => {
        const alvo = String(url);
        if (alvo === "https://uploads.pinata.cloud/v3/files") {
            const campos = {};
            for (const [chave, valor] of opcoes.body.entries()) {
                campos[chave] = typeof valor === "string" ? valor : { nome: valor.name, bytes: Buffer.from(await valor.arrayBuffer()) };
            }
            envios.push(campos);
            const cid = `bafyteste${++contador}`;
            arquivos.set(cid, campos.file.bytes);
            return new Response(JSON.stringify({ data: { cid } }), { status: 200 });
        }
        if (alvo.startsWith("https://api.pinata.cloud/v3/files/public?name=")) {
            return new Response(JSON.stringify({ data: { files: [] } }), { status: 200 });
        }
        const gateway = alvo.match(/^https:\/\/gateway\.teste\/ipfs\/(.+)$/);
        if (gateway) {
            const bytes = arquivos.get(gateway[1]);
            return bytes ? new Response(bytes, { status: 200 }) : new Response("nao achado", { status: 404 });
        }
        return fetchReal(url, opcoes);
    };

    process.env.PINATA_JWT = "jwt-de-teste";
    process.env.GATEWAY = "gateway.teste";
    return { arquivos, envios, restaurar: () => { globalThis.fetch = fetchReal; } };
}

export function configurarSegredos() {
    process.env.SESSION_SECRET = randomBytes(32).toString("hex");
    process.env.DOCS_KEY = randomBytes(32).toString("base64");
}

// Chama um handler como a Vercel chamaria e devolve a resposta.
export async function chamar(handler, { metodo = "POST", corpo, cookie, url = "/api/teste" } = {}) {
    const req = { method: metodo, headers: cookie ? { cookie } : {}, body: corpo, url };
    return new Promise((resolve, reject) => {
        const cabecalhos = {};
        const res = {
            statusCode: 200,
            setHeader(nome, valor) { cabecalhos[nome.toLowerCase()] = valor; },
            status(codigo) { this.statusCode = codigo; return this; },
            json(dados) { resolve({ status: this.statusCode, corpo: dados, cabecalhos }); },
            send(dados) { resolve({ status: this.statusCode, corpo: dados, cabecalhos }); }
        };
        Promise.resolve(handler(req, res)).catch(reject);
    });
}

// CPF ficticio com digitos verificadores validos.
export function cpfFicticio(base = "123456789") {
    const digito = (b) => {
        let soma = 0;
        for (let i = 0; i < b.length; i++) soma += Number(b[i]) * (b.length + 1 - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    const d1 = digito(base);
    return base + d1 + digito(base + d1);
}
