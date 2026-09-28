// Testes de integracao das rotas /api: autorizacao em duas camadas,
// respostas de erro sem detalhe interno, registro privado conferido na
// transacao e politica de acesso aos comprovantes.
// Rodar: npm test (sobe um no Hardhat local; nada vai para a Sepolia).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Wallet, ZeroHash, id } from "ethers";
import {
    CHAVES, chamar, configurarSegredos, cpfFicticio, iniciarBanco, iniciarBlockchain,
    lerArtefato, pararBlockchain, simularIpfs
} from "./ambiente.mjs";

configurarSegredos();
const { definirExecutor, bd } = await import("../api/_db.js");
const { criarToken } = await import("../api/_sessao.js");
const { mensagemAlteracao, mensagemContas, mensagemDocumento, mensagemPrivado, mensagemVinculo } = await import("../src/lib/mensagens.js");
const { chaveDoChassi, chassiDoLink, linkConsulta, normalizarChassi } = await import("../src/lib/chassi.js");
const pendentes = (await import("../api/auth/pendentes.js")).default;
const vincular = (await import("../api/auth/vincular-carteira.js")).default;
const registrar = (await import("../api/privado/registrar.js")).default;
const consultar = (await import("../api/privado/consultar.js")).default;
const validarCadastroRota = (await import("../api/privado/validar-cadastro.js")).default;
const alterarRota = (await import("../api/privado/alterar.js")).default;
const marcasRota = (await import("../api/marcas.js")).default;
const upload = (await import("../api/upload.js")).default;
const documento = (await import("../api/documento.js")).default;
const { encerrarProvedor } = await import("../api/_chain.js");

const CHASSI = "KMCTESTE000000001";
const CHASSI_2 = "KMCTESTE000000002";
const carteiraDe = (i) => new Wallet(CHAVES[i]);

let cadeia, banco, ipfs, contas;

// Contas ficticias: indice da carteira do Hardhat e papel concedido em cadeia.
const PESSOAS = {
    admin:     { i: 0, nome: "Admin Teste",     email: "admin@exemplo.test" },    // deployer: admin + DETRAN
    detran:    { i: 1, nome: "Detran Teste",    email: "detran@exemplo.test" },
    oficina:   { i: 2, nome: "Oficina Teste",   email: "oficina@exemplo.test" },
    vistoria:  { i: 3, nome: "Vistoria Teste",  email: "vistoria@exemplo.test" },
    semPapel:  { i: 4, nome: "Sem Papel Teste", email: "sempapel@exemplo.test" },
    semVinculo:{ i: null, nome: "Sem Vinculo",  email: "semvinculo@exemplo.test" }
};

const cookieDe = (pessoa) => `kmchain_sessao=${criarToken({ id: pessoa.id, email: pessoa.email, nome: pessoa.nome })}`;

async function assinar(i, montar) {
    const emitidoEm = Date.now();
    return { emitidoEm, assinatura: await carteiraDe(i).signMessage(montar(emitidoEm)) };
}

before(async () => {
    cadeia = await iniciarBlockchain();
    banco = await iniciarBanco(definirExecutor);
    ipfs = simularIpfs();

    const c = cadeia.contrato;
    await (await c.grantRole(id("DETRAN_ROLE"), carteiraDe(1).address)).wait();
    await (await c.grantRole(id("OFICINA_ROLE"), carteiraDe(2).address)).wait();
    await (await c.grantRole(id("VISTORIA_ROLE"), carteiraDe(3).address)).wait();

    contas = {};
    for (const [chave, p] of Object.entries(PESSOAS)) {
        const carteira = p.i === null ? null : carteiraDe(p.i).address.toLowerCase();
        const r = await bd(
            "INSERT INTO usuarios (nome, email, senha_hash, carteira) VALUES ($1, $2, 'x', $3) RETURNING id",
            [p.nome, p.email, carteira]
        );
        contas[chave] = { ...p, id: r.rows[0].id, carteira };
    }
}, { timeout: 120000 });

after(() => {
    ipfs?.restaurar();
    encerrarProvedor();
    cadeia?.provedor.destroy();
    pararBlockchain();
});

