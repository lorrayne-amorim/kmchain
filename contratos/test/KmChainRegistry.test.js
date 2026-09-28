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
        await contrato.cadastrarVeiculo(CHASSI, "Gol 1.6", 2018, 50000, DOC);
    });

    // --------------------------------------------------------------- cadastro
    it("cadastra o veiculo com a leitura inicial", async function () {
        const v = await contrato.getVeiculo(CHASSI);
        expect(v.cadastrado).to.equal(true);
        expect(v.ultimaKm).to.equal(50000n);
        expect(v.totalLeituras).to.equal(1);
    });

    it("nao guarda a placa em cadeia", async function () {
        const v = await contrato.getVeiculo(CHASSI);
        expect(v).to.not.have.property("placa");
        expect(v.modelo).to.equal("Gol 1.6");
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

    // ------------------------------------------------ credenciamento e revogacao
    it("REJEITA leitura de carteira cuja credencial foi revogada", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50500, 2, DOC, false);
        await contrato.revokeRole(await contrato.OFICINA_ROLE(), oficina.address);
        await expect(
            contrato.connect(oficina).registrarLeitura(CHASSI, 50900, 2, DOC, false)
        ).to.be.revertedWithCustomError(contrato, "EntidadeNaoAutorizada");
        // a leitura feita antes da revogacao continua no historico
        expect((await contrato.getHistorico(CHASSI)).length).to.equal(2);
    });

    it("so o admin concede papeis; uma carteira DETRAN nao credencia outras", async function () {
        const [, , , outroDetran, candidata] = await ethers.getSigners();
        await contrato.grantRole(await contrato.DETRAN_ROLE(), outroDetran.address);
        await expect(
            contrato.connect(outroDetran).grantRole(await contrato.OFICINA_ROLE(), candidata.address)
        ).to.be.revertedWithCustomError(contrato, "AccessControlUnauthorizedAccount");
    });

    // ------------------------------------------------------------- evidencia
    it("guarda exatamente o SHA-256 do comprovante e o expoe no historico", async function () {
        const arquivo = ethers.toUtf8Bytes("%PDF-1.4 laudo ficticio");
        const hash = ethers.sha256(arquivo);
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50500, 1, hash, false);
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].hashDocumento).to.equal(hash);
        // um arquivo alterado em um byte produz outro hash, que nao confere
        const alterado = ethers.toUtf8Bytes("%PDF-1.4 laudo ficticiO");
        expect(ethers.sha256(alterado)).to.not.equal(h[1].hashDocumento);
    });

    it("a correcao preserva a leitura original e registra quem corrigiu", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 500000, 2, DOC, true);
        await expect(contrato.corrigirLeitura(CHASSI, 1, 50600, DOC))
            .to.emit(contrato, "LeituraCorrigida")
            .withArgs(await contrato.chaveDoChassi(CHASSI), 1, 500000, 50600, detran.address);
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].quilometragem).to.equal(500000n);
        expect(h[1].contestada).to.equal(true);
        expect(h[2].tipo).to.equal(5);
        expect((await contrato.getVeiculo(CHASSI)).ultimaKm).to.equal(50600n);
    });

    // ------------------------------------------------- limitacoes documentadas
    // Estes testes registram o comportamento ATUAL do contrato implantado, que
    // a proposta de evolucao corrige. Se o contrato mudar, eles devem mudar.
    it("LIMITACAO: registrarLeitura aceita os tipos CADASTRO e CORRECAO de qualquer credenciada", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50500, 5, DOC, false); // CORRECAO
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50600, 0, DOC, false); // CADASTRO
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].tipo).to.equal(5);
        expect(h[1].entidade).to.equal(oficina.address);
        expect(h[2].tipo).to.equal(0);
        // nao conta como correcao real: nenhuma leitura foi contestada
        expect((await contrato.getVeiculo(CHASSI)).totalCorrecoes).to.equal(0);
    });

    it("LIMITACAO: o contrato nao guarda a funcao da carteira no momento do registro", async function () {
        await contrato.connect(oficina).registrarLeitura(CHASSI, 50500, 2, DOC, false);
        await contrato.revokeRole(await contrato.OFICINA_ROLE(), oficina.address);
        const h = await contrato.getHistorico(CHASSI);
        expect(Object.keys(h[1].toObject())).to.not.include("papel");
        expect(await contrato.hasRole(await contrato.OFICINA_ROLE(), oficina.address)).to.equal(false);
    });

    it("LIMITACAO: a data gravada e a do bloco, nao a da observacao do hodometro", async function () {
        await ethers.provider.send("evm_increaseTime", [10 * UM_DIA]);
        const tx = await contrato.connect(oficina).registrarLeitura(CHASSI, 50500, 1, DOC, false);
        const bloco = await ethers.provider.getBlock((await tx.wait()).blockNumber);
        const h = await contrato.getHistorico(CHASSI);
        expect(h[1].data).to.equal(BigInt(bloco.timestamp));
    });
});
