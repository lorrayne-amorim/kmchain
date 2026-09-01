const { expect } = require("chai");
const { ethers } = require("hardhat");

const CHASSI = "9BWZZZ377VT004251";          // 17 caracteres
const DOC = "0x" + "ab".repeat(32);           // hash ficticio de documento
const VAZIO = ethers.ZeroHash;
const UM_DIA = 24 * 60 * 60;

describe("KmChainRegistry", function () {
    let contrato, detran, oficina, intruso;

    beforeEach(async function () {
        [detran, oficina, intruso] = await ethers.getSigners();
        const Fabrica = await ethers.getContractFactory("KmChainRegistry");
        contrato = await Fabrica.deploy();
        await contrato.waitForDeployment();

        await contrato.grantRole(await contrato.OFICINA_ROLE(), oficina.address);
        await contrato.cadastrarVeiculo(CHASSI, "ABC1D23", "Gol 1.6", 2018, 50000, DOC);
    });

    // --------------------------------------------------------------- cadastro
    it("cadastra o veiculo com a leitura inicial", async function () {
        const v = await contrato.getVeiculo(CHASSI);
        expect(v.cadastrado).to.equal(true);
        expect(v.ultimaKm).to.equal(50000n);
        expect(v.totalLeituras).to.equal(1);
    });

    it("normaliza o chassi digitado em minusculas", async function () {
        const v = await contrato.getVeiculo(CHASSI.toLowerCase());
        expect(v.cadastrado).to.equal(true);
    });

    // ---------------------------------------------------- validacao incremental
    it("aceita leitura maior que a ultima registrada", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50800, 2, DOC, false);
        const v = await contrato.getVeiculo(CHASSI);
        expect(v.ultimaKm).to.equal(50800n);
        expect(v.totalLeituras).to.equal(2);
    });

    it("REJEITA tentativa de rollback de hodometro", async function () {
        await expect(
            contrato.connect(oficina).registrarLeitura(CHASSI, 40000, 2, DOC, false)
        ).to.be.revertedWithCustomError(contrato, "QuilometragemRegressiva");
    });

    // -------------------------------------------------------- controle de acesso
    it("REJEITA registro de entidade nao credenciada", async function () {
        await expect(
            contrato.connect(intruso).registrarLeitura(CHASSI, 50500, 1, DOC, false)
        ).to.be.revertedWithCustomError(contrato, "EntidadeNaoAutorizada");
    });

    it("REJEITA leitura para veiculo nao cadastrado", async function () {
        await expect(
            contrato.connect(oficina).registrarLeitura("9BWZZZ377VT009999", 10, 1, DOC, false)
        ).to.be.revertedWithCustomError(contrato, "VeiculoNaoCadastrado");
    });

    // ------------------------------------------------------- limite de sanidade
    it("REJEITA salto implausivel sem confirmacao (erro de digitacao)", async function () {
        await expect(
            contrato.connect(oficina).registrarLeitura(CHASSI, 500000, 2, DOC, false)
        ).to.be.revertedWithCustomError(contrato, "LeituraAtipica");
    });

    it("aceita salto confirmado e o marca como atipico", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 53000, 2, DOC, true);
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].atipica).to.equal(true);
        const r = await contrato.conformidade(CHASSI);
        expect(r.possuiAtipicas).to.equal(true);
    });

    it("respeita o limite maior definido para um veiculo de frota", async function () {
        await contrato.definirLimiteDoVeiculo(CHASSI, 3000);
        // sem confirmacao, e com o limite ampliado, o mesmo avanco passa
        await contrato.connect(oficina).registrarLeitura(CHASSI, 52500, 2, DOC, false);
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].atipica).to.equal(false);
    });

    it("acumula o limite ao longo dos dias decorridos", async function () {
        await ethers.provider.send("evm_increaseTime", [10 * UM_DIA]);
        await ethers.provider.send("evm_mine", []);
        // 10 dias x 1000 km = 10.000 km de folga, sem confirmacao
        await contrato.connect(oficina).registrarLeitura(CHASSI, 59500, 2, DOC, false);
        const v = await contrato.getVeiculo(CHASSI);
        expect(v.ultimaKm).to.equal(59500n);
    });

    // -------------------------------------------------------------- correcao
    it("permite ao DETRAN corrigir uma leitura equivocada", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 600000, 2, DOC, true);

        await contrato.corrigirLeitura(CHASSI, 1, 60000, DOC);

        const v = await contrato.getVeiculo(CHASSI);
        expect(v.ultimaKm).to.equal(60000n);      // referencia volta ao valor correto
        expect(v.totalCorrecoes).to.equal(1);

        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].contestada).to.equal(true);   // a leitura errada continua no historico
        expect(h[1].quilometragem).to.equal(600000n);
        expect(h[2].tipo).to.equal(5n);           // CORRECAO
    });

    it("desbloqueia o veiculo apos a correcao", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 600000, 2, DOC, true);
        await contrato.corrigirLeitura(CHASSI, 1, 60000, DOC);

        // antes da correcao, esta leitura seria recusada como regressiva
        await contrato.connect(oficina).registrarLeitura(CHASSI, 60400, 2, DOC, false);
        const v = await contrato.getVeiculo(CHASSI);
        expect(v.ultimaKm).to.equal(60400n);
    });

    it("REJEITA correcao feita por oficina", async function () {
        await expect(
            contrato.connect(oficina).corrigirLeitura(CHASSI, 0, 10, DOC)
        ).to.be.revertedWithCustomError(contrato, "AccessControlUnauthorizedAccount");
    });

    it("REJEITA corrigir duas vezes a mesma leitura", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 600000, 2, DOC, true);
        await contrato.corrigirLeitura(CHASSI, 1, 60000, DOC);
        await expect(
            contrato.corrigirLeitura(CHASSI, 1, 61000, DOC)
        ).to.be.revertedWithCustomError(contrato, "LeituraJaContestada");
    });

    // ------------------------------------------------------------ conformidade
    it("marca como nao conforme quando falta comprovante", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50800, 2, VAZIO, false);
        const r = await contrato.conformidade(CHASSI);
        expect(r.conforme).to.equal(false);
    });

    it("mantem o historico completo e ordenado", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50800, 2, DOC, false);
        await contrato.connect(oficina).registrarLeitura(CHASSI, 51500, 1, DOC, false);
        const h = await contrato.getHistorico(CHASSI);
        expect(h.length).to.equal(3);
        expect(h[2].quilometragem).to.equal(51500n);
    });
});