// ---------------------------------------------------------------- contas
describe("lista de contas (/api/auth/pendentes)", () => {
    const pedir = async (quem, i = quem.i, montar) => chamar(pendentes, {
        cookie: quem.id ? cookieDe(quem) : undefined,
        corpo: await assinar(i, montar ?? ((t) => mensagemContas(quem.email, t)))
    });

    test("sem sessão: 401", async () => {
        const r = await chamar(pendentes, { corpo: await assinar(0, (t) => mensagemContas("x", t)) });
        assert.equal(r.status, 401);
        assert.equal(r.corpo.codigo, "sem_sessao");
    });

    test("Admin com a carteira vinculada: 200 com a lista", async () => {
        const r = await pedir(contas.admin);
        assert.equal(r.status, 200);
        assert.ok(r.corpo.contas.some((c) => c.email === "oficina@exemplo.test"));
    });

    test("DETRAN com a carteira vinculada: 200", async () => {
        assert.equal((await pedir(contas.detran)).status, 200);
    });

    test("oficina: 403 sem_papel", async () => {
        const r = await pedir(contas.oficina);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "sem_papel");
    });

    test("carteira sem papel: 403 sem_papel", async () => {
        assert.equal((await pedir(contas.semPapel)).corpo.codigo, "sem_papel");
    });

    test("conta sem carteira vinculada: 403 carteira_nao_vinculada", async () => {
        const r = await pedir(contas.semVinculo, 0);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_nao_vinculada");
    });

    test("assinada por carteira diferente da vinculada: 403 carteira_diferente", async () => {
        const r = await pedir(contas.admin, 1);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_diferente");
    });

    test("assinatura de outra conta (e-mail diferente na mensagem) não vale", async () => {
        const r = await pedir(contas.admin, 0, (t) => mensagemContas("outra@exemplo.test", t));
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_diferente");
    });

    test("assinatura expirada: 400 assinatura_expirada", async () => {
        const emitidoEm = Date.now() - 5 * 60 * 1000;
        const assinatura = await carteiraDe(0).signMessage(mensagemContas(contas.admin.email, emitidoEm));
        const r = await chamar(pendentes, { cookie: cookieDe(contas.admin), corpo: { emitidoEm, assinatura } });
        assert.equal(r.status, 400);
        assert.equal(r.corpo.codigo, "assinatura_expirada");
    });

    test("assinatura ausente ou inválida: 400 assinatura_invalida", async () => {
        const r = await chamar(pendentes, { cookie: cookieDe(contas.admin), corpo: { emitidoEm: Date.now(), assinatura: "0x1234" } });
        assert.equal(r.status, 400);
        assert.equal(r.corpo.codigo, "assinatura_invalida");
    });

    test("RPC fora do ar: 503 sem detalhe interno", async () => {
        const rpc = process.env.RPC_URL;
        process.env.RPC_URL = "http://127.0.0.1:1";
        try {
            const r = await pedir(contas.admin);
            assert.equal(r.status, 503);
            assert.doesNotMatch(JSON.stringify(r.corpo), /ECONN|127\.0\.0\.1|connect/i);
        } finally {
            process.env.RPC_URL = rpc;
        }
    });

    test("banco fora do ar: 503 sem detalhe interno", async () => {
        definirExecutor({
            consulta: async () => { const e = new Error("connect ECONNREFUSED 10.0.0.1:5432"); e.code = "ECONNREFUSED"; throw e; },
            script: async () => {}
        });
        try {
            const r = await pedir(contas.admin);
            assert.equal(r.status, 503);
            assert.equal(r.corpo.codigo, "banco_indisponivel");
            assert.doesNotMatch(JSON.stringify(r.corpo), /ECONN|10\.0\.0\.1/);
        } finally {
            definirExecutor(banco.executor);
        }
    });
});

// ---------------------------------------------------------------- vinculo
describe("vínculo de carteira", () => {
    test("carteira já vinculada a outra conta: 409 carteira_em_uso", async () => {
        const alvo = carteiraDe(0).address;
        const prova = await assinar(0, (t) => mensagemVinculo(alvo, contas.semVinculo.email, t));
        const r = await chamar(vincular, { cookie: cookieDe(contas.semVinculo), corpo: { carteira: alvo, ...prova } });
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "carteira_em_uso");
    });

    test("carteira livre: vincula; assinatura de outra carteira é recusada", async () => {
        const nova = Wallet.createRandom();
        const errada = await assinar(5, (t) => mensagemVinculo(nova.address, contas.semVinculo.email, t));
        const recusado = await chamar(vincular, { cookie: cookieDe(contas.semVinculo), corpo: { carteira: nova.address, ...errada } });
        assert.equal(recusado.status, 400);

        const emitidoEm = Date.now();
        const assinatura = await nova.signMessage(mensagemVinculo(nova.address, contas.semVinculo.email, emitidoEm));
        const r = await chamar(vincular, { cookie: cookieDe(contas.semVinculo), corpo: { carteira: nova.address, emitidoEm, assinatura } });
        assert.equal(r.status, 200);
        const salvo = await bd("SELECT carteira FROM usuarios WHERE id = $1", [contas.semVinculo.id]);
        assert.equal(salvo.rows[0].carteira, nova.address.toLowerCase());
    });
});

