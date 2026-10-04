// Credencia uma organizacao direto no contrato, sem passar pela tela.
// Serve para testes na rede: o fluxo normal e pelo painel do DETRAN, que
// tambem grava o cadastro da organizacao no banco.
// Uso: npx hardhat run scripts/credenciar.js --network sepolia
const { ethers } = require("hardhat");
const { endereco } = require("../../web/src/lib/endereco.json");

const ADMINISTRADOR = "0xCOLE_AQUI_A_CARTEIRA_DO_ADMINISTRADOR";
const TIPO = 2; // 2 = oficina, 3 = empresa de vistoria, 4 = seguradora

async function main() {
    const contrato = await ethers.getContractAt("KmChainRegistryV2", endereco);
    const tx = await contrato.credenciarOrganizacao(TIPO, ADMINISTRADOR);
    await tx.wait();
    console.log("Organizacao", (await contrato.totalOrganizacoes()).toString(), "credenciada | tx:", tx.hash);
}

main().catch(console.error);
