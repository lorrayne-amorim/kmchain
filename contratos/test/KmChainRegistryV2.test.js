// Testes da PROPOSTA v2 (nao implantada). Dados ficticios.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const path = require("path");
const { pathToFileURL } = require("url");

const CHASSI = "9BWZZZ377VT004251";
// A MESMA regra de chave usada pela tela e pelas rotas /api.
const importarRegraDoChassi = () =>
    import(pathToFileURL(path.join(__dirname, "..", "..", "web", "src", "lib", "chassi.js")).href);
const ORIGEM = { ORGAO_TRANSITO: 1, VISTORIA: 2, OFICINA: 3, REVENDA: 4, INSPECAO: 5, SEGURADORA: 6, LEILOEIRA: 7, FROTA: 8 };
const TIPO = {
    CADASTRO_INICIAL: 0, VISTORIA_IDENTIFICACAO: 1, VISTORIA_CAUTELAR: 2, INSPECAO_SEGURANCA: 3,
    REVISAO_MANUTENCAO: 4, AVALIACAO_COMERCIAL: 5, MOVIMENTACAO_ESTOQUE: 6, VISTORIA_SEGURO: 7,
    CONTROLE_FROTA: 8, CORRECAO: 9
};
const UM_DIA = 24 * 60 * 60;

// Compromisso da evidencia: keccak256(sha256(documento), sal).
function compromisso(documento, sal) {
    return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [ethers.sha256(documento), sal]);
}