// ------------------------------------------------------- registro privado
describe("registro privado conferido na transação", () => {
    let txCadastro, txRevisao, txTransferencia;
    // O que a tela manda no cadastro. Modelo e ano em cadeia (v1) sao os que
    // o servidor devolve na validacao previa: "Fiat Uno Ficticio", 2021.
    const CADASTRO = {
        chassi: CHASSI, placa: "ABC1D23", marcaId: "fiat", modelo: "Uno Ficticio",
        anoFabricacao: "2020", anoModelo: "2021", uf: "MG", kmInicial: "10000",
        nomeProprietario: "Proprietario Ficticio", cpfProprietario: cpfFicticio()
    };
    const agoraIso = () => new Date().toISOString();

    before(async () => {
        const c = cadeia.contrato;
        const comoDetran = c.connect(cadeia.carteiras[1]);
        const comoOficina = c.connect(cadeia.carteiras[2]);
        txCadastro = (await (await comoDetran.cadastrarVeiculo(CHASSI, "Fiat Uno Ficticio", 2021, 10000, ZeroHash)).wait()).hash;
        txRevisao = (await (await comoOficina.registrarLeitura(CHASSI, 10500, 2, ZeroHash, false)).wait()).hash;
        txTransferencia = (await (await comoDetran.registrarLeitura(CHASSI, 10800, 3, ZeroHash, false)).wait()).hash;
        await (await comoDetran.cadastrarVeiculo(CHASSI_2, "Outro Ficticio", 2021, 5000, ZeroHash)).wait();
    });

    const enviar = (quem, corpo) => chamar(registrar, { cookie: cookieDe(quem), corpo });

    test("validação prévia: recusa cada campo inválido, com a mensagem do campo", async () => {
        const r = await chamar(validarCadastroRota, {
            cookie: cookieDe(contas.detran),
            corpo: {
                ...CADASTRO, chassi: "KMCTESTE00000000O", placa: "12ABC", marcaId: "marca-que-nao-existe",
                modelo: "", anoFabricacao: "2020", anoModelo: "2023", uf: "XX", kmInicial: "abc",
                observadaEm: new Date(Date.now() + 3600e3).toISOString(), cpfProprietario: "12345678900", nomeProprietario: ""
            }
        });
        assert.equal(r.status, 400);
        assert.deepEqual(Object.keys(r.corpo.campos).sort(), [
            "anoModelo", "chassi", "cpfProprietario", "kmInicial", "marca", "modelo", "nomeProprietario", "observadaEm", "placa", "uf"
        ]);
    });

    test("validação prévia: dados corretos devolvem o que vai em cadeia; oficina não cadastra", async () => {
        const ok = await chamar(validarCadastroRota, { cookie: cookieDe(contas.detran), corpo: { ...CADASTRO, observadaEm: agoraIso() } });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.corpo.emCadeia, { modelo: "Fiat Uno Ficticio", ano: 2021 });
        const oficina = await chamar(validarCadastroRota, { cookie: cookieDe(contas.oficina), corpo: { ...CADASTRO, observadaEm: agoraIso() } });
        assert.equal(oficina.status, 403);
    });

    test("cadastro completo: identificação, placa, UF e proprietário datados; km e modelo do evento", async () => {
        const r = await enviar(contas.detran, {
            txHash: txCadastro, ...CADASTRO, observadaEm: agoraIso(),
            // campos que o navegador nao deveria conseguir impor:
            tipoEvento: "Sinistro", carteira: "0x0000000000000000000000000000000000000001", ano: 1900
        });
        assert.equal(r.status, 201);
        const registro = (await bd("SELECT * FROM registros_privados WHERE tx_hash = $1", [txCadastro.toLowerCase()])).rows[0];
        assert.equal(registro.tipo_evento, "Cadastro");
        assert.equal(Number(registro.quilometragem), 10000);
        assert.equal(registro.carteira, carteiraDe(1).address.toLowerCase());
        assert.ok(registro.observada_em instanceof Date);
        assert.ok(registro.registrado_em_cadeia instanceof Date);
        assert.equal(registro.cpf_proprietario, null, "dados pessoais ficam só nas tabelas datadas");

        const v = (await bd("SELECT * FROM veiculos WHERE chassi = $1", [CHASSI])).rows[0];
        assert.equal(v.marca_id, "fiat");
        assert.equal(v.marca_nome, "Fiat");
        assert.equal(v.modelo, "Uno Ficticio");
        assert.equal(v.ano_fabricacao, 2020);
        assert.equal(v.ano_modelo, 2021);
        assert.equal(v.chave, chaveDoChassi(CHASSI));
        for (const [tabela, coluna, valor] of [["veiculo_placas", "placa", "ABC1D23"], ["veiculo_ufs", "uf", "MG"], ["veiculo_proprietarios", "cpf", cpfFicticio()]]) {
            const linhas = (await bd(`SELECT ${coluna}, origem, vigente_desde FROM ${tabela} WHERE chassi = $1`, [CHASSI])).rows;
            assert.equal(linhas.length, 1, tabela);
            assert.equal(linhas[0][coluna], valor);
            assert.equal(linhas[0].origem, "cadastro");
            assert.equal(linhas[0].vigente_desde.getTime(), registro.registrado_em_cadeia.getTime());
        }
    });

    test("cadastro cujo modelo em cadeia diverge do enviado: 422 e nada é gravado", async () => {
        const chassi = "KMCTESTE000000003";
        const tx = await (await cadeia.contrato.connect(cadeia.carteiras[1]).cadastrarVeiculo(chassi, "Fiat Outro", 2021, 1, ZeroHash)).wait();
        const r = await enviar(contas.detran, { txHash: tx.hash, ...CADASTRO, chassi, kmInicial: "1", observadaEm: agoraIso() });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "dados_nao_conferem");
        assert.equal((await bd("SELECT 1 FROM veiculos WHERE chassi = $1", [chassi])).rowCount, 0);
        assert.equal((await bd("SELECT 1 FROM veiculo_placas WHERE chassi = $1", [chassi])).rowCount, 0);
    });

    test("reenvio da mesma transação é idempotente", async () => {
        const r = await enviar(contas.detran, { txHash: txCadastro, chassi: CHASSI });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.jaRegistrado, true);
        const n = await bd("SELECT count(*)::int AS n FROM registros_privados WHERE tx_hash = $1", [txCadastro.toLowerCase()]);
        assert.equal(n.rows[0].n, 1);
        assert.equal((await bd("SELECT count(*)::int AS n FROM veiculo_placas WHERE chassi = $1", [CHASSI])).rows[0].n, 1);
    });

    test("transação de outra carteira: 403 (e a transação já usada por outra conta: 409)", async () => {
        const r = await enviar(contas.oficina, { txHash: txTransferencia, chassi: CHASSI, observadaEm: agoraIso() });
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "transacao_de_outra_carteira");
        const usada = await enviar(contas.oficina, { txHash: txCadastro, chassi: CHASSI });
        assert.equal(usada.status, 409);
    });

    test("chassi diferente do evento: 422 chassi_nao_confere", async () => {
        const r = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI_2, observadaEm: agoraIso() });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "chassi_nao_confere");
    });

    test("CPF ou placa em uma revisão: 400 dados_nao_permitidos", async () => {
        const cpf = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI, observadaEm: agoraIso(), cpfProprietario: cpfFicticio(), nomeProprietario: "X Ficticio" });
        assert.equal(cpf.status, 400);
        assert.equal(cpf.corpo.codigo, "dados_nao_permitidos");
        const placa = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI, observadaEm: agoraIso(), placa: "XYZ9A99" });
        assert.equal(placa.status, 400);
    });

    test("leitura sem data de observação ou com data futura: 400", async () => {
        const sem = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI });
        assert.equal(sem.status, 400);
        assert.equal(sem.corpo.codigo, "observacao_invalida");
        const futura = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI, observadaEm: new Date(Date.now() + 3600e3).toISOString() });
        assert.equal(futura.status, 400);
    });

    test("revisão: grava o responsável real e a data da observação, separada da data em cadeia", async () => {
        const observada = new Date(Date.now() - 2 * 3600e3);
        const r = await enviar(contas.oficina, { txHash: txRevisao, chassi: CHASSI, observadaEm: observada.toISOString() });
        assert.equal(r.status, 201);
        const linha = (await bd("SELECT tipo_evento, usuario_email, observada_em, registrado_em_cadeia FROM registros_privados WHERE tx_hash = $1", [txRevisao.toLowerCase()])).rows[0];
        assert.equal(linha.tipo_evento, "Revisão");
        assert.equal(linha.usuario_email, "oficina@exemplo.test");
        assert.equal(linha.observada_em.getTime(), observada.getTime());
        assert.notEqual(linha.observada_em.getTime(), linha.registrado_em_cadeia.getTime());
    });

    test("transferência: novo proprietário entra datado e o anterior continua", async () => {
        const invalido = await enviar(contas.detran, { txHash: txTransferencia, chassi: CHASSI, observadaEm: agoraIso(), cpfProprietario: "11111111111", nomeProprietario: "Novo Ficticio" });
        assert.equal(invalido.status, 400);
        assert.equal(invalido.corpo.codigo, "cpf_invalido");
        const ok = await enviar(contas.detran, { txHash: txTransferencia, chassi: CHASSI, observadaEm: agoraIso(), cpfProprietario: cpfFicticio("987654321"), nomeProprietario: "Novo Ficticio" });
        assert.equal(ok.status, 201);
        const donos = (await bd("SELECT nome, origem FROM veiculo_proprietarios WHERE chassi = $1 ORDER BY vigente_desde", [CHASSI])).rows;
        assert.deepEqual(donos.map((d) => [d.nome, d.origem]), [["Proprietario Ficticio", "cadastro"], ["Novo Ficticio", "transferencia"]]);
    });

    test("transação inexistente: 409 transacao_pendente", async () => {
        const r = await enviar(contas.oficina, { txHash: "0x" + "ab".repeat(32), chassi: CHASSI });
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "transacao_pendente");
    });

    test("transação de outro contrato: 422 contrato_diferente", async () => {
        const { ContractFactory } = await import("ethers");
        const outro = await new ContractFactory(cadeia.abi, cadeia.bytecode, cadeia.carteiras[2]).deploy();
        await outro.waitForDeployment();
        const tx = await (await outro.cadastrarVeiculo(CHASSI, "Clone", 2020, 1, ZeroHash)).wait();
        const r = await enviar(contas.oficina, { txHash: tx.hash, chassi: CHASSI });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "contrato_diferente");
    });

    test("transação que reverteu: 422 transacao_falhou", async () => {
        const provedor = cadeia.provedor;
        const dados = cadeia.contrato.interface.encodeFunctionData("registrarLeitura", [CHASSI, 1, 2, ZeroHash, false]);
        // Com mineracao automatica o Hardhat recusa enviar uma transacao que
        // vai reverter; sem ela, a transacao entra num bloco e falha la.
        await provedor.send("evm_setAutomine", [false]);
        let tx;
        try {
            tx = await cadeia.carteiras[2].sendTransaction({ to: process.env.KMCHAIN_ENDERECO, data: dados, gasLimit: 200000 });
            await provedor.send("evm_mine", []);
        } finally {
            await provedor.send("evm_setAutomine", [true]);
        }
        const recibo = await provedor.waitForTransaction(tx.hash);
        assert.equal(recibo.status, 0);
        const r = await enviar(contas.oficina, { txHash: tx.hash, chassi: CHASSI });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "transacao_falhou");
    });

    test("carteira sem papel não grava registro privado: 403", async () => {
        const r = await enviar(contas.semPapel, { txHash: txRevisao, chassi: CHASSI });
        assert.equal(r.status, 403);
    });

    test("consulta privada: só DETRAN; devolve identificação, datados e registros", async () => {
        const negado = await chamar(consultar, {
            cookie: cookieDe(contas.oficina),
            corpo: { chassi: CHASSI, ...(await assinar(2, (t) => mensagemPrivado(CHASSI, contas.oficina.email, t))) }
        });
        assert.equal(negado.status, 403);
        const ok = await chamar(consultar, {
            cookie: cookieDe(contas.detran),
            corpo: { chassi: CHASSI, ...(await assinar(1, (t) => mensagemPrivado(CHASSI, contas.detran.email, t))) }
        });
        assert.equal(ok.status, 200);
        assert.equal(ok.corpo.registros.length, 3);
        assert.equal(ok.corpo.veiculo.modelo, "Uno Ficticio");
        assert.equal(ok.corpo.proprietarios[0].nome, "Novo Ficticio", "o vigente vem primeiro");
        assert.equal(ok.corpo.proprietarios.length, 2);
    });

    test("conta inteligente (EIP-7702/ERC-4337): autoria pelo evento, não pelo envelope da transação", async () => {
        const { ContractFactory } = await import("ethers");
        const artefato = lerArtefato("test/CarteiraInteligenteDeTeste.sol", "CarteiraInteligenteDeTeste");
        const dono = cadeia.carteiras[5];
        const carteira = await new ContractFactory(artefato.abi, artefato.bytecode, dono).deploy(await dono.getAddress());
        await carteira.waitForDeployment();
        const endereco = (await carteira.getAddress()).toLowerCase();
        await (await cadeia.contrato.grantRole(id("OFICINA_ROLE"), endereco)).wait();
        const criada = await bd(
            "INSERT INTO usuarios (nome, email, senha_hash, carteira) VALUES ('Conta Inteligente', 'inteligente@exemplo.test', 'x', $1) RETURNING id",
            [endereco]
        );
        const pessoa = { id: criada.rows[0].id, nome: "Conta Inteligente", email: "inteligente@exemplo.test" };
        const contrato = process.env.KMCHAIN_ENDERECO;
        const chamada = (km, tipo, atipica) => cadeia.contrato.interface.encodeFunctionData("registrarLeitura", [CHASSI, km, tipo, ZeroHash, atipica]);

        // o envelope vai para a conta inteligente e sai do dono; o contrato ve a conta
        const tx = await (await carteira.executar(contrato, chamada(20000, 1, true))).wait();
        assert.notEqual(tx.to.toLowerCase(), contrato.toLowerCase());
        assert.notEqual(tx.from.toLowerCase(), endereco);
        const r = await enviar(pessoa, { txHash: tx.hash, chassi: CHASSI, observadaEm: agoraIso() });
        assert.equal(r.status, 201);
        const linha = (await bd("SELECT carteira, tipo_evento FROM registros_privados WHERE tx_hash = $1", [tx.hash.toLowerCase()])).rows[0];
        assert.deepEqual([linha.carteira, linha.tipo_evento], [endereco, "Vistoria"]);

        // lote com dois registros do mesmo veiculo: nao da para saber a qual se refere
        const lote = await (await carteira.executarLote(contrato, [chamada(20100, 2, false), chamada(20200, 2, false)])).wait();
        const r2 = await enviar(pessoa, { txHash: lote.hash, chassi: CHASSI, observadaEm: agoraIso() });
        assert.equal(r2.status, 422);
        assert.equal(r2.corpo.codigo, "varios_registros");
    });
});

