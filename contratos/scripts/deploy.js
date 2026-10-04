// Implanta o KmChainRegistryV2 e exporta ABI e endereco para a aplicacao.
// Uso: npx hardhat run scripts/deploy.js --network sepolia
const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

const destino = path.join(__dirname, "..", "..", "web", "src", "lib");

// Contrato da primeira versao do prototipo (KmChainRegistry) na Sepolia. Fica
// gravado no contrato novo so como referencia historica: a aplicacao nao o le.
const VERSAO_ANTERIOR = { sepolia: "0x8BcAB5232FFa571B802ac444E5Aba43f7333c49C" };

async function main() {
    const [conta] = await ethers.getSigners();
    console.log("Rede:", network.name, "| conta:", conta.address);

    const Fabrica = await ethers.getContractFactory("KmChainRegistryV2");
    const contrato = await Fabrica.deploy(VERSAO_ANTERIOR[network.name] ?? ethers.ZeroAddress);
    await contrato.waitForDeployment();

    const endereco = await contrato.getAddress();
    const recibo = await contrato.deploymentTransaction().wait();
    console.log("Contrato:", endereco);
    console.log("Gas do deploy:", recibo.gasUsed.toString());
    console.log("A conta que implantou e a administradora do DETRAN (organizacao 1).");

    fs.mkdirSync(destino, { recursive: true });
    const artefato = await artifacts.readArtifact("KmChainRegistryV2");
    fs.writeFileSync(path.join(destino, "KmChainRegistryV2.abi.json"), JSON.stringify(artefato.abi, null, 2));
    fs.writeFileSync(path.join(destino, "endereco.json"), JSON.stringify({ endereco, rede: network.name }, null, 2) + "\n");
    console.log("ABI e endereco exportados para web/src/lib/");
}

main().catch((erro) => {
    console.error(erro);
    process.exit(1);
});
