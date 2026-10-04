// Cria as carteiras da demonstracao na Sepolia e as guarda em
// demo/carteiras.local, que o git ignora. Quem apresenta importa as chaves
// na MetaMask. A carteira detran.admin NAO e criada aqui: ela e a que
// implanta o contrato (PRIVATE_KEY de contratos/.env), informada em
// DEMO_CHAVE_DETRAN ou lida daquele arquivo.
//
// Uso: npm run demo:carteiras   (nao sobrescreve um arquivo existente)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Wallet } from "ethers";
import { ARQUIVO_DE_CARTEIRAS, CONTAS } from "../demo/carteiras.mjs";

if (existsSync(ARQUIVO_DE_CARTEIRAS)) {
    console.log("demo/carteiras.local ja existe; nada foi alterado.");
    process.exit(0);
}

const envDosContratos = path.join(path.dirname(ARQUIVO_DE_CARTEIRAS), "..", "..", "contratos", ".env");
const chaveDoDeploy = process.env.DEMO_CHAVE_DETRAN
    ?? (existsSync(envDosContratos) ? readFileSync(envDosContratos, "utf8").match(/^PRIVATE_KEY=(.*)$/m)?.[1].trim() : null);
if (!chaveDoDeploy) throw new Error("Informe em DEMO_CHAVE_DETRAN a chave da carteira que implanta o contrato.");

const chaves = Object.fromEntries(CONTAS.map((conta) => [
    conta, conta === "detran.admin" ? (chaveDoDeploy.startsWith("0x") ? chaveDoDeploy : `0x${chaveDoDeploy}`) : Wallet.createRandom().privateKey
]));
writeFileSync(ARQUIVO_DE_CARTEIRAS, JSON.stringify(chaves, null, 2) + "\n");

console.log("Carteiras criadas em demo/carteiras.local (nao versionado). Enderecos:");
for (const conta of CONTAS) console.log(`  ${conta.padEnd(24)} ${new Wallet(chaves[conta]).address}`);
console.log("\nCada carteira precisa de um pouco de ETH de teste para as taxas (npm run demo:preparar -- --rede=sepolia --financiar).");
