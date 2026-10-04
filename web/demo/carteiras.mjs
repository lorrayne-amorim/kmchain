// Carteiras usadas na demonstracao: uma por conta do cenario (demo/cenario.mjs).
//
// Ambiente local: as contas de teste do Hardhat, cujas chaves sao publicas e
// conhecidas. Servem so no no local; nunca use fora dele.
//
// Sepolia: chaves proprias, guardadas em demo/carteiras.local (arquivo
// ignorado pelo git), criadas por `npm run demo:carteiras`. Quem apresenta
// importa essas chaves na MetaMask.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHAVES_HARDHAT = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356"
];

export const ARQUIVO_DE_CARTEIRAS = path.join(path.dirname(fileURLToPath(import.meta.url)), "carteiras.local");

// Ordem das contas: a primeira e a administradora do DETRAN, que tem de ser
// a carteira que implantou o contrato.
export const CONTAS = [
    "detran.admin", "detran.funcionario", "oficina.admin", "oficina.funcionario",
    "vistoria.admin", "vistoria.funcionario", "seguradora.admin", "seguradora.funcionario"
];

// { "detran.admin": chave, ... } para o ambiente pedido.
export function chavesDaDemonstracao(rede) {
    if (rede === "local") return Object.fromEntries(CONTAS.map((conta, i) => [conta, CHAVES_HARDHAT[i]]));
    if (!existsSync(ARQUIVO_DE_CARTEIRAS)) {
        throw new Error("Faltam as carteiras da demonstracao. Rode: npm run demo:carteiras");
    }
    const chaves = JSON.parse(readFileSync(ARQUIVO_DE_CARTEIRAS, "utf8"));
    const faltando = CONTAS.filter((conta) => !chaves[conta]);
    if (faltando.length > 0) throw new Error(`Faltam em demo/carteiras.local: ${faltando.join(", ")}`);
    return chaves;
}