// ------------------------------------------------ mudanças posteriores
describe("mudança posterior de placa, UF e proprietário", () => {
    const alterar = async (quem, campo, valores) => chamar(alterarRota, {
        cookie: cookieDe(quem),
        corpo: { chassi: CHASSI, campo, ...valores, ...(await assinar(quem.i, (t) => mensagemAlteracao(CHASSI, campo, quem.email, t))) }
    });
    const agoraIso = () => new Date().toISOString();

    test("nova placa e nova UF entram como linhas novas; as anteriores continuam", async () => {
        assert.equal((await alterar(contas.detran, "placa", { placa: "XYZ9A99", vigenteDesde: agoraIso() })).status, 201);
        assert.equal((await alterar(contas.detran, "uf", { uf: "SP", vigenteDesde: agoraIso() })).status, 201);
        const placas = (await bd("SELECT placa, origem FROM veiculo_placas WHERE chassi = $1 ORDER BY vigente_desde", [CHASSI])).rows;
        assert.deepEqual(placas.map((p) => [p.placa, p.origem]), [["ABC1D23", "cadastro"], ["XYZ9A99", "alteracao"]]);
        const ufs = (await bd("SELECT uf FROM veiculo_ufs WHERE chassi = $1 ORDER BY vigente_desde", [CHASSI])).rows;
        assert.deepEqual(ufs.map((u) => u.uf), ["MG", "SP"]);
    });

    test("novo proprietário por alteração cadastral; histórico preservado", async () => {
        const r = await alterar(contas.detran, "proprietario", { nomeProprietario: "Terceiro Ficticio", cpfProprietario: cpfFicticio("111444777"), vigenteDesde: agoraIso() });
        assert.equal(r.status, 201);
        const donos = (await bd("SELECT nome FROM veiculo_proprietarios WHERE chassi = $1 ORDER BY vigente_desde", [CHASSI])).rows;
        assert.deepEqual(donos.map((d) => d.nome), ["Proprietario Ficticio", "Novo Ficticio", "Terceiro Ficticio"]);
    });

    test("mudança datada antes da informação vigente, dado inválido ou sem DETRAN: recusada", async () => {
        const antes = await alterar(contas.detran, "placa", { placa: "QWE1R23", vigenteDesde: "2000-01-01T00:00:00Z" });
        assert.equal(antes.status, 400);
        assert.equal(antes.corpo.codigo, "data_anterior");
        assert.equal((await alterar(contas.detran, "uf", { uf: "ZZ", vigenteDesde: agoraIso() })).status, 400);
        assert.equal((await alterar(contas.detran, "placa", { placa: "123", vigenteDesde: agoraIso() })).status, 400);
        assert.equal((await alterar(contas.oficina, "placa", { placa: "QWE1R23", vigenteDesde: agoraIso() })).status, 403);
        assert.equal((await bd("SELECT count(*)::int AS n FROM veiculo_placas WHERE chassi = $1", [CHASSI])).rows[0].n, 2);
    });
});

