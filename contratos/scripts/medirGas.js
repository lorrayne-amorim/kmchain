// Mede o gas real de cada operacao na Sepolia e projeta o custo na mainnet.
// Uso: npx hardhat run scripts/medirGas.js --network sepolia
const { ethers } = require("hardhat");
const { endereco } = require("../../web/src/lib/endereco.json");

const PRECO_GAS_GWEI = 8;      // ajuste com o valor observado no Etherscan
const ETH_EM_REAIS = 18000;    // ajuste na data da analise
const CHASSI = "9BWZZZ377VT00" + Math.floor(1000 + Math.random() * 8999);
const DOC = "0x" + "cd".repeat(32);

async function main() {
    const contrato = await ethers.getContractAt("KmChainRegistry", endereco);
    const medidas = [];

    let tx = await contrato.cadastrarVeiculo(CHASSI, "TST0A00", "Modelo Teste", 2020, 30000, DOC);
    medidas.push(["cadastrarVeiculo", (await tx.wait()).gasUsed]);

    tx = await contrato.registrarLeitura(CHASSI, 45000, 1, DOC);
    medidas.push(["registrarLeitura (com documento)", (await tx.wait()).gasUsed]);

    tx = await contrato.registrarLeitura(CHASSI, 46000, 2, ethers.ZeroHash);
    medidas.push(["registrarLeitura (sem documento)", (await tx.wait()).gasUsed]);

    console.log("\nOperacao | gas | custo estimado na mainnet");
    for (const [nome, gas] of medidas) {
        const eth = Number(gas) * PRECO_GAS_GWEI * 1e-9;
        console.log(`${nome} | ${gas} | ${eth.toFixed(6)} ETH | R$ ${(eth * ETH_EM_REAIS).toFixed(2)}`);
    }
    console.log("\nConsulta (getHistorico): 0 gas - e uma chamada de leitura.");
}

main().catch(console.error);