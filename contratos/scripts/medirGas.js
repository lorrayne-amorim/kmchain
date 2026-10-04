// Mede o gas real de cada operacao na Sepolia e projeta o custo na mainnet.
// Quem roda precisa ser do DETRAN no contrato (cadastro e correcao).
// Uso: npx hardhat run scripts/medirGas.js --network sepolia
const { ethers } = require("hardhat");
const { endereco } = require("../../web/src/lib/endereco.json");

const PRECO_GAS_GWEI = 8;      // ajuste com o valor observado no Etherscan
const ETH_EM_REAIS = 18000;    // ajuste na data da analise
const CHASSI = "9BWZZZ377VT00" + Math.floor(1000 + Math.random() * 8999);
const CHAVE = ethers.keccak256(ethers.toUtf8Bytes(CHASSI));
const DOC = "0x" + "cd".repeat(32);
const MUNICIPIO = 3205309; // Vitoria - ES
const VISTORIA_DETRAN = 2;

async function main() {
    const contrato = await ethers.getContractAt("KmChainRegistryV2", endereco);
    const agora = async () => (await ethers.provider.getBlock("latest")).timestamp;
    const medidas = [];

    let tx = await contrato.cadastrarVeiculo(CHAVE, 30000, await agora(), MUNICIPIO, DOC);
    medidas.push(["cadastrarVeiculo", (await tx.wait()).gasUsed]);

    // avanco acima do limite diario no mesmo dia: confirma como atipico
    tx = await contrato.registrarEvento(CHAVE, 45000, VISTORIA_DETRAN, await agora(), MUNICIPIO, DOC, true);
    medidas.push(["registrarEvento (com documento)", (await tx.wait()).gasUsed]);

    tx = await contrato.registrarEvento(CHAVE, 45500, VISTORIA_DETRAN, await agora(), MUNICIPIO, ethers.ZeroHash, false);
    medidas.push(["registrarEvento (sem documento)", (await tx.wait()).gasUsed]);

    tx = await contrato.corrigirLeitura(CHAVE, 2, 45400, await agora(), MUNICIPIO, ethers.ZeroHash);
    medidas.push(["corrigirLeitura", (await tx.wait()).gasUsed]);

    console.log("\nOperacao | gas | custo estimado na mainnet");
    for (const [nome, gas] of medidas) {
        const eth = Number(gas) * PRECO_GAS_GWEI * 1e-9;
        console.log(`${nome} | ${gas} | ${eth.toFixed(6)} ETH | R$ ${(eth * ETH_EM_REAIS).toFixed(2)}`);
    }
    console.log("\nConsulta (getHistorico): 0 gas - e uma chamada de leitura.");
}

main().catch(console.error);
