// kmchain/contratos/scripts/checar.js
// Diagnostico de ambiente: confirma rede, conta e saldo antes do deploy.
// Uso: npx hardhat run scripts/checar.js --network sepolia
const { ethers, network } = require("hardhat");

async function main() {
    const rede = await ethers.provider.getNetwork();
    const [conta] = await ethers.getSigners();
    const saldo = await ethers.provider.getBalance(conta.address);

    console.log("--------------------------------------------");
    console.log("Rede configurada :", network.name);
    console.log("chainId da URL   :", rede.chainId.toString());
    console.log("Conta            :", conta.address);
    console.log("Saldo            :", ethers.formatEther(saldo), "ETH");
    console.log("--------------------------------------------");

    if (rede.chainId !== 11155111n) {
        console.log("PROBLEMA: esta URL nao e da Sepolia (deveria ser 11155111).");
        console.log("Refaca o app na Alchemy escolhendo Ethereum > Sepolia.");
        return;
    }

    if (saldo === 0n) {
        console.log("PROBLEMA: a rede esta certa, mas a conta nao tem ETH de teste.");
        console.log("Confira no explorador:");
        console.log("https://sepolia.etherscan.io/address/" + conta.address);
        return;
    }

    console.log("Tudo certo. Pode rodar o deploy.");
}

main().catch((erro) => {
    console.error(erro);
    process.exit(1);
});