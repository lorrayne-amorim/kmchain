// Credencia uma oficina ou centro de vistoria na rede.
// Uso: npx hardhat run scripts/credenciar.js --network sepolia
const { ethers } = require("hardhat");
const { endereco } = require("../../web/src/lib/endereco.json");

const CARTEIRA = "0xCOLE_AQUI_A_CARTEIRA_DA_ENTIDADE";
const PAPEL = "OFICINA_ROLE"; // ou VISTORIA_ROLE

async function main() {
    const contrato = await ethers.getContractAt("KmChainRegistry", endereco);
    const papel = await contrato[PAPEL]();
    const tx = await contrato.grantRole(papel, CARTEIRA);
    await tx.wait();
    console.log(PAPEL, "concedido a", CARTEIRA, "| tx:", tx.hash);
}

main().catch(console.error);