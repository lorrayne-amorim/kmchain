const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

async function main() {
    const [conta] = await ethers.getSigners();
    console.log("Rede:", network.name, "| conta:", conta.address);

    const Fabrica = await ethers.getContractFactory("KmChainRegistry");
    const contrato = await Fabrica.deploy();
    await contrato.waitForDeployment();

    const endereco = await contrato.getAddress();
    const recibo = await contrato.deploymentTransaction().wait();
    console.log("Contrato:", endereco);
    console.log("Gas do deploy:", recibo.gasUsed.toString());

    // exporta ABI e endereco para o front-end
    const artefato = await artifacts.readArtifact("KmChainRegistry");
    const destino = path.join(__dirname, "..", "..", "web", "src", "lib");
    fs.mkdirSync(destino, { recursive: true });
    fs.writeFileSync(
        path.join(destino, "KmChainRegistry.abi.json"),
        JSON.stringify(artefato.abi, null, 2)
    );
    fs.writeFileSync(
        path.join(destino, "endereco.json"),
        JSON.stringify({ endereco, rede: network.name }, null, 2)
    );
    console.log("ABI e endereco exportados para web/src/lib/");
}

main().catch((erro) => {
    console.error(erro);
    process.exit(1);
});