describe("KmChainRegistryV2 (proposta)", function () {
    let c, admin, orgao, oficina, revenda, intruso, regra, CHAVE;
    const agora = async () => BigInt(await time.latest());

    before(async function () {
        regra = await importarRegraDoChassi();
        CHAVE = regra.chaveDoChassi(CHASSI);
    });

    beforeEach(async function () {
        [admin, orgao, oficina, revenda, intruso] = await ethers.getSigners();
        c = await (await ethers.getContractFactory("KmChainRegistryV2")).deploy(ethers.ZeroAddress);
        await c.grantRole(await c.ORGAO_TRANSITO_ROLE(), orgao.address);
        await c.grantRole(await c.OFICINA_ROLE(), oficina.address);
        await c.grantRole(await c.REVENDA_ROLE(), revenda.address);
        await c.connect(orgao).cadastrarVeiculo(CHAVE, 50000, await agora(), ethers.ZeroHash);
    });

    it("guarda tipo, origem na epoca, data do bloco e data da observacao", async function () {
        await time.increase(3 * UM_DIA);
        const observacao = (await agora()) - 3600n;
        await c.connect(oficina).registrarLeitura(CHAVE, 50800, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, observacao, ethers.ZeroHash, false);
        const l = (await c.getHistorico(CHAVE))[1];
        expect(l.tipo).to.equal(TIPO.REVISAO_MANUTENCAO);
        expect(l.origem).to.equal(ORIGEM.OFICINA);
        expect(l.dataObservacao).to.equal(observacao);
        expect(l.dataBloco).to.be.greaterThan(observacao);
    });

    it("a origem gravada nao muda quando a credencial e revogada", async function () {
        await c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false);
        await c.revokeRole(await c.OFICINA_ROLE(), oficina.address);
        expect((await c.getHistorico(CHAVE))[1].origem).to.equal(ORIGEM.OFICINA);
        await expect(
            c.connect(oficina).registrarLeitura(CHAVE, 50400, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "OrigemNaoAutorizada");
    });

    it("matriz de permissoes: oficina nao faz vistoria de identificacao; revenda faz avaliacao", async function () {
        await expect(
            c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.VISTORIA_IDENTIFICACAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
        await c.connect(revenda).registrarLeitura(CHAVE, 50300, TIPO.AVALIACAO_COMERCIAL, ORIGEM.REVENDA, await agora(), ethers.ZeroHash, false);
    });

    it("nao aceita declarar uma origem que a carteira nao tem", async function () {
        await expect(
            c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.AVALIACAO_COMERCIAL, ORIGEM.REVENDA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "OrigemNaoAutorizada");
        await expect(
            c.connect(intruso).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "OrigemNaoAutorizada");
    });

    it("CADASTRO_INICIAL e CORRECAO nunca entram por registrarLeitura (corrige limitacao da v1)", async function () {
        for (const tipo of [TIPO.CADASTRO_INICIAL, TIPO.CORRECAO]) {
            await expect(
                c.connect(orgao).registrarLeitura(CHAVE, 50300, tipo, ORIGEM.ORGAO_TRANSITO, await agora(), ethers.ZeroHash, false)
            ).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
        }
        // nem o admin consegue liberar esses tipos pela matriz
        await c.definirTiposPermitidos(ORIGEM.OFICINA, (1n << 0n) | (1n << 9n) | (1n << 4n));
        expect(await c.tiposPermitidos(ORIGEM.OFICINA)).to.equal(1n << 4n);
    });

    it("recusa data de observacao futura, muito antiga ou anterior a ultima", async function () {
        const t = await agora();
        const tentar = (obs) => c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, obs, ethers.ZeroHash, false);
        await expect(tentar(t + 3600n)).to.be.revertedWithCustomError(c, "DataObservacaoInvalida");
        await time.increase(40 * UM_DIA);
        await expect(tentar(t - 1n)).to.be.revertedWithCustomError(c, "DataObservacaoInvalida");
        await expect(tentar((await agora()) - 31n * BigInt(UM_DIA))).to.be.revertedWithCustomError(c, "DataObservacaoInvalida");
    });

    it("mantem as regras da v1: sem retrocesso e com confirmacao de salto atipico", async function () {
        await expect(
            c.connect(oficina).registrarLeitura(CHAVE, 40000, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "QuilometragemRegressiva");
        await expect(
            c.connect(oficina).registrarLeitura(CHAVE, 90000, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false)
        ).to.be.revertedWithCustomError(c, "LeituraAtipica");
        await c.connect(oficina).registrarLeitura(CHAVE, 90000, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, true);
        expect((await c.getHistorico(CHAVE))[1].atipica).to.equal(true);
    });

    it("correcao: so orgao de transito, preserva a original e herda a data de observacao", async function () {
        const obs = await agora();
        await c.connect(oficina).registrarLeitura(CHAVE, 500000, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, obs, ethers.ZeroHash, true);
        await expect(c.connect(oficina).corrigirLeitura(CHAVE, 1, 50500, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "AccessControlUnauthorizedAccount");
        await c.connect(orgao).corrigirLeitura(CHAVE, 1, 50500, ethers.ZeroHash);
        const h = await c.getHistorico(CHAVE);
        expect(h[1].contestada).to.equal(true);
        expect(h[2].tipo).to.equal(TIPO.CORRECAO);
        expect(h[2].dataObservacao).to.equal(obs);
        expect((await c.getVeiculo(CHAVE)).ultimaKm).to.equal(50500n);
        const r = await c.resumo(CHAVE);
        expect(r.correcoes).to.equal(1n);
        expect(r.contestadas).to.equal(1n);
    });

    it("compromisso da evidencia: confere com documento e sal, nao so com o documento", async function () {
        const doc = ethers.toUtf8Bytes("%PDF-1.4 laudo ficticio");
        const sal = ethers.hexlify(ethers.randomBytes(32));
        await c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), compromisso(doc, sal), false);
        const gravado = (await c.getHistorico(CHAVE))[1].compromisso;
        expect(compromisso(doc, sal)).to.equal(gravado);
        expect(ethers.sha256(doc)).to.not.equal(gravado); // o hash do documento sozinho nao confirma nada
        expect(compromisso(ethers.toUtf8Bytes("%PDF-1.4 laudo ficticiO"), sal)).to.not.equal(gravado);
    });

    it("custa menos gas por leitura que a v1", async function () {
        const v1 = await (await ethers.getContractFactory("KmChainRegistry")).deploy();
        await v1.grantRole(await v1.OFICINA_ROLE(), oficina.address);
        await v1.cadastrarVeiculo(CHASSI, "Modelo Ficticio", 2018, 50000, ethers.ZeroHash);
        const doc = ethers.hexlify(ethers.randomBytes(32));

        const g1 = (await (await v1.connect(oficina).registrarLeitura(CHASSI, 50300, 2, doc, false)).wait()).gasUsed;
        const g2 = (await (await c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), doc, false)).wait()).gasUsed;
        console.log(`        gas registrarLeitura: v1 ${g1} | v2 ${g2}`);
        expect(g2).to.be.lessThan(g1);
    });
    // ------------------------------------------------ chave derivada do chassi
    it("cadastro, leitura, correcao e consulta usam a mesma chave, mesmo com o chassi em minusculas", async function () {
        const digitado = "9bwzz z377-vt004252"; // minusculas, espaco e hifen, como alguem copiaria
        const chave = regra.chaveDoChassi(digitado);
        expect(chave).to.equal(regra.chaveDoChassi("9BWZZZ377VT004252"));
        // compativel com a regra do contrato em uso (v1)
        const v1 = await (await ethers.getContractFactory("KmChainRegistry")).deploy();
        expect(await v1.chaveDoChassi("9BWZZZ377VT004252")).to.equal(chave);

        await c.connect(orgao).cadastrarVeiculo(regra.chaveDoChassi(digitado), 1000, await agora(), ethers.ZeroHash);
        await c.connect(oficina).registrarLeitura(regra.chaveDoChassi(digitado.toUpperCase()), 1200, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false);
        await c.connect(orgao).corrigirLeitura(regra.chaveDoChassi(" 9BWZZZ377VT004252 "), 1, 1150, ethers.ZeroHash);

        const h = await c.getHistorico(regra.chaveDoChassi("9bwzzz377vt004252"));
        expect(h.map((l) => l.km)).to.deep.equal([1000n, 1200n, 1150n]);
        expect((await c.getVeiculo(chave)).ultimaKm).to.equal(1150n);
    });

    it("o chassi nao aparece no calldata nem nos logs de nenhuma transacao", async function () {
        const hexDe = (texto) => Buffer.from(texto, "utf8").toString("hex");
        const proibidos = [CHASSI, CHASSI.toLowerCase()].map(hexDe);
        const txs = [
            await c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false),
            await c.connect(orgao).corrigirLeitura(CHAVE, 1, 50200, ethers.ZeroHash),
            await c.connect(orgao).cadastrarVeiculo(regra.chaveDoChassi("9BWZZZ377VT004253"), 10, await agora(), ethers.ZeroHash)
        ];
        for (const tx of txs) {
            const recibo = await tx.wait();
            const bruto = (tx.data + recibo.logs.map((l) => l.data + l.topics.join("")).join("")).toLowerCase();
            for (const p of proibidos) expect(bruto).to.not.include(p);
        }
        // contraste: na v1 o chassi vai em texto no calldata
        const v1 = await (await ethers.getContractFactory("KmChainRegistry")).deploy();
        const tx1 = await v1.cadastrarVeiculo(CHASSI, "Modelo", 2018, 1, ethers.ZeroHash);
        expect(tx1.data.toLowerCase()).to.include(hexDe(CHASSI));
    });

    it("chassi invalido e recusado antes de virar chave; chave vazia e recusada pelo contrato", async function () {
        expect(() => regra.chaveDoChassi("9BWZZZ377VT00425")).to.throw();      // 16 caracteres
        expect(() => regra.chaveDoChassi("9BWZZZ377VT0O4251")).to.throw();     // letra O
        await expect(
            c.connect(orgao).cadastrarVeiculo(ethers.ZeroHash, 10, await agora(), ethers.ZeroHash)
        ).to.be.revertedWithCustomError(c, "ChaveInvalida");
    });

    it("eventos so levam a chave e o indice", async function () {
        const tx = await c.connect(oficina).registrarLeitura(CHAVE, 50300, TIPO.REVISAO_MANUTENCAO, ORIGEM.OFICINA, await agora(), ethers.ZeroHash, false);
        const log = (await tx.wait()).logs.map((l) => c.interface.parseLog(l)).find((e) => e?.name === "LeituraRegistrada");
        expect(log.args.length).to.equal(2);
        expect(log.args.chave).to.equal(CHAVE);
        expect(log.args.indice).to.equal(1n);
    });
});