// ------------------------------------------------ marcas fora da lista
describe("marca ausente da lista", () => {
    const propor = (quem, nome, confirmarDiferente) => chamar(marcasRota, { cookie: cookieDe(quem), corpo: { nome, confirmarDiferente } });

    test("lista pública traz a lista-base", async () => {
        const r = await chamar(marcasRota, { metodo: "GET" });
        assert.equal(r.status, 200);
        assert.ok(r.corpo.marcas.some((m) => m.id === "volkswagen" && m.situacao === "lista"));
    });

    test("nome igual a uma marca da lista: 409 com a marca existente", async () => {
        const r = await propor(contas.detran, "volkswagen ");
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "marca_existente");
        assert.equal(r.corpo.marca.id, "volkswagen");
    });

    test("erro de digitação provável: 409 com sugestão, e nada é criado", async () => {
        const r = await propor(contas.detran, "Volksvagen");
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "marca_parecida");
        assert.ok(r.corpo.sugestoes.some((m) => m.id === "volkswagen"));
        assert.equal((await bd("SELECT count(*)::int AS n FROM marcas_adicionais")).rows[0].n, 0);
    });

    test("marca legítima nova entra pendente; oficina não propõe", async () => {
        assert.equal((await propor(contas.oficina, "Marca Ficticia Rara")).status, 403);
        const r = await propor(contas.detran, "Marca Ficticia Rara");
        assert.equal(r.status, 201);
        assert.equal(r.corpo.marca.situacao, "pendente");
    });

    test("cadastro com marca pendente é aceito e guarda o nome da marca", async () => {
        const chassi = "KMCTESTE000000004";
        const corpo = {
            chassi, placa: "DEF4G56", marcaId: "ad-marcaficticiarara", modelo: "Rara 1.0",
            anoFabricacao: "1998", anoModelo: "1998", uf: "RS", kmInicial: "150000",
            observadaEm: new Date().toISOString(), nomeProprietario: "Colecionador Ficticio", cpfProprietario: cpfFicticio("222333444")
        };
        const previa = await chamar(validarCadastroRota, { cookie: cookieDe(contas.detran), corpo });
        assert.equal(previa.status, 200);
        assert.deepEqual(previa.corpo.emCadeia, { modelo: "Marca Ficticia Rara Rara 1.0", ano: 1998 });
        const tx = await (await cadeia.contrato.connect(cadeia.carteiras[1]).cadastrarVeiculo(chassi, previa.corpo.emCadeia.modelo, 1998, 150000, ZeroHash)).wait();
        const r = await chamar(registrar, { cookie: cookieDe(contas.detran), corpo: { txHash: tx.hash, ...corpo } });
        assert.equal(r.status, 201);
        const v = (await bd("SELECT marca_id, marca_nome FROM veiculos WHERE chassi = $1", [chassi])).rows[0];
        assert.deepEqual([v.marca_id, v.marca_nome], ["ad-marcaficticiarara", "Marca Ficticia Rara"]);
    });

    test("só o admin revisa; recusada não volta a ser proposta", async () => {
        const revisar = (quem, id, decisao) => chamar(marcasRota, { metodo: "PATCH", cookie: cookieDe(quem), corpo: { id, decisao } });
        assert.equal((await revisar(contas.detran, "ad-marcaficticiarara", "aprovar")).status, 403);
        const aprovada = await revisar(contas.admin, "ad-marcaficticiarara", "aprovar");
        assert.equal(aprovada.status, 200);
        assert.equal(aprovada.corpo.marca.situacao, "aprovada");

        const outra = await propor(contas.detran, "Outra Ficticia Recusada");
        await revisar(contas.admin, outra.corpo.marca.id, "rejeitar");
        const denovo = await propor(contas.detran, "Outra Ficticia Recusada");
        assert.equal(denovo.status, 409);
        assert.equal(denovo.corpo.codigo, "marca_rejeitada");
        const lista = await chamar(marcasRota, { metodo: "GET" });
        assert.equal(lista.corpo.marcas.some((m) => m.nome === "Outra Ficticia Recusada"), false);
    });
});

