// Testes do KmChainRegistryV2. Dados ficticios.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const path = require("path");
const { pathToFileURL } = require("url");

const CHASSI = "9BWZZZ377VT004251";
// As MESMAS regras usadas pela tela e pelas rotas /api.
const importarDaWeb = (arquivo) =>
    import(pathToFileURL(path.join(__dirname, "..", "..", "web", "src", "lib", arquivo)).href);

const ORG = { DETRAN: 1, OFICINA: 2, VISTORIA: 3, SEGURADORA: 4 };
const TIPO = {
    CADASTRO_INICIAL: 0, CORRECAO: 1, VISTORIA_DETRAN: 2, TRANSFERENCIA_PROPRIEDADE: 3,
    REVISAO: 10, MANUTENCAO: 11, VISTORIA_TRANSFERENCIA: 20, VISTORIA_SEGURADORA: 25, SEGURO_VISTORIA_PREVIA: 30
};
// Codigos IBGE dos municipios.
const CACHOEIRO = 3201209;
const VITORIA = 3205309;
const VILA_VELHA = 3205200;
const UM_DIA = 24 * 60 * 60;
const SEM_REFERENCIA = 2n ** 32n - 1n;

describe("KmChainRegistryV2", function () {
    let c, detran, adminOficina, mecanico, adminVistoria, adminSeguradora, intruso, outro, regra, catalogo, CHAVE;
    let idOficina, idVistoria, idSeguradora;
    const agora = async () => BigInt(await time.latest());

    // Credencia e devolve o identificador atribuido pelo contrato.
    async function credenciar(tipo, administrador) {
        await c.connect(detran).credenciarOrganizacao(tipo, administrador.address);
        return Number(await c.totalOrganizacoes());
    }

    const registrar = async (quem, km, tipo, opcoes = {}) =>
        c.connect(quem).registrarEvento(
            opcoes.chave ?? CHAVE, km, tipo, opcoes.data ?? await agora(), opcoes.municipio ?? CACHOEIRO,
            opcoes.documento ?? ethers.ZeroHash, opcoes.confirmar ?? false
        );

    before(async function () {
        regra = await importarDaWeb("chassi.js");
        catalogo = await importarDaWeb("eventos.js");
        CHAVE = regra.chaveDoChassi(CHASSI);
    });

    beforeEach(async function () {
        [detran, adminOficina, mecanico, adminVistoria, adminSeguradora, intruso, outro] = await ethers.getSigners();
        c = await (await ethers.getContractFactory("KmChainRegistryV2")).deploy(ethers.ZeroAddress);
        idOficina = await credenciar(ORG.OFICINA, adminOficina);
        idVistoria = await credenciar(ORG.VISTORIA, adminVistoria);
        idSeguradora = await credenciar(ORG.SEGURADORA, adminSeguradora);
        await c.connect(adminOficina).definirFuncionario(mecanico.address, true);
        await c.connect(detran).cadastrarVeiculo(CHAVE, 50000, await agora(), VITORIA, ethers.ZeroHash);
    });

    // -------------------------------------------------- modelo do evento
    it("guarda km, tipo, data do evento, data do bloco, municipio, organizacao e responsavel", async function () {
        await time.increase(3 * UM_DIA);
        const dataEvento = (await agora()) - 3600n;
        await registrar(mecanico, 50800, TIPO.REVISAO, { data: dataEvento });
        const e = await c.getEvento(CHAVE, 1);
        expect(e.km).to.equal(50800n);
        expect(e.tipo).to.equal(TIPO.REVISAO);
        expect(e.dataEvento).to.equal(dataEvento);
        expect(e.dataBloco).to.be.greaterThan(dataEvento);
        expect(e.municipio).to.equal(CACHOEIRO);
        expect(e.organizacao).to.equal(idOficina);
        expect(e.responsavel).to.equal(mecanico.address);
        expect(e.referencia).to.equal(SEM_REFERENCIA);
    });

    it("o cadastro inicial e do DETRAN e fica como evento 0", async function () {
        const e = await c.getEvento(CHAVE, 0);
        expect(e.tipo).to.equal(TIPO.CADASTRO_INICIAL);
        expect(e.organizacao).to.equal(1);
        expect(e.municipio).to.equal(VITORIA);
        await expect(c.connect(adminOficina).cadastrarVeiculo(regra.chaveDoChassi("9BWZZZ377VT004259"), 1, await agora(), VITORIA, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "ApenasDetran");
        await expect(c.connect(detran).cadastrarVeiculo(CHAVE, 1, await agora(), VITORIA, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "VeiculoJaCadastrado");
    });

    it("recusa municipio fora da faixa dos codigos IBGE", async function () {
        for (const municipio of [0, 999999, 5400000]) {
            await expect(registrar(mecanico, 50300, TIPO.REVISAO, { municipio }))
                .to.be.revertedWithCustomError(c, "MunicipioInvalido");
        }
    });

    it("recusa data do evento futura, muito antiga ou anterior ao ultimo evento", async function () {
        const t = await agora();
        await expect(registrar(mecanico, 50300, TIPO.REVISAO, { data: t + 3600n })).to.be.revertedWithCustomError(c, "DataDoEventoInvalida");
        await time.increase(40 * UM_DIA);
        await expect(registrar(mecanico, 50300, TIPO.REVISAO, { data: t - 1n })).to.be.revertedWithCustomError(c, "DataDoEventoInvalida");
        await expect(registrar(mecanico, 50300, TIPO.REVISAO, { data: (await agora()) - 31n * BigInt(UM_DIA) }))
            .to.be.revertedWithCustomError(c, "DataDoEventoInvalida");
    });

    it("mantem as regras da v1: sem retrocesso e com confirmacao de salto atipico", async function () {
        await expect(registrar(mecanico, 40000, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "QuilometragemRegressiva");
        await expect(registrar(mecanico, 90000, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "LeituraAtipica");
        await registrar(mecanico, 90000, TIPO.REVISAO, { confirmar: true });
        expect((await c.getEvento(CHAVE, 1)).atipica).to.equal(true);
    });

    // ------------------------------------------- permissoes por organizacao
    it("oficina registra revisao; nao registra vistoria de transferencia", async function () {
        await registrar(mecanico, 50300, TIPO.REVISAO);
        await expect(registrar(mecanico, 50400, TIPO.VISTORIA_TRANSFERENCIA)).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
    });

    it("vistoria registra vistoria de transferencia; nao registra revisao mecanica", async function () {
        await registrar(adminVistoria, 50300, TIPO.VISTORIA_TRANSFERENCIA, { municipio: VITORIA });
        await expect(registrar(adminVistoria, 50400, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
    });

    it("seguradora registra evento securitario; nao registra os de oficina e vistoria", async function () {
        await registrar(adminSeguradora, 50300, TIPO.SEGURO_VISTORIA_PREVIA, { municipio: VILA_VELHA });
        expect((await c.getEvento(CHAVE, 1)).organizacao).to.equal(idSeguradora);
        for (const tipo of [TIPO.REVISAO, TIPO.VISTORIA_TRANSFERENCIA]) {
            await expect(registrar(adminSeguradora, 50400, tipo)).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
        }
    });

    it("DETRAN registra os eventos institucionais proprios, nao os de outros atores", async function () {
        await registrar(detran, 50100, TIPO.VISTORIA_DETRAN);
        await registrar(detran, 50200, TIPO.TRANSFERENCIA_PROPRIEDADE);
        for (const tipo of [TIPO.REVISAO, TIPO.VISTORIA_TRANSFERENCIA, TIPO.SEGURO_VISTORIA_PREVIA]) {
            await expect(registrar(detran, 50300, tipo)).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
        }
    });

    it("cadastro e correcao nunca entram por registrarEvento, nem liberados na matriz", async function () {
        for (const tipo of [TIPO.CADASTRO_INICIAL, TIPO.CORRECAO]) {
            await expect(registrar(detran, 50300, tipo)).to.be.revertedWithCustomError(c, "TipoNaoPermitido");
        }
        await c.connect(detran).definirTiposPermitidos(ORG.OFICINA, (1n << 0n) | (1n << 1n) | (1n << 10n));
        expect(await c.tiposPermitidos(ORG.OFICINA)).to.equal(1n << 10n);
        await expect(c.connect(adminOficina).definirTiposPermitidos(ORG.OFICINA, 1n << 20n)).to.be.revertedWithCustomError(c, "ApenasDetran");
    });

    it("a matriz inicial do contrato e a do catalogo da aplicacao", async function () {
        for (const o of catalogo.ORGANIZACOES) {
            expect(await c.tiposPermitidos(o.codigo)).to.equal(catalogo.mascaraDeTipos(o.codigo));
        }
    });

    it("carteira sem vinculo nao registra", async function () {
        await expect(registrar(intruso, 50300, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "SemVinculoAtivo");
    });

    // ---------------------------------------- credenciamento e funcionarios
    it("so o DETRAN credencia; o identificador e sequencial e o administrador fica vinculado", async function () {
        await expect(c.connect(adminOficina).credenciarOrganizacao(ORG.OFICINA, outro.address)).to.be.revertedWithCustomError(c, "ApenasDetran");
        await expect(c.connect(detran).credenciarOrganizacao(ORG.DETRAN, outro.address)).to.be.revertedWithCustomError(c, "TipoDeOrganizacaoInvalido");
        expect([idOficina, idVistoria, idSeguradora]).to.deep.equal([2, 3, 4]);
        const o = await c.getOrganizacao(idOficina);
        expect(o.tipo).to.equal(ORG.OFICINA);
        expect(o.ativa).to.equal(true);
        expect(o.administrador).to.equal(adminOficina.address);
        const v = await c.vinculoDe(adminOficina.address);
        expect([Number(v.organizacao), Number(v.tipo), v.organizacaoAtiva, v.ativo, v.administrador]).to.deep.equal([idOficina, ORG.OFICINA, true, true, true]);
    });

    it("funcionario de organizacao suspensa nao registra; reativada, volta a registrar", async function () {
        await c.connect(detran).definirSituacaoDaOrganizacao(idOficina, false);
        await expect(registrar(mecanico, 50300, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "OrganizacaoInativa");
        await c.connect(detran).definirSituacaoDaOrganizacao(idOficina, true);
        await registrar(mecanico, 50300, TIPO.REVISAO);
        await expect(c.connect(adminOficina).definirSituacaoDaOrganizacao(idOficina, true)).to.be.revertedWithCustomError(c, "ApenasDetran");
        await expect(c.connect(detran).definirSituacaoDaOrganizacao(1, false)).to.be.revertedWithCustomError(c, "DetranNaoPodeSerSuspenso");
    });

    it("funcionario desativado nao registra; o evento anterior continua com a organizacao da epoca", async function () {
        await registrar(mecanico, 50300, TIPO.REVISAO);
        await c.connect(adminOficina).definirFuncionario(mecanico.address, false);
        await expect(registrar(mecanico, 50400, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "SemVinculoAtivo");
        const e = await c.getEvento(CHAVE, 1);
        expect(e.organizacao).to.equal(idOficina);
        expect(e.responsavel).to.equal(mecanico.address);
    });

    it("administrador so administra a propria organizacao", async function () {
        // mecanico e da oficina: o administrador da vistoria nao o desativa nem o toma
        await expect(c.connect(adminVistoria).definirFuncionario(mecanico.address, false)).to.be.revertedWithCustomError(c, "CarteiraDeOutraOrganizacao");
        await expect(c.connect(adminVistoria).definirFuncionario(mecanico.address, true)).to.be.revertedWithCustomError(c, "CarteiraDeOutraOrganizacao");
        // funcionario comum nao administra
        await expect(c.connect(mecanico).definirFuncionario(outro.address, true)).to.be.revertedWithCustomError(c, "ApenasAdministrador");
        await expect(c.connect(adminOficina).definirFuncionario(adminOficina.address, false)).to.be.revertedWithCustomError(c, "AdministradorNaoPodeSerDesativado");
    });

    it("DETRAN troca o administrador; o anterior deixa de administrar", async function () {
        await c.connect(detran).definirAdministrador(idOficina, outro.address);
        expect((await c.getOrganizacao(idOficina)).administrador).to.equal(outro.address);
        await expect(c.connect(adminOficina).definirFuncionario(intruso.address, true)).to.be.revertedWithCustomError(c, "ApenasAdministrador");
        await c.connect(outro).definirFuncionario(intruso.address, true);
        await expect(c.connect(adminOficina).definirAdministrador(idOficina, adminOficina.address)).to.be.revertedWithCustomError(c, "ApenasDetran");
        await expect(c.connect(detran).definirAdministrador(99, outro.address)).to.be.revertedWithCustomError(c, "OrganizacaoInexistente");
    });

    // --------------------------------------------------------------- correcao
    it("correcao: so o DETRAN; cria evento novo com referencia e nao altera o original", async function () {
        await registrar(mecanico, 500000, TIPO.REVISAO, { confirmar: true });
        const original = await c.getEvento(CHAVE, 1);
        await time.increase(2 * UM_DIA);

        const corrigir = (quem) => c.connect(quem).corrigirLeitura(CHAVE, 1, 50500, quem === detran ? dataCorrecao : original.dataEvento, VITORIA, ethers.ZeroHash);
        const dataCorrecao = await agora();
        await expect(corrigir(adminOficina)).to.be.revertedWithCustomError(c, "ApenasDetran");
        await expect(corrigir(detran)).to.emit(c, "LeituraCorrigida").withArgs(CHAVE, 1, 2);

        const h = await c.getHistorico(CHAVE);
        expect(h.length).to.equal(3);
        // o registro original continua identico, campo a campo
        expect(Array.from(h[1])).to.deep.equal(Array.from(original));
        expect(h[2].tipo).to.equal(TIPO.CORRECAO);
        expect(h[2].km).to.equal(50500n);
        expect(h[2].referencia).to.equal(1n);
        expect(h[2].dataEvento).to.equal(dataCorrecao);
        expect(h[2].municipio).to.equal(VITORIA);
        expect(h[2].organizacao).to.equal(1);
        expect(await c.correcaoDe(CHAVE, 1)).to.equal(2n);

        const v = await c.getVeiculo(CHAVE);
        expect(v.ultimaKm).to.equal(50500n);
        expect(v.totalCorrecoes).to.equal(1);
        await expect(c.connect(detran).corrigirLeitura(CHAVE, 1, 50400, await agora(), VITORIA, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "LeituraJaCorrigida");
        await expect(c.connect(detran).corrigirLeitura(CHAVE, 9, 50400, await agora(), VITORIA, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "IndiceInvalido");
    });

    it("apos a correcao o veiculo volta a aceitar a quilometragem real", async function () {
        await registrar(mecanico, 500000, TIPO.REVISAO, { confirmar: true });
        await expect(registrar(mecanico, 50700, TIPO.REVISAO)).to.be.revertedWithCustomError(c, "QuilometragemRegressiva");
        await c.connect(detran).corrigirLeitura(CHAVE, 1, 50500, await agora(), VITORIA, ethers.ZeroHash);
        await registrar(mecanico, 50700, TIPO.REVISAO);
    });

    // ------------------------------------------------------------- evidencia
    it("guarda exatamente o SHA-256 do comprovante", async function () {
        const documento = ethers.sha256(ethers.toUtf8Bytes("%PDF-1.4 laudo ficticio"));
        await registrar(mecanico, 50300, TIPO.REVISAO, { documento });
        expect((await c.getEvento(CHAVE, 1)).hashDocumento).to.equal(documento);
        expect(ethers.sha256(ethers.toUtf8Bytes("%PDF-1.4 laudo ficticiO"))).to.not.equal(documento);
    });

    // ------------------------------------------------ chave derivada do chassi
    it("cadastro, evento e consulta usam a mesma chave, mesmo com o chassi em minusculas", async function () {
        const digitado = "9bwzz z377-vt004252"; // minusculas, espaco e hifen, como alguem copiaria
        const chave = regra.chaveDoChassi(digitado);
        expect(chave).to.equal(regra.chaveDoChassi("9BWZZZ377VT004252"));
        // compativel com a regra do contrato anterior (v1)
        const v1 = await (await ethers.getContractFactory("KmChainRegistry")).deploy();
        expect(await v1.chaveDoChassi("9BWZZZ377VT004252")).to.equal(chave);

        await c.connect(detran).cadastrarVeiculo(chave, 1000, await agora(), VITORIA, ethers.ZeroHash);
        await registrar(mecanico, 1200, TIPO.REVISAO, { chave: regra.chaveDoChassi(digitado.toUpperCase()) });
        const h = await c.getHistorico(regra.chaveDoChassi("9bwzzz377vt004252"));
        expect(h.map((e) => e.km)).to.deep.equal([1000n, 1200n]);
    });

    it("o chassi nao aparece no calldata nem nos logs de nenhuma transacao", async function () {
        const hexDe = (texto) => Buffer.from(texto, "utf8").toString("hex");
        const proibidos = [CHASSI, CHASSI.toLowerCase()].map(hexDe);
        const txs = [
            await registrar(mecanico, 50300, TIPO.REVISAO),
            await c.connect(detran).corrigirLeitura(CHAVE, 1, 50200, await agora(), VITORIA, ethers.ZeroHash),
            await c.connect(detran).cadastrarVeiculo(regra.chaveDoChassi("9BWZZZ377VT004253"), 10, await agora(), VITORIA, ethers.ZeroHash)
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
        await expect(c.connect(detran).cadastrarVeiculo(ethers.ZeroHash, 10, await agora(), VITORIA, ethers.ZeroHash))
            .to.be.revertedWithCustomError(c, "ChaveInvalida");
    });

    it("o evento Solidity so leva a chave e o indice", async function () {
        const tx = await registrar(mecanico, 50300, TIPO.REVISAO);
        const log = (await tx.wait()).logs.map((l) => c.interface.parseLog(l)).find((e) => e?.name === "EventoRegistrado");
        expect(log.args.length).to.equal(2);
        expect(log.args.chave).to.equal(CHAVE);
        expect(log.args.indice).to.equal(1n);
    });

    it("custa menos gas por registro que a v1, mesmo guardando mais informacao", async function () {
        const v1 = await (await ethers.getContractFactory("KmChainRegistry")).deploy();
        await v1.grantRole(await v1.OFICINA_ROLE(), mecanico.address);
        await v1.cadastrarVeiculo(CHASSI, "Modelo Ficticio", 2018, 50000, ethers.ZeroHash);
        const doc = ethers.hexlify(ethers.randomBytes(32));

        const g1 = (await (await v1.connect(mecanico).registrarLeitura(CHASSI, 50300, 2, doc, false)).wait()).gasUsed;
        const g2 = (await (await registrar(mecanico, 50300, TIPO.REVISAO, { documento: doc })).wait()).gasUsed;
        console.log(`        gas por registro: v1 ${g1} | v2 ${g2}`);
        expect(g2).to.be.lessThan(g1);
    });
});
