// Ambiente local de demonstracao, num comando so (npm run demo:local):
//   - no Hardhat em http://127.0.0.1:8545 (chainId 31337);
//   - KmChainRegistryV2 implantado pela primeira conta do Hardhat, que vira a
//     administradora do DETRAN;
//   - banco Postgres em memoria (PGlite), vazio;
//   - a aplicacao em http://localhost:5173.
// Nada aqui toca a Sepolia nem o banco real. Tudo e descartado ao encerrar:
// blockchain e banco nascem vazios juntos, e por isso continuam coerentes.
// Depois de subir, `npm run demo:preparar` cria o cenario de demonstracao.
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import { createServer } from "vite";
import { CHAVES_HARDHAT } from "../demo/carteiras.mjs";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pastaContratos = path.join(raiz, "..", "contratos");
const RPC = "http://127.0.0.1:8545";

execSync("npx hardhat compile --quiet", { cwd: pastaContratos, stdio: "inherit" });
const no = spawn("npx", ["hardhat", "node", "--port", "8545"], { cwd: pastaContratos, shell: true });
await new Promise((resolve, reject) => {
    no.stdout.on("data", (d) => String(d).includes("Started HTTP") && resolve());
    no.on("exit", (codigo) => reject(new Error(`O no Hardhat nao iniciou (${codigo}). A porta 8545 esta livre?`)));
});

const provedor = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
const artefato = JSON.parse(readFileSync(
    path.join(pastaContratos, "artifacts", "contracts", "KmChainRegistryV2.sol", "KmChainRegistryV2.json"), "utf8"
));
const contrato = await new ContractFactory(artefato.abi, artefato.bytecode, new Wallet(CHAVES_HARDHAT[0], provedor)).deploy(ZeroAddress);
await contrato.waitForDeployment();
const endereco = await contrato.getAddress();
provedor.destroy();

// O que a aplicacao le; vale mais que o .env e o .env.local.
Object.assign(process.env, {
    DATABASE_URL: "pglite:memoria",
    RPC_URL: RPC,
    KMCHAIN_ENDERECO: endereco,
    VITE_RPC_URL: RPC,
    VITE_CHAIN_ID: "31337",
    VITE_KMCHAIN_ENDERECO: endereco,
    VITE_EXPLORER: "http://localhost:5173/#sem-explorador-local",
    SESSION_SECRET: process.env.SESSION_SECRET_LOCAL ?? "segredo-apenas-do-ambiente-local"
});

const servidor = await createServer({ root: raiz, server: { port: 5173, strictPort: true } });
await servidor.listen();

console.log(`
Ambiente local no ar.
  Aplicacao ......... http://localhost:5173
  Blockchain ........ ${RPC} (chainId 31337)
  Contrato .......... ${endereco}
  Banco ............. em memoria (vazio)
Proximo passo, em outro terminal:  npm run demo:preparar
Ctrl+C encerra e descarta tudo.`);

function encerrar() {
    if (process.platform === "win32") {
        try { execSync(`taskkill /PID ${no.pid} /T /F`, { stdio: "ignore" }); } catch { /* ja encerrado */ }
    } else {
        no.kill();
    }
    process.exit(0);
}
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