// ------------------------------------------------ consulta por chassi e QR
describe("consulta por chassi e QR Code", () => {
    test("a chave da tela é a do contrato, com chassi em minúsculas, espaços ou hífen", async () => {
        const doContrato = await cadeia.contrato.chaveDoChassi(CHASSI);
        for (const digitado of [CHASSI, CHASSI.toLowerCase(), ` ${CHASSI.slice(0, 8)} ${CHASSI.slice(8)} `, `${CHASSI.slice(0, 3)}-${CHASSI.slice(3)}`]) {
            assert.equal(chaveDoChassi(digitado), doContrato, digitado);
        }
    });

    test("consulta pública lê o histórico pelo chassi normalizado", async () => {
        const historico = await cadeia.contrato.getHistorico(normalizarChassi(CHASSI.toLowerCase()));
        assert.ok(historico.length >= 3);
        assert.equal(Number(historico[0].quilometragem), 10000);
    });

    test("o link do QR Code leva ao mesmo chassi; QR de outro site é recusado", () => {
        const link = linkConsulta("https://kmchain-web.vercel.app", CHASSI.toLowerCase());
        assert.equal(link, `https://kmchain-web.vercel.app/?chassi=${CHASSI}`);
        assert.equal(chassiDoLink(link), CHASSI);
        assert.equal(chassiDoLink("https://exemplo.test/?q=1"), null);
        assert.equal(chassiDoLink("texto qualquer"), null);
        assert.equal(chassiDoLink("https://kmchain-web.vercel.app/?chassi=KMCTESTE00000000O"), null);
    });
});

// ---------------------------------------------------------- comprovantes
describe("comprovantes (/api/upload e /api/documento)", () => {
    const pdf = Buffer.from("%PDF-1.4\n% comprovante ficticio de teste\n%%EOF\n");
    const hashPdf = "0x" + createHash("sha256").update(pdf).digest("hex");
    const enviarArquivo = (quem, bytes = pdf, hash = hashPdf) => chamar(upload, {
        cookie: quem ? cookieDe(quem) : undefined,
        corpo: { conteudoBase64: bytes.toString("base64"), chassi: CHASSI, hash }
    });
    const pedirLink = async (quem, hash = hashPdf) => chamar(documento, {
        cookie: cookieDe(quem),
        corpo: { hash, ...(await assinar(quem.i, (t) => mensagemDocumento(hash, quem.email, t))) }
    });
    const abrir = (quem, url) => chamar(documento, { metodo: "GET", url, cookie: cookieDe(quem) });

    test("upload sem sessão: 401; sem papel: 403", async () => {
        assert.equal((await enviarArquivo(null)).status, 401);
        assert.equal((await enviarArquivo(contas.semPapel)).status, 403);
    });

    test("upload de tipo não aceito: 415; hash que não confere: 400", async () => {
        const html = Buffer.from("<html><script>alert(1)</script></html>");
        const hashHtml = "0x" + createHash("sha256").update(html).digest("hex");
        assert.equal((await enviarArquivo(contas.oficina, html, hashHtml)).status, 415);
        assert.equal((await enviarArquivo(contas.oficina, pdf, "0x" + "00".repeat(32))).status, 400);
    });

    test("upload de arquivo acima de 3 MB: 413", async () => {
        const grande = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(3 * 1024 * 1024)]);
        const hash = "0x" + createHash("sha256").update(grande).digest("hex");
        assert.equal((await enviarArquivo(contas.oficina, grande, hash)).status, 413);
    });

    test("upload da oficina: 201, cifrado e sem metadado identificável no Pinata", async () => {
        const r = await enviarArquivo(contas.oficina);
        assert.equal(r.status, 201);
        assert.equal(r.corpo.cid, undefined, "o CID não volta ao navegador");

        const envio = ipfs.envios.at(-1);
        assert.deepEqual(Object.keys(envio).sort(), ["file", "network"], "nenhum keyvalues nem name");
        assert.doesNotMatch(envio.file.nome, new RegExp(`${hashPdf.slice(2, 12)}|${CHASSI}`));
        assert.equal(envio.file.bytes.subarray(0, 4).toString(), "KMC1");
        assert.equal(envio.file.bytes.includes(pdf), false, "o conteúdo não vai em claro");

        const doc = (await bd("SELECT mime, chassi, enviado_por FROM documentos WHERE hash = $1", [hashPdf])).rows[0];
        assert.equal(doc.mime, "application/pdf");
        assert.equal(doc.enviado_por, contas.oficina.id);
    });

    test("quem enviou abre por link de uso único; o arquivo confere com o hash", async () => {
        const link = await pedirLink(contas.oficina);
        assert.equal(link.status, 200);
        assert.match(link.corpo.url, /^\/api\/documento\?t=[A-Za-z0-9_-]{43}$/);
        assert.doesNotMatch(link.corpo.url, /bafy|0x/);

        const aberto = await abrir(contas.oficina, link.corpo.url);
        assert.equal(aberto.status, 200);
        assert.ok(Buffer.compare(aberto.corpo, pdf) === 0);
        assert.match(aberto.cabecalhos["cache-control"], /no-store/);
        assert.equal(aberto.cabecalhos["content-type"], "application/pdf");

        const deNovo = await abrir(contas.oficina, link.corpo.url);
        assert.equal(deNovo.status, 410, "uso único");
    });

    test("link não serve para outra sessão e expira", async () => {
        const link = await pedirLink(contas.oficina);
        assert.equal((await abrir(contas.detran, link.corpo.url)).status, 410);

        const outro = await pedirLink(contas.oficina);
        await bd("UPDATE tokens_documento SET expira_em = now() - interval '1 second' WHERE usado_em IS NULL");
        assert.equal((await abrir(contas.oficina, outro.corpo.url)).status, 410);

        const semSessao = await chamar(documento, { metodo: "GET", url: outro.corpo.url });
        assert.equal(semSessao.status, 401);
        assert.match(semSessao.cabecalhos["content-type"], /text\/plain/);
    });

    test("vistoria não abre comprovante de outra entidade; DETRAN abre", async () => {
        const negado = await pedirLink(contas.vistoria);
        assert.equal(negado.status, 403);
        assert.equal(negado.corpo.codigo, "sem_acesso_documento");
        const detran = await pedirLink(contas.detran);
        assert.equal(detran.status, 200);
    });

    test("acessos ficam na trilha de auditoria, sem dados do proprietário", async () => {
        const r = await bd("SELECT resultado FROM acessos_documentos WHERE hash_documento = $1", [hashPdf]);
        const resultados = r.rows.map((l) => l.resultado);
        assert.ok(resultados.includes("negado"));
        assert.ok(resultados.includes("link_emitido"));
        const colunas = (await bd("SELECT column_name FROM information_schema.columns WHERE table_name = 'acessos_documentos'")).rows.map((l) => l.column_name);
        assert.equal(colunas.some((c) => /cpf|nome|placa/.test(c)), false);
    });

    test("comprovante adulterado no IPFS: 409, nada é entregue", async () => {
        const cid = (await bd("SELECT cid FROM documentos WHERE hash = $1", [hashPdf])).rows[0].cid;
        const original = ipfs.arquivos.get(cid);
        const adulterado = Buffer.from(original);
        adulterado[adulterado.length - 1] ^= 0xff;
        ipfs.arquivos.set(cid, adulterado);
        try {
            const link = await pedirLink(contas.detran);
            const r = await abrir(contas.detran, link.corpo.url);
            assert.equal(r.status, 409);
        } finally {
            ipfs.arquivos.set(cid, original);
        }
    });

    test("limite de pedidos por conta: 429", async () => {
        await bd(
            `INSERT INTO acessos_documentos (hash_documento, usuario_id, resultado)
             SELECT $1, $2, 'link_emitido' FROM generate_series(1, 30)`,
            [hashPdf, contas.oficina.id]
        );
        const r = await pedirLink(contas.oficina);
        assert.equal(r.status, 429);
    });
});
