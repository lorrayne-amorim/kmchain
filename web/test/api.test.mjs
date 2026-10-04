// Testes de integracao das rotas /api: acesso em camadas (sessao, carteira
// vinculada e vinculo com organizacao lido do contrato), credenciamento,
// funcionarios, eventos por tipo de organizacao, solicitacoes de correcao,
// dados complementares e politica de acesso aos comprovantes.
// Rodar: npm test (sobe um no Hardhat local; nada vai para a Sepolia).
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ContractFactory, Wallet, ZeroHash } from "ethers";
import {
    CHAVES, chamar, cnpjFicticio, configurarSegredos, cpfFicticio, iniciarBanco, iniciarBlockchain,
    lerArtefato, pararBlockchain, simularIpfs
} from "./ambiente.mjs";

configurarSegredos();
const { definirExecutor, bd } = await import("../servidor/nucleo/banco.js");
const { criarToken } = await import("../servidor/nucleo/sessao.js");
const { encerrarProvedor } = await import("../servidor/nucleo/cadeia.js");
const { mensagemAlteracao, mensagemContas, mensagemDadosComplementares, mensagemDocumento, mensagemVinculo } = await import("../src/lib/mensagens.js");
const { chaveDoChassi, chassiDoLink, linkConsulta, normalizarChassi } = await import("../src/lib/chassi.js");
const { rotuloDoMunicipio } = await import("../src/lib/municipios.js");

const CHASSI = "KMCTESTE000000001";
const CHASSI_SEM_CADASTRO = "KMCTESTE000000002";
const CHASSI_CORRECAO = "KMCTESTE000000006";
const CHASSI_LOCALIZACAO = "KMCTESTE000000008";
const MUNICIPIO = { VITORIA: 3205309, CACHOEIRO: 3201209, VILA_VELHA: 3205200 };
// Codigos do catalogo (src/lib/eventos.js).
const TIPO = {
    CADASTRO: 0, CORRECAO: 1, VISTORIA_DETRAN: 2, TRANSFERENCIA_PROPRIEDADE: 3, REVISAO: 10,
    VISTORIA_TRANSFERENCIA: 20, VISTORIA_CAUTELAR: 24, VISTORIA_SEGURADORA: 25, SEGURO_VISTORIA_PREVIA: 30
};
const carteiraDe = (i) => new Wallet(CHAVES[i]);

let cadeia, banco, ipfs, contas, organizacoes;

// Contas ficticias: indice da carteira do Hardhat e o vinculo que recebem.
const PESSOAS = {
    admin:       { i: 0, nome: "Admin Detran Teste", email: "admin@exemplo.test" },      // implantou: administrador do DETRAN
    detran:      { i: 1, nome: "Detran Teste",       email: "detran@exemplo.test" },     // funcionario do DETRAN
    oficina:     { i: 2, nome: "Oficina Teste",      email: "oficina@exemplo.test" },    // administrador da oficina
    mecanico:    { i: 3, nome: "Mecanico Teste",     email: "mecanico@exemplo.test" },   // funcionario da oficina
    vistoria:    { i: 4, nome: "Vistoria Teste",     email: "vistoria@exemplo.test" },   // administrador da vistoria
    seguradora:  { i: 5, nome: "Seguradora Teste",   email: "seguradora@exemplo.test" }, // administrador da seguradora
    semVinculo:  { i: 6, nome: "Sem Vinculo Teste",  email: "semvinculo@exemplo.test" }, // carteira sem organizacao
    desativado:  { i: 7, nome: "Desativado Teste",   email: "desativado@exemplo.test" }, // sera vinculado e desativado
    suspensa:    { i: 8, nome: "Suspensa Teste",     email: "suspensa@exemplo.test" },   // administrador de oficina suspensa
    semCarteira: { i: null, nome: "Sem Carteira",    email: "semcarteira@exemplo.test" }
};

const cookieDe = (pessoa) => `kmchain_sessao=${criarToken({ id: pessoa.id, email: pessoa.email, nome: pessoa.nome })}`;
const como = (i) => cadeia.contrato.connect(cadeia.carteiras[i]);
const agoraCadeia = async () => (await cadeia.provedor.getBlock("latest")).timestamp;
// Posicao do endereco cadastrado das organizacoes de teste (dadosDaOrganizacao).
const SEDE = { latitude: -20.3155, longitude: -40.3128 };
// O que o navegador envia quando obtem a posicao do dispositivo.
const posicao = (extra = {}) => ({ ...SEDE, precisao: 20, capturadaEm: new Date().toISOString(), ...extra });
// Cerca de 5 km ao sul da sede.
const LONGE = { latitude: SEDE.latitude - 0.045 };

// Os registros de evento levam, por padrao, o dispositivo na sede da
// organizacao; os testes de localizacao informam outra posicao (ou nenhuma).
const ROTAS_COM_LOCALIZACAO = ["eventos", "eventos/conferir"];
function pedir(rota, quem, corpo, metodo = "POST") {
    const comLocalizacao = metodo === "POST" && ROTAS_COM_LOCALIZACAO.includes(rota) && corpo && !("localizacao" in corpo);
    return chamar(rota, { metodo, corpo: comLocalizacao ? { ...corpo, localizacao: posicao() } : corpo, cookie: quem ? cookieDe(quem) : undefined });
}
const obter = (rota, quem) => pedir(rota, quem, undefined, "GET");

async function assinar(i, montar) {
    const emitidoEm = Date.now();
    return { emitidoEm, assinatura: await carteiraDe(i).signMessage(montar(emitidoEm)) };
}

const dadosDaOrganizacao = (tipo, nome, administrador, base) => ({
    tipo, razaoSocial: `${nome} Ltda`, nomeFantasia: nome, cnpj: cnpjFicticio(base), telefone: "(27) 99999-0000",
    email: "contato@exemplo.test", cep: "29010-000", logradouro: "Rua Ficticia", numero: "100", bairro: "Centro",
    municipio: String(MUNICIPIO.VITORIA), latitude: -20.3155, longitude: -40.3128, administradorEmail: administrador.email
});

// Fluxo completo: o DETRAN cadastra, assina o credenciamento e confirma.
async function credenciar(tipo, nome, administrador, base) {
    const criada = await pedir("organizacoes", contas.admin, dadosDaOrganizacao(tipo, nome, administrador, base));
    assert.equal(criada.status, 201, JSON.stringify(criada.corpo));
    const { tipo: codigo, administrador: carteira } = criada.corpo.credenciamento;
    const tx = await (await como(0).credenciarOrganizacao(codigo, carteira)).wait();
    const r = await pedir("organizacoes/credenciamento", contas.admin, { id: criada.corpo.organizacao.id, txHash: tx.hash });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.organizacao;
}

// As chamadas que o contrato deve recusar usam staticCall: simulam a
// transacao sem envia-la, para nao desalinhar o nonce das carteiras de teste.

// O administrador assina o vinculo no contrato e o servidor o espelha.
async function definirFuncionario(administrador, funcionario, ativo) {
    await (await como(administrador.i).definirFuncionario(carteiraDe(funcionario.i).address, ativo)).wait();
    return pedir("funcionarios/sincronizar", administrador, { carteira: carteiraDe(funcionario.i).address });
}

async function registrarEmCadeia(i, chassi, km, tipo, { municipio = MUNICIPIO.CACHOEIRO, documento = ZeroHash, data } = {}) {
    const tx = await como(i).registrarEvento(chaveDoChassi(chassi), km, tipo, data ?? await agoraCadeia(), municipio, documento, true);
    return (await tx.wait()).hash;
}

const identificacao = (chassi, extra = {}) => ({
    chassi, placa: "ABC1D23", marcaId: "fiat", modelo: "Uno Ficticio", anoFabricacao: "2020", anoModelo: "2021", uf: "MG",
    nomeProprietario: "Proprietario Ficticio", cpfProprietario: cpfFicticio(), ...extra
});

// Cadastro completo pelo DETRAN: transacao e complemento.
async function cadastrarVeiculo(chassi, km, extra = {}) {
    const tx = await (await como(1).cadastrarVeiculo(chaveDoChassi(chassi), km, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash)).wait();
    const r = await pedir("eventos", contas.detran, { txHash: tx.hash, ...identificacao(chassi, extra) });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return tx.hash;
}

const acoesDaAuditoria = async () => (await bd("SELECT acao FROM auditoria")).rows.map((l) => l.acao);

before(async () => {
    cadeia = await iniciarBlockchain();
    banco = await iniciarBanco(definirExecutor);
    ipfs = simularIpfs();

    contas = {};
    for (const [chave, p] of Object.entries(PESSOAS)) {
        const carteira = p.i === null ? null : carteiraDe(p.i).address.toLowerCase();
        const r = await bd(
            "INSERT INTO usuarios (nome, email, senha_hash, carteira) VALUES ($1, $2, 'x', $3) RETURNING id",
            [p.nome, p.email, carteira]
        );
        contas[chave] = { ...p, id: r.rows[0].id, carteira };
    }

    // Quem implantou o contrato entra pela primeira vez: o servidor espelha
    // o vinculo de administrador do DETRAN que o contrato ja mostra.
    const sessao = await obter("auth/eu", contas.admin);
    assert.equal(sessao.corpo.organizacao.tipo, "DETRAN");
    assert.equal(sessao.corpo.vinculo.administrador, true);
    assert.equal((await definirFuncionario(contas.admin, contas.detran, true)).status, 200);

    organizacoes = {
        oficina: await credenciar("OFICINA", "Oficina ABC", contas.oficina, "112223330001"),
        vistoria: await credenciar("VISTORIA", "Vistoria XYZ", contas.vistoria, "223334440001"),
        seguradora: await credenciar("SEGURADORA", "Seguradora XYZ", contas.seguradora, "334445550001")
    };
    assert.equal((await definirFuncionario(contas.oficina, contas.mecanico, true)).status, 200);
}, { timeout: 180000 });

after(() => {
    ipfs?.restaurar();
    encerrarProvedor();
    cadeia?.provedor.destroy();
    pararBlockchain();
});

// ------------------------------------------------------------------ rotas
describe("roteador", () => {
    test("rota inexistente: 404; método não aceito: 405", async () => {
        assert.equal((await obter("nao-existe")).status, 404);
        const r = await pedir("auth/entrar", null, undefined, "GET");
        assert.equal(r.status, 405);
        assert.equal(r.corpo.codigo, "metodo");
    });
});

// ---------------------------------------------------------------- contas
describe("camadas de acesso (lista de contas, /api/auth/pendentes)", () => {
    const listar = async (quem, i = quem.i, montar) => chamar("auth/pendentes", {
        cookie: quem.id ? cookieDe(quem) : undefined,
        corpo: await assinar(i, montar ?? ((t) => mensagemContas(quem.email, t)))
    });

    test("sem sessão: 401", async () => {
        const r = await chamar("auth/pendentes", { corpo: await assinar(0, (t) => mensagemContas("x", t)) });
        assert.equal(r.status, 401);
        assert.equal(r.corpo.codigo, "sem_sessao");
    });

    test("DETRAN (administrador ou funcionário) com a carteira vinculada: 200 com a lista", async () => {
        const r = await listar(contas.admin);
        assert.equal(r.status, 200);
        assert.ok(r.corpo.contas.some((c) => c.email === "oficina@exemplo.test"));
        assert.equal((await listar(contas.detran)).status, 200);
    });

    test("oficina: 403 sem_permissao", async () => {
        const r = await listar(contas.oficina);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "sem_permissao");
    });

    test("carteira sem vínculo com organização: 403 sem_vinculo", async () => {
        assert.equal((await listar(contas.semVinculo)).corpo.codigo, "sem_vinculo");
    });

    test("conta sem carteira vinculada: 403 carteira_nao_vinculada", async () => {
        const r = await listar(contas.semCarteira, 0);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_nao_vinculada");
    });

    test("assinada por carteira diferente da vinculada: 403 carteira_diferente", async () => {
        const r = await listar(contas.admin, 1);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_diferente");
    });

    test("assinatura de outra conta (e-mail diferente na mensagem) não vale", async () => {
        const r = await listar(contas.admin, 0, (t) => mensagemContas("outra@exemplo.test", t));
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "carteira_diferente");
    });

    test("assinatura expirada: 400; ausente ou inválida: 400", async () => {
        const emitidoEm = Date.now() - 5 * 60 * 1000;
        const assinatura = await carteiraDe(0).signMessage(mensagemContas(contas.admin.email, emitidoEm));
        const expirada = await pedir("auth/pendentes", contas.admin, { emitidoEm, assinatura });
        assert.equal(expirada.status, 400);
        assert.equal(expirada.corpo.codigo, "assinatura_expirada");
        const invalida = await pedir("auth/pendentes", contas.admin, { emitidoEm: Date.now(), assinatura: "0x1234" });
        assert.equal(invalida.corpo.codigo, "assinatura_invalida");
    });

    test("RPC fora do ar: 503 sem detalhe interno", async () => {
        const rpc = process.env.RPC_URL;
        process.env.RPC_URL = "http://127.0.0.1:1";
        try {
            const r = await listar(contas.admin);
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
            const r = await listar(contas.admin);
            assert.equal(r.status, 503);
            assert.equal(r.corpo.codigo, "banco_indisponivel");
            assert.doesNotMatch(JSON.stringify(r.corpo), /ECONN|10\.0\.0\.1/);
        } finally {
            definirExecutor(banco.executor);
        }
    });
});

describe("vínculo de carteira à conta", () => {
    test("carteira já vinculada a outra conta: 409 carteira_em_uso", async () => {
        const alvo = carteiraDe(0).address;
        const prova = await assinar(0, (t) => mensagemVinculo(alvo, contas.semCarteira.email, t));
        const r = await pedir("auth/vincular-carteira", contas.semCarteira, { carteira: alvo, ...prova });
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "carteira_em_uso");
    });

    test("carteira livre: vincula; assinatura de outra carteira é recusada", async () => {
        const nova = Wallet.createRandom();
        const errada = await assinar(5, (t) => mensagemVinculo(nova.address, contas.semCarteira.email, t));
        assert.equal((await pedir("auth/vincular-carteira", contas.semCarteira, { carteira: nova.address, ...errada })).status, 400);

        const emitidoEm = Date.now();
        const assinatura = await nova.signMessage(mensagemVinculo(nova.address, contas.semCarteira.email, emitidoEm));
        const r = await pedir("auth/vincular-carteira", contas.semCarteira, { carteira: nova.address, emitidoEm, assinatura });
        assert.equal(r.status, 200);
        // vincular a carteira nao da acesso: sem organizacao, a sessao nao traz vinculo ativo
        const sessao = await obter("auth/eu", contas.semCarteira);
        assert.equal(sessao.corpo.vinculo.ativo, false);
        assert.equal(sessao.corpo.organizacao, null);
        await bd("UPDATE usuarios SET carteira = NULL WHERE id = $1", [contas.semCarteira.id]);
    });
});

// ---------------------------------------------------------- organizacoes
describe("organizações: cadastro e credenciamento pelo DETRAN", () => {
    test("credenciada: identificador do contrato, situação ativa, administrador vinculado e auditoria", async () => {
        const o = organizacoes.oficina;
        assert.equal(o.situacao, "ativa");
        assert.equal(o.id_cadeia, 2);
        const emCadeia = await cadeia.contrato.getOrganizacao(o.id_cadeia);
        assert.equal(emCadeia.administrador.toLowerCase(), contas.oficina.carteira);
        const membro = (await bd("SELECT papel, ativo FROM membros WHERE organizacao_id = $1 AND usuario_id = $2", [o.id, contas.oficina.id])).rows[0];
        assert.deepEqual([membro.papel, membro.ativo], ["administrador", true]);
        const acoes = await acoesDaAuditoria();
        for (const acao of ["organizacao_criada", "organizacao_credenciada", "administrador_definido", "funcionario_cadastrado"]) {
            assert.ok(acoes.includes(acao), acao);
        }
        // a sessao do administrador ja mostra a organizacao e o papel
        const sessao = await obter("auth/eu", contas.oficina);
        assert.equal(sessao.corpo.organizacao.nome_fantasia, "Oficina ABC");
        assert.equal(sessao.corpo.vinculo.administrador, true);
    });

    test("só o DETRAN cadastra organização; organização não credencia a si mesma", async () => {
        const dados = dadosDaOrganizacao("OFICINA", "Oficina Clandestina", contas.semVinculo, "445556660001");
        assert.equal((await pedir("organizacoes", null, dados)).status, 401);
        const r = await pedir("organizacoes", contas.oficina, dados);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "sem_permissao");
        assert.equal((await pedir("organizacoes/credenciamento", contas.oficina, { id: organizacoes.oficina.id, txHash: "0x" + "ab".repeat(32) })).status, 403);
        await assert.rejects(como(2).credenciarOrganizacao.staticCall(2, contas.semVinculo.carteira));
    });

    test("cadastro inválido: mensagem por campo; CNPJ repetido: 409", async () => {
        const r = await pedir("organizacoes", contas.admin, {
            tipo: "DETRAN", razaoSocial: "", nomeFantasia: "X", cnpj: "11.111.111/1111-11", telefone: "123", email: "sem-arroba",
            cep: "123", logradouro: "", numero: "", bairro: "", municipio: "9999999", latitude: 60, longitude: 10,
            administradorEmail: contas.semVinculo.email
        });
        assert.equal(r.status, 400);
        assert.deepEqual(Object.keys(r.corpo.campos).sort(), [
            "bairro", "cep", "cnpj", "email", "latitude", "logradouro", "municipio", "nomeFantasia", "numero", "razaoSocial", "telefone", "tipo"
        ]);
        const repetido = await pedir("organizacoes", contas.admin, dadosDaOrganizacao("OFICINA", "Outra", contas.semVinculo, "112223330001"));
        assert.equal(repetido.status, 409);
        assert.equal(repetido.corpo.codigo, "cnpj_ja_cadastrado");
    });

    test("administrador indicado precisa ter conta, carteira e não estar em outra organização", async () => {
        const tentar = (email) => pedir("organizacoes", contas.admin, { ...dadosDaOrganizacao("OFICINA", "Nova", contas.semVinculo, "556667770001"), administradorEmail: email });
        assert.equal((await tentar("ninguem@exemplo.test")).corpo.codigo, "conta_nao_encontrada");
        assert.equal((await tentar(contas.semCarteira.email)).corpo.codigo, "conta_sem_carteira");
        assert.equal((await tentar(contas.vistoria.email)).corpo.codigo, "conta_em_outra_organizacao");
    });

    test("transação que não é um credenciamento: 422; a organização segue pendente", async () => {
        const criada = await pedir("organizacoes", contas.admin, dadosDaOrganizacao("OFICINA", "Oficina Pendente", contas.semVinculo, "667778880001"));
        assert.equal(criada.corpo.organizacao.situacao, "pendente");
        const outraTx = await (await como(0).definirLimitePadrao(1000)).wait().catch(() => null);
        const txEvento = outraTx?.hash ?? "0x" + "cd".repeat(32);
        const r = await pedir("organizacoes/credenciamento", contas.admin, { id: criada.corpo.organizacao.id, txHash: txEvento });
        assert.ok([409, 422].includes(r.status));
        const gestao = await obter("organizacoes/gestao", contas.detran);
        const pendente = gestao.corpo.organizacoes.find((o) => o.nome_fantasia === "Oficina Pendente");
        assert.equal(pendente.situacao, "pendente");
        assert.equal(pendente.credenciamento.administrador, contas.semVinculo.carteira);
        // pendente nao aparece na lista publica
        const publica = await obter("organizacoes");
        assert.equal(publica.corpo.organizacoes.some((o) => o.nome_fantasia === "Oficina Pendente"), false);
    });

    test("lista pública: nome, tipo, endereço, coordenadas e situação; sem CNPJ, contato ou administrador", async () => {
        const r = await obter("organizacoes");
        assert.equal(r.status, 200);
        const o = r.corpo.organizacoes.find((x) => x.nome_fantasia === "Oficina ABC");
        assert.equal(o.tipo, "OFICINA");
        assert.equal(o.municipio_ibge, MUNICIPIO.VITORIA);
        assert.equal(rotuloDoMunicipio(o.municipio_ibge), "Vitória - ES");
        assert.equal(o.situacao, "ativa");
        assert.equal(typeof o.latitude, "number");
        assert.doesNotMatch(JSON.stringify(r.corpo), /cnpj|telefone|email|administrador|11222333000/i);
        assert.equal((await obter("organizacoes/gestao", contas.oficina)).status, 403);
    });

    test("mudança de nome: o cadastro muda, o identificador em cadeia não, e o nome anterior fica datado", async () => {
        const o = organizacoes.seguradora;
        const r = await pedir("organizacoes", contas.detran, {
            ...dadosDaOrganizacao("SEGURADORA", "Seguradora XYZ Renomeada", contas.seguradora, "334445550001"), id: o.id
        }, "PATCH");
        assert.equal(r.status, 200);
        assert.equal(r.corpo.organizacao.id_cadeia, o.id_cadeia);
        const publica = (await obter("organizacoes")).corpo.organizacoes.find((x) => x.id === o.id);
        assert.deepEqual(publica.nomes.map((n) => n.nome), ["Seguradora XYZ", "Seguradora XYZ Renomeada"]);
        assert.equal((await pedir("organizacoes", contas.seguradora, { id: o.id }, "PATCH")).status, 403);
        await pedir("organizacoes", contas.detran, { ...dadosDaOrganizacao("SEGURADORA", "Seguradora XYZ", contas.seguradora, "334445550001"), id: o.id }, "PATCH");
    });

    test("suspensão: o servidor espelha o contrato; funcionário da organização suspensa não registra", async () => {
        const o = await credenciar("OFICINA", "Oficina Suspensa", contas.suspensa, "778889990001");
        await (await como(1).definirSituacaoDaOrganizacao(o.id_cadeia, false)).wait();
        // a organizacao nao sincroniza a propria situacao
        assert.equal((await pedir("organizacoes/sincronizar", contas.suspensa, { id: o.id })).status, 403);
        const r = await pedir("organizacoes/sincronizar", contas.detran, { id: o.id });
        assert.equal(r.corpo.organizacao.situacao, "suspensa");
        assert.ok((await acoesDaAuditoria()).includes("organizacao_suspensa"));

        const conferir = await pedir("eventos/conferir", contas.suspensa, { chassi: CHASSI, tipo: TIPO.REVISAO, km: "1", dataEvento: new Date().toISOString(), municipio: MUNICIPIO.VITORIA });
        assert.equal(conferir.status, 403);
        assert.equal(conferir.corpo.codigo, "organizacao_suspensa");
        const publica = (await obter("organizacoes")).corpo.organizacoes.find((x) => x.id === o.id);
        assert.equal(publica.situacao, "suspensa");

        await (await como(1).definirSituacaoDaOrganizacao(o.id_cadeia, true)).wait();
        assert.equal((await pedir("organizacoes/sincronizar", contas.detran, { id: o.id })).corpo.organizacao.situacao, "ativa");
        assert.ok((await acoesDaAuditoria()).includes("organizacao_reativada"));
    });

    test("troca de administrador pelo DETRAN: espelhada no banco, com auditoria", async () => {
        const o = (await bd("SELECT id, id_cadeia FROM organizacoes WHERE nome_fantasia = 'Oficina Suspensa'")).rows[0];
        const localizada = await pedir("contas/localizar", contas.detran, { email: contas.semVinculo.email, organizacaoId: o.id });
        assert.equal(localizada.status, 200);
        await (await como(1).definirAdministrador(o.id_cadeia, localizada.corpo.conta.carteira)).wait();
        const r = await pedir("organizacoes/sincronizar", contas.detran, { id: o.id });
        assert.equal(r.corpo.organizacao.administrador_id, contas.semVinculo.id);
        const papeis = (await bd("SELECT usuario_id, papel FROM membros WHERE organizacao_id = $1", [o.id])).rows;
        assert.equal(papeis.find((p) => p.usuario_id === contas.semVinculo.id).papel, "administrador");
        assert.equal(papeis.find((p) => p.usuario_id === contas.suspensa.id).papel, "funcionario");
        assert.ok((await acoesDaAuditoria()).includes("administrador_alterado"));
        // devolve a carteira "sem vinculo" ao estado inicial para os demais testes
        await (await como(1).definirAdministrador(o.id_cadeia, contas.suspensa.carteira)).wait();
        await (await como(8).definirFuncionario(contas.semVinculo.carteira, false)).wait();
        await pedir("organizacoes/sincronizar", contas.detran, { id: o.id });
    });

    test("DETRAN informa a carteira de uma conta: só ele, sem repetir carteira, com auditoria", async () => {
        const nova = Wallet.createRandom().address;
        const definir = (quem, email, carteira) => pedir("contas/carteira", quem, { email, carteira });

        assert.equal((await definir(contas.oficina, contas.semCarteira.email, nova)).status, 403);
        assert.equal((await definir(null, contas.semCarteira.email, nova)).status, 401);
        assert.equal((await definir(contas.detran, contas.semCarteira.email, "0x123")).corpo.codigo, "carteira_invalida");
        assert.equal((await definir(contas.detran, "ninguem@exemplo.test", nova)).status, 404);
        assert.equal((await definir(contas.detran, contas.semCarteira.email, contas.vistoria.carteira)).corpo.codigo, "carteira_em_uso");
        assert.equal((await definir(contas.detran, contas.detran.email, nova)).corpo.codigo, "propria_conta");

        const r = await definir(contas.detran, contas.semCarteira.email, nova);
        assert.equal(r.status, 200);
        assert.equal(r.corpo.conta.carteira, nova.toLowerCase());
        assert.equal((await bd("SELECT carteira FROM usuarios WHERE id = $1", [contas.semCarteira.id])).rows[0].carteira, nova.toLowerCase());
        assert.ok((await acoesDaAuditoria()).includes("carteira_definida"));
        // informar a carteira nao da acesso: o vinculo com a organizacao continua dependendo do contrato
        assert.equal((await obter("eventos", contas.semCarteira)).corpo.codigo, "sem_vinculo");
        await bd("UPDATE usuarios SET carteira = NULL WHERE id = $1", [contas.semCarteira.id]);
    });

    test("cadastro da organização com a carteira do administrador informada pelo DETRAN", async () => {
        const carteira = Wallet.createRandom().address;
        const dados = { ...dadosDaOrganizacao("VISTORIA", "Vistoria Com Carteira", contas.semCarteira, "889990000001"), administradorCarteira: carteira };
        assert.equal((await pedir("organizacoes", contas.admin, { ...dados, administradorCarteira: "abc" })).corpo.codigo, "carteira_invalida");

        const r = await pedir("organizacoes", contas.admin, dados);
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        assert.equal(r.corpo.credenciamento.administrador, carteira.toLowerCase(), "o credenciamento é assinado para a carteira informada");
        const pendente = (await obter("organizacoes/gestao", contas.detran)).corpo.organizacoes.find((o) => o.nome_fantasia === "Vistoria Com Carteira");
        assert.equal(pendente.administrador_carteira, carteira.toLowerCase());
        await bd("UPDATE usuarios SET carteira = NULL WHERE id = $1", [contas.semCarteira.id]);
    });

    test("troca da carteira do administrador de organização credenciada: contrato e equipe acompanham", async () => {
        const o = (await bd("SELECT id, id_cadeia FROM organizacoes WHERE nome_fantasia = 'Oficina Suspensa'")).rows[0];
        const nova = Wallet.createRandom().address;
        assert.equal((await pedir("contas/carteira", contas.detran, { email: contas.suspensa.email, carteira: nova })).status, 200);
        // ate o DETRAN assinar a troca, a conta fica sem vinculo ativo no contrato
        assert.equal((await obter("eventos", contas.suspensa)).corpo.codigo, "sem_vinculo");

        await (await como(1).definirAdministrador(o.id_cadeia, nova)).wait();
        const r = await pedir("organizacoes/sincronizar", contas.detran, { id: o.id });
        assert.equal(r.corpo.organizacao.administrador_id, contas.suspensa.id);
        const membro = (await bd("SELECT carteira, papel, ativo FROM membros WHERE organizacao_id = $1 AND usuario_id = $2", [o.id, contas.suspensa.id])).rows[0];
        assert.deepEqual([membro.carteira, membro.papel, membro.ativo], [nova.toLowerCase(), "administrador", true]);
        assert.equal((await obter("eventos", contas.suspensa)).status, 200);
    });
});

// ---------------------------------------------------------- funcionarios
describe("administrador e funcionários", () => {
    test("administrador localiza a conta, vincula e vê a equipe", async () => {
        const localizada = await pedir("contas/localizar", contas.oficina, { email: contas.desativado.email });
        assert.equal(localizada.corpo.conta.carteira, contas.desativado.carteira);
        assert.equal((await pedir("contas/localizar", contas.oficina, { email: "ninguem@exemplo.test" })).status, 404);
        assert.equal((await pedir("contas/localizar", contas.oficina, { email: contas.vistoria.email })).corpo.codigo, "conta_em_outra_organizacao");
        assert.equal((await pedir("contas/localizar", contas.mecanico, { email: contas.desativado.email })).corpo.codigo, "apenas_administrador");

        assert.equal((await definirFuncionario(contas.oficina, contas.desativado, true)).status, 200);
        const equipe = await obter("funcionarios", contas.oficina);
        assert.equal(equipe.status, 200);
        assert.deepEqual(
            equipe.corpo.funcionarios.map((f) => [f.email, f.papel, f.ativo]).sort(),
            [["desativado@exemplo.test", "funcionario", true], ["mecanico@exemplo.test", "funcionario", true], ["oficina@exemplo.test", "administrador", true]]
        );
    });

    test("funcionário comum não vê a equipe nem vincula ninguém", async () => {
        assert.equal((await obter("funcionarios", contas.mecanico)).corpo.codigo, "apenas_administrador");
        const r = await pedir("funcionarios/sincronizar", contas.mecanico, { carteira: contas.desativado.carteira });
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "apenas_administrador");
        await assert.rejects(como(3).definirFuncionario.staticCall(contas.semVinculo.carteira, true));
    });

    test("administrador não administra outra organização; o DETRAN consulta qualquer equipe", async () => {
        const r = await pedir("funcionarios/sincronizar", contas.vistoria, { carteira: contas.mecanico.carteira });
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "outra_organizacao");
        const equipe = await obter(`funcionarios?organizacao=${organizacoes.oficina.id}`, contas.vistoria);
        assert.equal(equipe.status, 403);
        assert.equal(equipe.corpo.codigo, "outra_organizacao");
        // o contrato tambem recusa: desativar ou tomar funcionario de outra organizacao
        await assert.rejects(como(4).definirFuncionario.staticCall(contas.mecanico.carteira, false));
        await assert.rejects(como(4).definirFuncionario.staticCall(contas.mecanico.carteira, true));

        const doDetran = await obter(`funcionarios?organizacao=${organizacoes.oficina.id}`, contas.detran);
        assert.equal(doDetran.status, 200);
        assert.equal(doDetran.corpo.organizacao.nome_fantasia, "Oficina ABC");
    });

    test("funcionário desativado não registra; o vínculo fica no histórico", async () => {
        const conferir = () => pedir("eventos/conferir", contas.desativado, {
            chassi: CHASSI, tipo: TIPO.REVISAO, km: "1", dataEvento: new Date().toISOString(), municipio: MUNICIPIO.VITORIA
        });
        assert.equal((await conferir()).status, 200);
        assert.equal((await definirFuncionario(contas.oficina, contas.desativado, false)).corpo.funcionario.ativo, false);
        const negado = await conferir();
        assert.equal(negado.status, 403);
        assert.equal(negado.corpo.codigo, "sem_vinculo");
        await assert.rejects(como(7).registrarEvento.staticCall(chaveDoChassi(CHASSI), 1, TIPO.REVISAO, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash, true));

        const linha = (await bd("SELECT ativo, desativado_em FROM membros WHERE usuario_id = $1", [contas.desativado.id])).rows[0];
        assert.equal(linha.ativo, false);
        assert.ok(linha.desativado_em instanceof Date);
        assert.ok((await acoesDaAuditoria()).includes("funcionario_desativado"));
    });
});

// ------------------------------------------------- permissoes por evento
describe("tipos de evento por organização (conferência antes da assinatura)", () => {
    const conferir = (quem, tipo, extra = {}) => pedir("eventos/conferir", quem, {
        chassi: CHASSI, tipo, km: "100", dataEvento: new Date().toISOString(), municipio: MUNICIPIO.CACHOEIRO, ...extra
    });

    test("oficina registra revisão; não registra vistoria de transferência", async () => {
        assert.equal((await conferir(contas.mecanico, TIPO.REVISAO)).status, 200);
        const r = await conferir(contas.mecanico, TIPO.VISTORIA_TRANSFERENCIA);
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "tipo_nao_permitido");
    });

    test("vistoria registra vistoria de transferência; não registra revisão mecânica", async () => {
        assert.equal((await conferir(contas.vistoria, TIPO.VISTORIA_TRANSFERENCIA)).status, 200);
        assert.equal((await conferir(contas.vistoria, TIPO.REVISAO)).corpo.codigo, "tipo_nao_permitido");
    });

    test("seguradora registra evento securitário; não registra os de oficina e vistoria", async () => {
        assert.equal((await conferir(contas.seguradora, TIPO.SEGURO_VISTORIA_PREVIA)).status, 200);
        assert.equal((await conferir(contas.seguradora, TIPO.REVISAO)).status, 403);
        assert.equal((await conferir(contas.seguradora, TIPO.VISTORIA_TRANSFERENCIA)).status, 403);
    });

    test("DETRAN registra evento institucional próprio; não se passa por oficina, vistoria ou seguradora", async () => {
        assert.equal((await conferir(contas.detran, TIPO.VISTORIA_DETRAN)).status, 200);
        for (const tipo of [TIPO.REVISAO, TIPO.VISTORIA_TRANSFERENCIA, TIPO.SEGURO_VISTORIA_PREVIA]) {
            assert.equal((await conferir(contas.admin, tipo)).corpo.codigo, "tipo_nao_permitido");
        }
    });

    test("cadastro e correção não entram como evento comum, para ninguém", async () => {
        for (const quem of [contas.detran, contas.mecanico]) {
            assert.equal((await conferir(quem, TIPO.CADASTRO)).status, 403);
            assert.equal((await conferir(quem, TIPO.CORRECAO)).status, 403);
        }
    });

    test("sem sessão, sem carteira ou sem vínculo: recusado", async () => {
        assert.equal((await conferir(null, TIPO.REVISAO)).status, 401);
        assert.equal((await conferir(contas.semCarteira, TIPO.REVISAO)).corpo.codigo, "carteira_nao_vinculada");
        assert.equal((await conferir(contas.semVinculo, TIPO.REVISAO)).corpo.codigo, "sem_vinculo");
    });

    test("dados do evento inválidos: mensagem por campo", async () => {
        const r = await conferir(contas.mecanico, TIPO.REVISAO, { km: "abc", dataEvento: new Date(Date.now() + 3600e3).toISOString(), municipio: 1234567 });
        assert.equal(r.status, 400);
        assert.deepEqual(Object.keys(r.corpo.campos).sort(), ["dataEvento", "km", "municipio"]);
    });

    test("dado pessoal em evento que não o comporta: 400; vistoria para seguradora exige a seguradora", async () => {
        const cpf = await conferir(contas.mecanico, TIPO.REVISAO, { cpfProprietario: cpfFicticio(), nomeProprietario: "X Ficticio" });
        assert.equal(cpf.corpo.codigo, "dados_nao_permitidos");
        assert.equal((await conferir(contas.mecanico, TIPO.REVISAO, { placa: "XYZ9A99" })).status, 400);
        assert.equal((await conferir(contas.vistoria, TIPO.VISTORIA_SEGURADORA)).corpo.codigo, "seguradora_invalida");
        assert.equal((await conferir(contas.vistoria, TIPO.VISTORIA_SEGURADORA, { seguradoraId: organizacoes.oficina.id })).corpo.codigo, "seguradora_invalida");
        assert.equal((await conferir(contas.vistoria, TIPO.VISTORIA_SEGURADORA, { seguradoraId: organizacoes.seguradora.id })).status, 200);
    });

    test("o contrato recusa o que o servidor recusa (chamada direta, sem passar pela tela)", async () => {
        const chave = chaveDoChassi(CHASSI);
        const direto = async (i, tipo) => como(i).registrarEvento.staticCall(chave, 1, tipo, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash, true);
        await assert.rejects(direto(3, TIPO.VISTORIA_TRANSFERENCIA));
        await assert.rejects(direto(4, TIPO.REVISAO));
        await assert.rejects(direto(0, TIPO.REVISAO));
        await assert.rejects(direto(6, TIPO.REVISAO));
    });
});

// ------------------------------------------------------------- eventos
describe("cadastro e eventos conferidos no contrato", () => {
    let txCadastro, txRevisao, txTransferencia;
    const agoraIso = () => new Date().toISOString();

    before(async () => {
        const chave = chaveDoChassi(CHASSI);
        const agora = await agoraCadeia();
        // datas do evento anteriores a data da transacao
        txCadastro = (await (await como(1).cadastrarVeiculo(chave, 10000, agora - 3 * 3600, MUNICIPIO.VITORIA, ZeroHash)).wait()).hash;
        txRevisao = await registrarEmCadeia(3, CHASSI, 10500, TIPO.REVISAO, { data: agora - 2 * 3600 });
        txTransferencia = await registrarEmCadeia(1, CHASSI, 10800, TIPO.TRANSFERENCIA_PROPRIEDADE, { municipio: MUNICIPIO.VITORIA });
    });

    const dadosDoCadastro = (extra = {}) => ({
        ...identificacao(CHASSI), kmInicial: "10000", dataEvento: agoraIso(), municipio: MUNICIPIO.VITORIA, ...extra
    });

    test("validação prévia do cadastro: recusa cada campo inválido, com a mensagem do campo", async () => {
        const r = await pedir("veiculo", contas.detran, dadosDoCadastro({
            chassi: "KMCTESTE00000000O", placa: "12ABC", marcaId: "marca-que-nao-existe", modelo: "", anoModelo: "2023", uf: "XX",
            kmInicial: "abc", dataEvento: new Date(Date.now() + 3600e3).toISOString(), municipio: "", cpfProprietario: "12345678900", nomeProprietario: ""
        }));
        assert.equal(r.status, 400);
        assert.deepEqual(Object.keys(r.corpo.campos).sort(), [
            "anoModelo", "chassi", "cpfProprietario", "dataEvento", "kmInicial", "marca", "modelo", "municipio", "nomeProprietario", "placa", "uf"
        ]);
    });

    test("validação prévia: dados corretos devolvem a chave do veículo; só o DETRAN cadastra", async () => {
        const ok = await pedir("veiculo", contas.detran, dadosDoCadastro());
        assert.equal(ok.status, 200);
        assert.equal(ok.corpo.chave, chaveDoChassi(CHASSI));
        assert.equal(ok.corpo.emCadeia, undefined, "marca, modelo e ano não vão para a blockchain");
        assert.equal((await pedir("veiculo", contas.oficina, dadosDoCadastro())).status, 403);
        await assert.rejects(como(2).cadastrarVeiculo.staticCall(chaveDoChassi(CHASSI_SEM_CADASTRO), 1, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash));
    });

    test("cadastro completo: identificação e datados no banco; evento com dados lidos do contrato", async () => {
        const r = await pedir("eventos", contas.detran, {
            txHash: txCadastro, ...identificacao(CHASSI),
            // campos que o navegador nao consegue impor:
            tipo: TIPO.REVISAO, km: "1", carteira: "0x0000000000000000000000000000000000000001", municipio: 1100015
        });
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        const evento = (await bd("SELECT * FROM eventos WHERE tx_hash = $1", [txCadastro.toLowerCase()])).rows[0];
        assert.equal(evento.tipo_evento, "Cadastro inicial");
        assert.equal(evento.tipo_codigo, TIPO.CADASTRO);
        assert.equal(Number(evento.quilometragem), 10000);
        assert.equal(evento.carteira, contas.detran.carteira);
        assert.equal(evento.municipio_ibge, MUNICIPIO.VITORIA);
        assert.equal(evento.contrato, "v2");
        assert.equal(evento.indice, 0);
        assert.equal(evento.cpf_proprietario, null, "dados pessoais ficam só nas tabelas datadas");
        const detran = (await bd("SELECT id FROM organizacoes WHERE id_cadeia = 1")).rows[0];
        assert.equal(evento.organizacao_id, detran.id);
        // data do evento e data da transacao sao momentos diferentes
        assert.ok(evento.registrado_em_cadeia.getTime() - evento.observada_em.getTime() >= 3 * 3600e3);

        const v = (await bd("SELECT * FROM veiculos WHERE chassi = $1", [CHASSI])).rows[0];
        assert.deepEqual([v.marca_id, v.marca_nome, v.modelo, v.ano_fabricacao, v.ano_modelo], ["fiat", "Fiat", "Uno Ficticio", 2020, 2021]);
        assert.equal(v.chave, chaveDoChassi(CHASSI));
        for (const [tabela, coluna, valor] of [["veiculo_placas", "placa", "ABC1D23"], ["veiculo_ufs", "uf", "MG"], ["veiculo_proprietarios", "cpf", cpfFicticio()]]) {
            const linhas = (await bd(`SELECT ${coluna}, origem, vigente_desde FROM ${tabela} WHERE chassi = $1`, [CHASSI])).rows;
            assert.equal(linhas.length, 1, tabela);
            assert.equal(linhas[0][coluna], valor);
            assert.equal(linhas[0].origem, "cadastro");
            assert.equal(linhas[0].vigente_desde.getTime(), evento.registrado_em_cadeia.getTime());
        }
    });

    test("em cadeia não há marca, modelo, ano, placa nem proprietário: só chave, km, datas, município, organização e responsável", async () => {
        const e = await cadeia.contrato.getEvento(chaveDoChassi(CHASSI), 0);
        assert.deepEqual(Object.keys(e.toObject()).sort(), [
            "atipica", "dataBloco", "dataEvento", "hashDocumento", "km", "municipio", "organizacao", "referencia", "responsavel", "tipo"
        ]);
        const v = await cadeia.contrato.getVeiculo(chaveDoChassi(CHASSI));
        assert.deepEqual(Object.keys(v.toObject()).sort(), ["cadastrado", "limiteDiario", "totalCorrecoes", "totalEventos", "ultimaDataEvento", "ultimaKm"]);
    });

    test("reenvio da mesma transação é idempotente", async () => {
        const r = await pedir("eventos", contas.detran, { txHash: txCadastro, chassi: CHASSI });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.jaRegistrado, true);
        assert.equal((await bd("SELECT count(*)::int AS n FROM eventos WHERE tx_hash = $1", [txCadastro.toLowerCase()])).rows[0].n, 1);
        assert.equal((await bd("SELECT count(*)::int AS n FROM veiculo_placas WHERE chassi = $1", [CHASSI])).rows[0].n, 1);
    });

    test("evento de outra carteira: 403; transação já registrada por outra conta: 409", async () => {
        const r = await pedir("eventos", contas.oficina, { txHash: txTransferencia, chassi: CHASSI });
        assert.equal(r.status, 403);
        assert.equal(r.corpo.codigo, "transacao_de_outra_carteira");
        assert.equal((await pedir("eventos", contas.oficina, { txHash: txCadastro, chassi: CHASSI })).status, 409);
    });

    test("chassi diferente do evento: 422 chassi_nao_confere", async () => {
        const r = await pedir("eventos", contas.mecanico, { txHash: txRevisao, chassi: CHASSI_SEM_CADASTRO });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "chassi_nao_confere");
    });

    test("revisão: responsável, organização, município e data do evento vêm do contrato", async () => {
        const comCpf = await pedir("eventos", contas.mecanico, { txHash: txRevisao, chassi: CHASSI, cpfProprietario: cpfFicticio(), nomeProprietario: "X Ficticio" });
        assert.equal(comCpf.corpo.codigo, "dados_nao_permitidos");

        const r = await pedir("eventos", contas.mecanico, { txHash: txRevisao, chassi: CHASSI, dataEvento: "2001-01-01T00:00:00Z", municipio: 1100015 });
        assert.equal(r.status, 201);
        const linha = (await bd("SELECT * FROM eventos WHERE tx_hash = $1", [txRevisao.toLowerCase()])).rows[0];
        const emCadeia = await cadeia.contrato.getEvento(chaveDoChassi(CHASSI), 1);
        assert.equal(linha.tipo_evento, "Revisão");
        assert.equal(linha.usuario_email, "mecanico@exemplo.test");
        assert.equal(linha.organizacao_id, organizacoes.oficina.id);
        assert.equal(linha.municipio_ibge, MUNICIPIO.CACHOEIRO);
        assert.equal(linha.observada_em.getTime(), Number(emCadeia.dataEvento) * 1000);
        assert.equal(linha.registrado_em_cadeia.getTime(), Number(emCadeia.dataBloco) * 1000);
        assert.ok(linha.registrado_em_cadeia > linha.observada_em);
        assert.equal(Number(emCadeia.organizacao), organizacoes.oficina.id_cadeia);
        assert.equal(emCadeia.responsavel.toLowerCase(), contas.mecanico.carteira);
    });

    test("transferência de propriedade (DETRAN): novo proprietário entra datado e o anterior continua", async () => {
        const invalido = await pedir("eventos", contas.detran, { txHash: txTransferencia, chassi: CHASSI, cpfProprietario: "11111111111", nomeProprietario: "Novo Ficticio" });
        assert.equal(invalido.status, 400);
        assert.equal(invalido.corpo.codigo, "proprietario_invalido");
        const ok = await pedir("eventos", contas.detran, { txHash: txTransferencia, chassi: CHASSI, cpfProprietario: cpfFicticio("987654321"), nomeProprietario: "Novo Ficticio" });
        assert.equal(ok.status, 201);
        const donos = (await bd("SELECT nome, origem FROM veiculo_proprietarios WHERE chassi = $1 ORDER BY vigente_desde", [CHASSI])).rows;
        assert.deepEqual(donos.map((d) => [d.nome, d.origem]), [["Proprietario Ficticio", "cadastro"], ["Novo Ficticio", "transferencia"]]);
    });

    test("vistoria a pedido de seguradora: relaciona a seguradora contratante à empresa que vistoriou", async () => {
        const tx = await registrarEmCadeia(4, CHASSI, 10900, TIPO.VISTORIA_SEGURADORA, { municipio: MUNICIPIO.VILA_VELHA });
        assert.equal((await pedir("eventos", contas.vistoria, { txHash: tx, chassi: CHASSI })).corpo.codigo, "seguradora_invalida");
        assert.equal((await pedir("eventos", contas.vistoria, { txHash: tx, chassi: CHASSI, seguradoraId: organizacoes.seguradora.id })).status, 201);
        const linha = (await bd("SELECT organizacao_id, seguradora_id FROM eventos WHERE tx_hash = $1", [tx.toLowerCase()])).rows[0];
        assert.deepEqual([linha.organizacao_id, linha.seguradora_id], [organizacoes.vistoria.id, organizacoes.seguradora.id]);
    });

    test("seguradora registra vistoria prévia: evento com a organização dela", async () => {
        const tx = await registrarEmCadeia(5, CHASSI, 11000, TIPO.SEGURO_VISTORIA_PREVIA, { municipio: MUNICIPIO.VILA_VELHA });
        assert.equal((await pedir("eventos", contas.seguradora, { txHash: tx, chassi: CHASSI })).status, 201);
        const linha = (await bd("SELECT organizacao_id, tipo_evento FROM eventos WHERE tx_hash = $1", [tx.toLowerCase()])).rows[0];
        assert.deepEqual([linha.organizacao_id, linha.tipo_evento], [organizacoes.seguradora.id, "Vistoria prévia de seguro"]);
    });

    test("transação inexistente: 409; identificador inválido: 400", async () => {
        const r = await pedir("eventos", contas.mecanico, { txHash: "0x" + "ab".repeat(32), chassi: CHASSI });
        assert.equal(r.status, 409);
        assert.equal(r.corpo.codigo, "transacao_pendente");
        assert.equal((await pedir("eventos", contas.mecanico, { txHash: "0x123", chassi: CHASSI })).corpo.codigo, "transacao_invalida");
    });

    test("transação de outro contrato: 422 contrato_diferente", async () => {
        const artefato = lerArtefato("KmChainRegistryV2.sol", "KmChainRegistryV2");
        const clone = await new ContractFactory(artefato.abi, artefato.bytecode, cadeia.carteiras[3]).deploy(ZeroHash.slice(0, 42));
        await clone.waitForDeployment();
        const tx = await (await clone.cadastrarVeiculo(chaveDoChassi(CHASSI), 1, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash)).wait();
        const r = await pedir("eventos", contas.mecanico, { txHash: tx.hash, chassi: CHASSI });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "contrato_diferente");
    });

    test("transação que reverteu: 422 transacao_falhou", async () => {
        const provedor = cadeia.provedor;
        // quilometragem menor que a ultima: o contrato reverte
        const dados = cadeia.contrato.interface.encodeFunctionData("registrarEvento", [chaveDoChassi(CHASSI), 1, TIPO.REVISAO, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash, true]);
        // Com mineracao automatica o Hardhat recusa enviar uma transacao que
        // vai reverter; sem ela, a transacao entra num bloco e falha la.
        await provedor.send("evm_setAutomine", [false]);
        let tx;
        try {
            tx = await cadeia.carteiras[3].sendTransaction({ to: process.env.KMCHAIN_ENDERECO, data: dados, gasLimit: 300000 });
            await provedor.send("evm_mine", []);
        } finally {
            await provedor.send("evm_setAutomine", [true]);
        }
        assert.equal((await provedor.waitForTransaction(tx.hash)).status, 0);
        const r = await pedir("eventos", contas.mecanico, { txHash: tx.hash, chassi: CHASSI });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "transacao_falhou");
    });

    test("conta sem vínculo não grava complemento: 403", async () => {
        assert.equal((await pedir("eventos", contas.semVinculo, { txHash: txRevisao, chassi: CHASSI })).status, 403);
    });

    test("registros da organização: cada uma vê os seus; o DETRAN vê todos", async () => {
        const daOficina = await obter("eventos", contas.oficina);
        assert.equal(daOficina.status, 200);
        assert.ok(daOficina.corpo.eventos.length >= 1);
        assert.ok(daOficina.corpo.eventos.every((e) => e.organizacao_nome === "Oficina ABC"));
        // o parametro nao deixa uma organizacao ver os registros de outra
        const tentativa = await obter(`eventos?organizacao=${organizacoes.vistoria.id}`, contas.oficina);
        assert.ok(tentativa.corpo.eventos.every((e) => e.organizacao_nome === "Oficina ABC"));
        const todos = await obter("eventos", contas.detran);
        assert.ok(new Set(todos.corpo.eventos.map((e) => e.organizacao_nome)).size >= 3);
        assert.equal((await obter("eventos", contas.semVinculo)).status, 403);
    });

    test("conta inteligente (EIP-7702/ERC-4337): autoria pelo contrato, não pelo envelope da transação", async () => {
        const artefato = lerArtefato("test/CarteiraInteligenteDeTeste.sol", "CarteiraInteligenteDeTeste");
        const dono = cadeia.carteiras[9];
        const carteira = await new ContractFactory(artefato.abi, artefato.bytecode, dono).deploy(await dono.getAddress());
        await carteira.waitForDeployment();
        const endereco = (await carteira.getAddress()).toLowerCase();
        await (await como(2).definirFuncionario(endereco, true)).wait();
        const criada = await bd(
            "INSERT INTO usuarios (nome, email, senha_hash, carteira) VALUES ('Conta Inteligente', 'inteligente@exemplo.test', 'x', $1) RETURNING id",
            [endereco]
        );
        const pessoa = { id: criada.rows[0].id, nome: "Conta Inteligente", email: "inteligente@exemplo.test" };
        const contrato = process.env.KMCHAIN_ENDERECO;
        const chamada = async (km) => cadeia.contrato.interface.encodeFunctionData(
            "registrarEvento", [chaveDoChassi(CHASSI), km, TIPO.REVISAO, await agoraCadeia(), MUNICIPIO.CACHOEIRO, ZeroHash, true]
        );

        // o envelope vai para a conta inteligente e sai do dono; o contrato ve a conta
        const tx = await (await carteira.executar(contrato, await chamada(20000))).wait();
        assert.notEqual(tx.to.toLowerCase(), contrato.toLowerCase());
        assert.notEqual(tx.from.toLowerCase(), endereco);
        const r = await pedir("eventos", pessoa, { txHash: tx.hash, chassi: CHASSI });
        assert.equal(r.status, 201);
        const linha = (await bd("SELECT carteira, tipo_evento FROM eventos WHERE tx_hash = $1", [tx.hash.toLowerCase()])).rows[0];
        assert.deepEqual([linha.carteira, linha.tipo_evento], [endereco, "Revisão"]);

        // lote com dois eventos do mesmo veiculo: nao da para saber a qual se refere
        const lote = await (await carteira.executarLote(contrato, [await chamada(20100), await chamada(20200)])).wait();
        const r2 = await pedir("eventos", pessoa, { txHash: lote.hash, chassi: CHASSI });
        assert.equal(r2.status, 422);
        assert.equal(r2.corpo.codigo, "varios_registros");
    });
});

// ----------------------------------------------------------- localizacao
describe("verificação da localização do dispositivo no registro", () => {
    let km = 30000;
    const conferir = (quem, extra) => pedir("eventos/conferir", quem, {
        chassi: CHASSI_LOCALIZACAO, tipo: quem === contas.detran ? TIPO.VISTORIA_DETRAN : TIPO.REVISAO, km: String(km + 1),
        dataEvento: new Date().toISOString(), municipio: MUNICIPIO.VITORIA, ...extra
    });
    // Registra em cadeia como o mecanico (ou o DETRAN) e envia o complemento.
    async function registrar(extra, quem = contas.mecanico) {
        km += 10;
        const tx = await registrarEmCadeia(quem.i, CHASSI_LOCALIZACAO, km, quem === contas.detran ? TIPO.VISTORIA_DETRAN : TIPO.REVISAO, { municipio: MUNICIPIO.VITORIA });
        const r = await pedir("eventos", quem, { chassi: CHASSI_LOCALIZACAO, txHash: tx, ...extra });
        const linha = (await bd("SELECT * FROM eventos WHERE tx_hash = $1", [tx.toLowerCase()])).rows[0];
        return { r, linha, tx };
    }
    const JUSTIFICATIVA = "Atendimento externo: veiculo imobilizado na residencia do proprietario.";

    before(async () => {
        await cadastrarVeiculo(CHASSI_LOCALIZACAO, 30000, { placa: "LOC1A23" });
    });

    test("dentro da tolerância: registro normal, sem justificativa; a precisão conta como margem", async () => {
        const previa = await conferir(contas.mecanico, { localizacao: posicao() });
        assert.equal(previa.status, 200);
        assert.deepEqual(previa.corpo.localizacao, { situacao: "VERIFICADA", distancia: 0 });

        const { r, linha } = await registrar({ localizacao: posicao() });
        assert.equal(r.status, 201);
        assert.equal(linha.localizacao_situacao, "VERIFICADA");
        assert.equal(linha.localizacao_distancia, 0);
        assert.equal(linha.localizacao_precisao, 20);
        assert.equal(linha.localizacao_justificativa, null);
        assert.ok(linha.localizacao_capturada_em instanceof Date);

        // cerca de 600 m da sede: fora dos 300 m com boa precisao, dentro com precisao de 400 m
        const a600m = { latitude: SEDE.latitude - 0.0054 };
        assert.equal((await conferir(contas.mecanico, { localizacao: posicao({ ...a600m, precisao: 400 }) })).corpo.localizacao.situacao, "VERIFICADA");
        assert.equal((await conferir(contas.mecanico, { localizacao: posicao({ ...a600m, precisao: 20 }) })).corpo.localizacao.situacao, "FORA_DA_AREA");
    });

    test("fora da tolerância sem justificativa: recusado antes e depois da assinatura", async () => {
        const previa = await conferir(contas.mecanico, { localizacao: posicao(LONGE) });
        assert.equal(previa.status, 400);
        assert.equal(previa.corpo.codigo, "justificativa_localizacao_obrigatoria");
        assert.equal(previa.corpo.localizacao.situacao, "FORA_DA_AREA");
        assert.ok(previa.corpo.localizacao.distancia > 4900 && previa.corpo.localizacao.distancia < 5100);
        assert.equal((await conferir(contas.mecanico, { localizacao: posicao(LONGE), justificativaLocalizacao: "curta" })).status, 400);

        const { r, linha } = await registrar({ localizacao: posicao(LONGE) });
        assert.equal(r.status, 400);
        assert.equal(r.corpo.codigo, "justificativa_localizacao_obrigatoria");
        assert.equal(linha, undefined, "nada é gravado sem a justificativa");
    });

    test("fora da tolerância com justificativa: permitido; distância e justificativa ficam no banco", async () => {
        assert.equal((await conferir(contas.mecanico, { localizacao: posicao(LONGE), justificativaLocalizacao: JUSTIFICATIVA })).status, 200);
        const { r, linha } = await registrar({ localizacao: posicao(LONGE), justificativaLocalizacao: JUSTIFICATIVA });
        assert.equal(r.status, 201);
        assert.equal(linha.localizacao_situacao, "FORA_DA_AREA");
        assert.ok(linha.localizacao_distancia > 4900 && linha.localizacao_distancia < 5100);
        assert.equal(linha.localizacao_justificativa, JUSTIFICATIVA);
        assert.equal(linha.justificativa, null, "não se confunde com a justificativa de correção");
    });

    test("localização indisponível: só com justificativa, e o motivo fica registrado", async () => {
        for (const localizacao of [null, {}, { motivo: "negada" }]) {
            const previa = await conferir(contas.mecanico, { localizacao });
            assert.equal(previa.status, 400);
            assert.equal(previa.corpo.localizacao.situacao, "INDISPONIVEL");
        }
        assert.equal((await registrar({ localizacao: { motivo: "negada" } })).r.status, 400);

        const { r, linha } = await registrar({ localizacao: { motivo: "negada" }, justificativaLocalizacao: JUSTIFICATIVA });
        assert.equal(r.status, 201);
        assert.deepEqual(
            [linha.localizacao_situacao, linha.localizacao_motivo, linha.localizacao_latitude, linha.localizacao_distancia],
            ["INDISPONIVEL", "negada", null, null]
        );
        assert.equal(linha.localizacao_justificativa, JUSTIFICATIVA);
    });

    test("baixa precisão: não é dada como verificada nem como distante; exige justificativa", async () => {
        const imprecisa = posicao({ precisao: 2000 });
        const previa = await conferir(contas.mecanico, { localizacao: imprecisa });
        assert.equal(previa.status, 400);
        assert.equal(previa.corpo.localizacao.situacao, "BAIXA_PRECISAO");
        const { r, linha } = await registrar({ localizacao: posicao({ ...LONGE, precisao: 2000 }), justificativaLocalizacao: JUSTIFICATIVA });
        assert.equal(r.status, 201);
        assert.deepEqual([linha.localizacao_situacao, linha.localizacao_precisao], ["BAIXA_PRECISAO", 2000]);
    });

    test("organização sem coordenadas cadastradas: sem referência, registro segue sem justificativa", async () => {
        // o DETRAN nao tem endereco cadastrado
        const previa = await conferir(contas.detran, { localizacao: posicao(LONGE) });
        assert.equal(previa.status, 200);
        assert.deepEqual(previa.corpo.localizacao, { situacao: "SEM_REFERENCIA", distancia: null });
        const { r, linha } = await registrar({ localizacao: posicao(LONGE) }, contas.detran);
        assert.equal(r.status, 201);
        assert.equal(linha.localizacao_situacao, "SEM_REFERENCIA");
        assert.equal(typeof linha.localizacao_latitude, "number", "a posição capturada fica guardada mesmo sem referência");
        // sem posicao nenhuma, o DETRAN tambem precisa justificar
        assert.equal((await conferir(contas.detran, { localizacao: null })).status, 400);
    });

    test("situação e distância enviadas pelo navegador são ignoradas: o servidor recalcula", async () => {
        const forjada = { ...posicao(LONGE), situacao: "VERIFICADA", distancia: 0 };
        const semJustificativa = await conferir(contas.mecanico, { localizacao: forjada, localizacaoSituacao: "VERIFICADA" });
        assert.equal(semJustificativa.status, 400, "declarar-se verificado não dispensa a justificativa");

        const { r, linha } = await registrar({ localizacao: forjada, localizacaoSituacao: "VERIFICADA", justificativaLocalizacao: JUSTIFICATIVA });
        assert.equal(r.status, 201);
        assert.equal(linha.localizacao_situacao, "FORA_DA_AREA");
        assert.ok(linha.localizacao_distancia > 4900);
    });

    test("posição malformada ou capturada há muito tempo: 400 localizacao_invalida", async () => {
        const casos = [
            posicao({ latitude: 200 }), posicao({ longitude: "abc" }), posicao({ precisao: -1 }), posicao({ capturadaEm: "ontem" }),
            posicao({ capturadaEm: new Date(Date.now() - 2 * 3600e3).toISOString() }),
            posicao({ capturadaEm: new Date(Date.now() + 3600e3).toISOString() })
        ];
        for (const localizacao of casos) {
            const r = await conferir(contas.mecanico, { localizacao, justificativaLocalizacao: JUSTIFICATIVA });
            assert.equal(r.status, 400);
            assert.equal(r.corpo.codigo, "localizacao_invalida");
        }
    });

    test("consulta pública: só o indicador de verificação; nenhuma coordenada, distância ou justificativa", async () => {
        const r = await obter(`veiculo?chassi=${CHASSI_LOCALIZACAO}`);
        assert.equal(r.status, 200);
        const verificadas = r.corpo.transacoes.map((t) => t.localizacao_verificada);
        // cadastro (sem verificacao), dentro, fora, indisponivel, baixa precisao, sem referencia, forjada
        assert.deepEqual(verificadas, [false, true, false, false, false, false, false]);
        assert.deepEqual(Object.keys(r.corpo.transacoes[1]).sort(), ["indice", "localizacao_verificada", "tx_hash"]);
        assert.doesNotMatch(JSON.stringify(r.corpo), /latitude|longitude|-20\.3|-40\.3|distancia|justificativa|imobilizado|precisao/i);
        assert.doesNotMatch(JSON.stringify((await obter("organizacoes")).corpo), /imobilizado|localizacao_/);
    });

    test("DETRAN consulta os detalhes e filtra localização divergente e não verificada", async () => {
        const divergentes = (await obter("eventos?localizacao=divergente", contas.detran)).corpo.eventos;
        assert.equal(divergentes.length, 2);
        assert.ok(divergentes.every((e) => e.localizacao_situacao === "FORA_DA_AREA"));
        const e = divergentes.at(-1);
        assert.equal(e.organizacao_nome, "Oficina ABC");
        assert.deepEqual([e.organizacao_logradouro, e.organizacao_municipio, e.organizacao_latitude], ["Rua Ficticia", MUNICIPIO.VITORIA, SEDE.latitude]);
        assert.ok(Math.abs(e.localizacao_latitude - (SEDE.latitude - 0.045)) < 1e-9);
        assert.equal(e.localizacao_precisao, 20);
        assert.ok(e.localizacao_distancia > 4900);
        assert.equal(e.localizacao_justificativa, JUSTIFICATIVA);
        assert.ok(e.localizacao_capturada_em);

        const naoVerificadas = (await obter("eventos?localizacao=nao_verificada", contas.detran)).corpo.eventos;
        assert.deepEqual(naoVerificadas.map((x) => x.localizacao_situacao).sort(), ["BAIXA_PRECISAO", "INDISPONIVEL"]);
        assert.equal(naoVerificadas.find((x) => x.localizacao_situacao === "INDISPONIVEL").localizacao_motivo, "negada");
    });

    test("organização comum vê só a situação dos próprios registros, nunca coordenadas", async () => {
        const daOficina = (await obter("eventos?localizacao=divergente", contas.oficina)).corpo.eventos;
        assert.ok(daOficina.some((e) => e.localizacao_situacao === "FORA_DA_AREA"));
        assert.ok(daOficina.some((e) => e.localizacao_situacao === "VERIFICADA"), "o filtro é só do DETRAN");
        assert.doesNotMatch(JSON.stringify(daOficina), /localizacao_latitude|localizacao_longitude|localizacao_justificativa|localizacao_distancia|organizacao_latitude/);

        // outra organizacao nao alcanca os registros da oficina, com ou sem filtro
        const daVistoria = (await obter(`eventos?organizacao=${organizacoes.oficina.id}&localizacao=divergente`, contas.vistoria)).corpo.eventos;
        assert.ok(daVistoria.every((e) => e.organizacao_nome === "Vistoria XYZ"));
        assert.doesNotMatch(JSON.stringify(daVistoria), /localizacao_latitude|imobilizado/);
        assert.equal((await obter("eventos?localizacao=divergente", contas.semVinculo)).status, 403);
        assert.equal((await obter("eventos?localizacao=divergente")).status, 401);
    });
});

// ------------------------------------------------------------ correcoes
describe("solicitação de correção e decisão do DETRAN", () => {
    const pdf = Buffer.from("%PDF-1.4\n% laudo ficticio da correcao\n%%EOF\n");
    const hashPdf = "0x" + createHash("sha256").update(pdf).digest("hex");
    const chave = chaveDoChassi(CHASSI_CORRECAO);
    let solicitacao;
    const solicitar = (quem, corpo) => pedir("correcoes", quem, { chassi: CHASSI_CORRECAO, ...corpo });
    const decidir = (quem, corpo) => pedir("correcoes", quem, corpo, "PATCH");

    before(async () => {
        // 0: cadastro 20.000 | 1: vistoria cautelar 25.000 | 2: revisao digitada errada, 251.000 (seria 25.100)
        await cadastrarVeiculo(CHASSI_CORRECAO, 20000, { placa: "COR1A23" });
        const txVistoria = await registrarEmCadeia(4, CHASSI_CORRECAO, 25000, TIPO.VISTORIA_CAUTELAR, { municipio: MUNICIPIO.VITORIA });
        await pedir("eventos", contas.vistoria, { txHash: txVistoria, chassi: CHASSI_CORRECAO });
        const txRevisao = await registrarEmCadeia(3, CHASSI_CORRECAO, 251000, TIPO.REVISAO);
        await pedir("eventos", contas.mecanico, { txHash: txRevisao, chassi: CHASSI_CORRECAO });
        await pedir("upload", contas.mecanico, { conteudoBase64: pdf.toString("base64"), chassi: CHASSI_CORRECAO, hash: hashPdf });
    });

    test("solicitação inválida: sem evidência, km igual, vistoria que não é vistoria, evento inexistente", async () => {
        const semEvidencia = await solicitar(contas.mecanico, { indice: 2, kmSolicitada: "25100", justificativa: "Erro de digitacao na revisao." });
        assert.equal(semEvidencia.status, 400);
        assert.ok(semEvidencia.corpo.campos.evidencia);
        const igual = await solicitar(contas.mecanico, { indice: 2, kmSolicitada: "251000", justificativa: "curta", hashEvidencia: hashPdf });
        assert.deepEqual(Object.keys(igual.corpo.campos).sort(), ["justificativa", "kmSolicitada"]);
        const naoVistoria = await solicitar(contas.mecanico, { indice: 2, kmSolicitada: "25100", justificativa: "Erro de digitacao na revisao.", vistoriaIndice: 0 });
        assert.ok(naoVistoria.corpo.campos.vistoriaIndice);
        // documento enviado por outra conta nao serve de evidencia
        const alheio = await solicitar(contas.vistoria, { indice: 2, kmSolicitada: "25100", justificativa: "Erro de digitacao na revisao.", hashEvidencia: hashPdf });
        assert.ok(alheio.corpo.campos.evidencia);
        assert.equal((await solicitar(contas.mecanico, { indice: 9, kmSolicitada: "1", justificativa: "Erro de digitacao.", hashEvidencia: hashPdf })).status, 404);
    });

    test("usuário público, conta sem vínculo e DETRAN não abrem solicitação", async () => {
        const corpo = { indice: 2, kmSolicitada: "25100", justificativa: "Erro de digitacao na revisao.", hashEvidencia: hashPdf };
        assert.equal((await solicitar(null, corpo)).status, 401);
        assert.equal((await solicitar(contas.semVinculo, corpo)).corpo.codigo, "sem_vinculo");
        assert.equal((await solicitar(contas.detran, corpo)).corpo.codigo, "sem_permissao");
    });

    test("organização abre a solicitação com documento e vistoria como evidência; fica pendente e auditada", async () => {
        const r = await solicitar(contas.mecanico, {
            indice: 2, kmSolicitada: "25100", justificativa: "Erro de digitacao: o hodometro marcava 25.100 km.",
            hashEvidencia: hashPdf, vistoriaIndice: 1
        });
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        solicitacao = r.corpo.solicitacao;
        assert.equal(solicitacao.situacao, "PENDENTE");
        assert.equal(Number(solicitacao.km_original), 251000);
        assert.equal(solicitacao.organizacao_id, organizacoes.oficina.id);
        assert.ok((await acoesDaAuditoria()).includes("correcao_solicitada"));
        // abrir a solicitacao nao muda nada em cadeia
        assert.equal((await cadeia.contrato.getHistorico(chave)).length, 3);

        const repetida = await solicitar(contas.mecanico, { indice: 2, kmSolicitada: "25200", justificativa: "Outra tentativa para o mesmo registro.", hashEvidencia: hashPdf, vistoriaIndice: 1 });
        assert.equal(repetida.status, 409);
        assert.equal(repetida.corpo.codigo, "solicitacao_em_analise");
    });

    test("cada organização vê só as próprias solicitações; o DETRAN vê todas, com o que precisa para analisar", async () => {
        assert.equal((await obter("correcoes", contas.oficina)).corpo.solicitacoes.length, 1);
        assert.equal((await obter("correcoes", contas.vistoria)).corpo.solicitacoes.length, 0);
        assert.equal((await obter(`correcoes?id=${solicitacao.id}`, contas.vistoria)).status, 404);
        assert.equal((await obter("correcoes", contas.semVinculo)).status, 403);

        const lista = await obter("correcoes?situacao=PENDENTE", contas.detran);
        assert.equal(lista.corpo.solicitacoes[0].organizacao_nome, "Oficina ABC");
        const d = (await obter(`correcoes?id=${solicitacao.id}`, contas.detran)).corpo;
        assert.equal(d.solicitacao.solicitante_nome, "Mecanico Teste");
        assert.equal(d.solicitacao.hash_evidencia, hashPdf);
        assert.equal(Number(d.original.quilometragem), 251000);
        assert.equal(d.original.organizacao_nome, "Oficina ABC");
        assert.deepEqual(
            [d.vistoria.tipo_evento, d.vistoria.organizacao_nome, d.vistoria.usuario_nome, d.vistoria.municipio_ibge],
            ["Vistoria cautelar", "Vistoria XYZ", "Vistoria Teste", MUNICIPIO.VITORIA]
        );
        assert.ok(d.vistoria.observada_em);
        // o DETRAN abre o documento de evidencia enviado pela oficina
        const link = await pedir("documento", contas.detran, { hash: hashPdf, ...(await assinar(1, (t) => mensagemDocumento(hashPdf, contas.detran.email, t))) });
        assert.equal(link.status, 200);
    });

    test("organização não aprova nem rejeita a própria solicitação", async () => {
        for (const decisao of ["aprovar", "rejeitar"]) {
            const r = await decidir(contas.oficina, { id: solicitacao.id, decisao, motivo: "Aprovacao pela propria oficina.", txHash: "0x" + "ab".repeat(32) });
            assert.equal(r.status, 403);
            assert.equal(r.corpo.codigo, "sem_permissao");
        }
        await assert.rejects(como(2).corrigirLeitura.staticCall(chave, 2, 25100, await agoraCadeia(), MUNICIPIO.CACHOEIRO, ZeroHash));
    });

    test("rejeição: nada vai para a blockchain; a decisão fica no banco, com motivo e auditoria", async () => {
        const outra = await solicitar(contas.mecanico, { indice: 1, kmSolicitada: "24000", justificativa: "Suspeita de leitura incorreta na vistoria.", hashEvidencia: hashPdf });
        assert.equal(outra.status, 201);
        const id = outra.corpo.solicitacao.id;
        assert.equal((await decidir(contas.detran, { id, decisao: "rejeitar", motivo: "" })).corpo.codigo, "motivo_invalido");
        assert.equal((await decidir(contas.detran, { id, decisao: "talvez" })).status, 400);

        const r = await decidir(contas.detran, { id, decisao: "rejeitar", motivo: "A vistoria apresentada confirma a leitura registrada." });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.solicitacao.situacao, "REJEITADA");
        assert.equal(r.corpo.solicitacao.analisada_por, contas.detran.id);
        assert.equal(r.corpo.solicitacao.correcao_tx, null);
        assert.equal((await cadeia.contrato.getHistorico(chave)).length, 3);
        assert.equal(await cadeia.contrato.correcaoDe(chave, 1), 0n);
        assert.ok((await acoesDaAuditoria()).includes("correcao_rejeitada"));
        assert.equal((await decidir(contas.detran, { id, decisao: "rejeitar", motivo: "Segunda decisao sobre o mesmo pedido." })).corpo.codigo, "solicitacao_ja_decidida");
    });

    test("aprovação: novo evento de correção referencia o original, que continua idêntico", async () => {
        const antes = Array.from(await cadeia.contrato.getEvento(chave, 2));
        const tx = await (await como(1).corrigirLeitura(chave, 2, 25100, await agoraCadeia(), MUNICIPIO.VITORIA, hashPdf)).wait();

        const r = await decidir(contas.detran, { id: solicitacao.id, decisao: "aprovar", txHash: tx.hash, motivo: "Vistoria e laudo confirmam o erro de digitacao." });
        assert.equal(r.status, 200, JSON.stringify(r.corpo));
        assert.equal(r.corpo.solicitacao.situacao, "APROVADA");
        assert.equal(r.corpo.solicitacao.correcao_indice, 3);

        const historico = await cadeia.contrato.getHistorico(chave);
        assert.equal(historico.length, 4);
        assert.deepEqual(Array.from(historico[2]), antes, "o registro original não foi alterado");
        const correcao = historico[3];
        assert.deepEqual(
            [Number(correcao.tipo), Number(correcao.km), Number(correcao.referencia), Number(correcao.municipio), Number(correcao.organizacao)],
            [TIPO.CORRECAO, 25100, 2, MUNICIPIO.VITORIA, 1]
        );
        assert.equal(correcao.hashDocumento, hashPdf);
        assert.equal(await cadeia.contrato.correcaoDe(chave, 2), 3n);
        assert.equal((await cadeia.contrato.getVeiculo(chave)).ultimaKm, 25100n);

        const linha = (await bd("SELECT tipo_evento, referencia_indice, justificativa, usuario_email FROM eventos WHERE chassi = $1 AND indice = 3", [CHASSI_CORRECAO])).rows[0];
        assert.deepEqual([linha.tipo_evento, linha.referencia_indice, linha.usuario_email], ["Correção de leitura", 2, "detran@exemplo.test"]);
        assert.match(linha.justificativa, /hodometro marcava 25\.100/);
        assert.ok((await acoesDaAuditoria()).includes("correcao_aprovada"));
        // quem solicitou acompanha a decisao
        const daOficina = (await obter(`correcoes?id=${solicitacao.id}`, contas.mecanico)).corpo.solicitacao;
        assert.deepEqual([daOficina.situacao, daOficina.analista_nome], ["APROVADA", "Detran Teste"]);

        assert.equal((await decidir(contas.detran, { id: solicitacao.id, decisao: "aprovar", txHash: tx.hash, motivo: "Segunda aprovacao do mesmo pedido." })).corpo.codigo, "solicitacao_ja_decidida");
        assert.equal((await solicitar(contas.mecanico, { indice: 2, kmSolicitada: "25150", justificativa: "Nova correcao do mesmo registro.", hashEvidencia: hashPdf })).corpo.codigo, "evento_ja_corrigido");
    });

    test("aprovação com transação que não é a correção solicitada: 422, e a solicitação continua pendente", async () => {
        const pedido = await solicitar(contas.mecanico, { indice: 0, kmSolicitada: "19000", justificativa: "Leitura inicial registrada a maior.", hashEvidencia: hashPdf });
        assert.equal(pedido.status, 201);
        const id = pedido.corpo.solicitacao.id;
        // correcao do mesmo evento, mas com outra quilometragem
        const tx = await (await como(1).corrigirLeitura(chave, 0, 19500, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash)).wait();
        const r = await decidir(contas.detran, { id, decisao: "aprovar", txHash: tx.hash, motivo: "Tentativa com transacao divergente." });
        assert.equal(r.status, 422);
        assert.equal(r.corpo.codigo, "correcao_nao_confere");
        assert.equal((await obter(`correcoes?id=${id}`, contas.detran)).corpo.solicitacao.situacao, "PENDENTE");
        // a mesma transacao vale como correcao de oficio, com justificativa
        assert.equal((await pedir("eventos", contas.detran, { txHash: tx.hash, chassi: CHASSI_CORRECAO })).corpo.codigo, "justificativa_invalida");
        assert.equal((await pedir("eventos", contas.detran, { txHash: tx.hash, chassi: CHASSI_CORRECAO, justificativa: "Correcao de oficio apos conferencia do laudo." })).status, 201);
    });
});

// ------------------------------------------------ dados complementares
describe("dados complementares do veículo (off-chain)", () => {
    const alterar = async (quem, campo, valores, chassi = CHASSI) => pedir("veiculo/alteracoes", quem, {
        chassi, campo, ...valores, ...(await assinar(quem.i, (t) => mensagemAlteracao(chassi, campo, quem.email, t)))
    });
    const consultar = async (quem) => pedir("veiculo/dados-complementares", quem, {
        chassi: CHASSI, ...(await assinar(quem.i, (t) => mensagemDadosComplementares(CHASSI, quem.email, t)))
    });
    const agoraIso = () => new Date().toISOString();

    test("consulta: só DETRAN; devolve identificação, datados e quem registrou cada evento", async () => {
        assert.equal((await consultar(contas.oficina)).status, 403);
        const ok = await consultar(contas.detran);
        assert.equal(ok.status, 200);
        assert.ok(ok.corpo.registros.length >= 5);
        assert.equal(ok.corpo.veiculo.modelo, "Uno Ficticio");
        assert.equal(ok.corpo.proprietarios[0].nome, "Novo Ficticio", "o vigente vem primeiro");
        assert.equal(ok.corpo.proprietarios.length, 2);
        const vistoria = ok.corpo.registros.find((r) => r.tipo_evento === "Vistoria a pedido de seguradora");
        assert.deepEqual([vistoria.organizacao_nome, vistoria.seguradora_nome], ["Vistoria XYZ", "Seguradora XYZ"]);
    });

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
        assert.equal((await alterar(contas.detran, "km", {})).status, 400);
        assert.equal((await bd("SELECT count(*)::int AS n FROM veiculo_placas WHERE chassi = $1", [CHASSI])).rows[0].n, 2);
    });

    test("veículo em cadeia sem identificação no banco: o DETRAN completa, sem conferência com a blockchain", async () => {
        const chassi = "KMCTESTE000000007";
        await (await como(1).cadastrarVeiculo(chaveDoChassi(chassi), 5000, await agoraCadeia(), MUNICIPIO.VITORIA, ZeroHash)).wait();
        const base = { placa: "HND2A16", marcaId: "honda", modelo: "CIVIC LXR AT", anoFabricacao: "2015", anoModelo: "2016", uf: "MG" };
        assert.equal((await alterar(contas.oficina, "identificacao", base, chassi)).status, 403);
        assert.equal((await alterar(contas.detran, "identificacao", base, chassi)).status, 201);
        assert.equal((await alterar(contas.detran, "identificacao", base, chassi)).status, 409, "não completa duas vezes");
        const origem = (await bd("SELECT origem, cadastro_tx FROM veiculos WHERE chassi = $1", [chassi])).rows[0];
        assert.deepEqual([origem.origem, origem.cadastro_tx], ["complemento", null]);
        const semCadeia = await alterar(contas.detran, "identificacao", { ...base, placa: "AAA1A11" }, "KMCTESTE000000009");
        assert.equal(semCadeia.status, 404);
        // a chave usada pela tela e pelo servidor e a que o contrato indexa, com qualquer grafia do chassi
        for (const digitado of [CHASSI, CHASSI.toLowerCase(), ` ${CHASSI.slice(0, 8)} ${CHASSI.slice(8)} `, `${CHASSI.slice(0, 3)}-${CHASSI.slice(3)}`]) {
            assert.equal(Number((await cadeia.contrato.getHistorico(chaveDoChassi(normalizarChassi(digitado))))[0].km), 10000, digitado);
        }
    });
});

// ------------------------------------------------ marcas fora da lista
describe("marca ausente da lista", () => {
    const propor = (quem, nome, confirmarDiferente) => pedir("marcas", quem, { nome, confirmarDiferente });

    test("lista pública traz a lista-base", async () => {
        const r = await obter("marcas");
        assert.equal(r.status, 200);
        assert.ok(r.corpo.marcas.some((m) => m.id === "volkswagen" && m.situacao === "lista"));
    });

    test("nome igual a uma marca da lista: 409; erro de digitação provável: 409 com sugestão", async () => {
        const igual = await propor(contas.detran, "volkswagen ");
        assert.equal(igual.status, 409);
        assert.equal(igual.corpo.marca.id, "volkswagen");
        const parecida = await propor(contas.detran, "Volksvagen");
        assert.equal(parecida.corpo.codigo, "marca_parecida");
        assert.ok(parecida.corpo.sugestoes.some((m) => m.id === "volkswagen"));
        assert.equal((await bd("SELECT count(*)::int AS n FROM marcas_adicionais")).rows[0].n, 0);
    });

    test("marca legítima nova entra pendente; oficina não propõe; cadastro com marca pendente é aceito", async () => {
        assert.equal((await propor(contas.oficina, "Marca Ficticia Rara")).status, 403);
        const r = await propor(contas.detran, "Marca Ficticia Rara");
        assert.equal(r.status, 201);
        assert.equal(r.corpo.marca.situacao, "pendente");

        const chassi = "KMCTESTE000000004";
        await cadastrarVeiculo(chassi, 150000, { placa: "DEF4G56", marcaId: "ad-marcaficticiarara", modelo: "Rara 1.0", anoFabricacao: "1998", anoModelo: "1998", uf: "RS" });
        const v = (await bd("SELECT marca_id, marca_nome FROM veiculos WHERE chassi = $1", [chassi])).rows[0];
        assert.deepEqual([v.marca_id, v.marca_nome], ["ad-marcaficticiarara", "Marca Ficticia Rara"]);
    });

    test("só o administrador do DETRAN revisa; recusada não volta a ser proposta", async () => {
        const revisar = (quem, id, decisao) => pedir("marcas", quem, { id, decisao }, "PATCH");
        assert.equal((await revisar(contas.detran, "ad-marcaficticiarara", "aprovar")).corpo.codigo, "apenas_administrador");
        assert.equal((await revisar(contas.oficina, "ad-marcaficticiarara", "aprovar")).status, 403);
        const aprovada = await revisar(contas.admin, "ad-marcaficticiarara", "aprovar");
        assert.equal(aprovada.corpo.marca.situacao, "aprovada");

        const outra = await propor(contas.detran, "Outra Ficticia Recusada");
        await revisar(contas.admin, outra.corpo.marca.id, "rejeitar");
        assert.equal((await propor(contas.detran, "Outra Ficticia Recusada")).corpo.codigo, "marca_rejeitada");
        assert.equal((await obter("marcas")).corpo.marcas.some((m) => m.nome === "Outra Ficticia Recusada"), false);
    });
});

// ------------------------------------------------------ consulta publica
describe("consulta pública", () => {
    const publica = (chassi) => obter(`veiculo?chassi=${chassi}`);

    test("identificação: placa e UF vigentes, marca e anos; nunca o proprietário nem quem registrou", async () => {
        const r = await publica(CHASSI.toLowerCase());
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.corpo.veiculo).sort(), ["ano_fabricacao", "ano_modelo", "marca_nome", "modelo", "placa", "uf"]);
        assert.equal(r.corpo.veiculo.placa, "XYZ9A99", "a placa vigente, não a do cadastro");
        assert.equal(r.corpo.veiculo.uf, "SP");
        assert.doesNotMatch(JSON.stringify(r.corpo), /Proprietario Ficticio|Novo Ficticio|Terceiro|cpf|exemplo\.test|Mecanico/i);
    });

    test("cada evento do histórico tem a transação que o registrou, para conferência no explorador", async () => {
        const r = await publica(CHASSI);
        const historico = await cadeia.contrato.getHistorico(chaveDoChassi(CHASSI));
        assert.deepEqual(r.corpo.transacoes.map((t) => t.indice), [0, 1, 2, 3, 4, 5]);
        assert.ok(historico.length >= r.corpo.transacoes.length);
        assert.ok(r.corpo.transacoes.every((t) => /^0x[0-9a-f]{64}$/.test(t.tx_hash)));
    });

    test("o histórico em cadeia dá local e organização de cada evento, que a lista pública traduz em nomes", async () => {
        const historico = await cadeia.contrato.getHistorico(chaveDoChassi(CHASSI));
        const nomes = Object.fromEntries((await obter("organizacoes")).corpo.organizacoes.map((o) => [o.id_cadeia, o.nome_fantasia]));
        const linhas = historico.slice(0, 5).map((e) => [nomes[Number(e.organizacao)], rotuloDoMunicipio(e.municipio)]);
        assert.deepEqual(linhas, [
            ["DETRAN", "Vitória - ES"],
            ["Oficina ABC", "Cachoeiro de Itapemirim - ES"],
            ["DETRAN", "Vitória - ES"],
            ["Vistoria XYZ", "Vila Velha - ES"],
            ["Seguradora XYZ", "Vila Velha - ES"]
        ]);
    });

    test("veículo sem identificação: null; chassi inválido: 400", async () => {
        assert.equal((await publica(CHASSI_SEM_CADASTRO)).corpo.veiculo, null);
        assert.equal((await publica("ABC")).status, 400);
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

// ------------------------------------------------------------ auditoria
describe("auditoria administrativa", () => {
    test("só o DETRAN consulta; traz quem fez, por qual organização e o alvo, sem dados pessoais", async () => {
        assert.equal((await obter("auditoria", contas.oficina)).status, 403);
        assert.equal((await obter("auditoria")).status, 401);
        const r = await obter("auditoria", contas.detran);
        assert.equal(r.status, 200);
        const acoes = new Set(r.corpo.registros.map((l) => l.acao));
        for (const acao of [
            "organizacao_criada", "organizacao_credenciada", "organizacao_suspensa", "organizacao_reativada", "organizacao_alterada",
            "administrador_definido", "administrador_alterado", "funcionario_cadastrado", "funcionario_desativado",
            "correcao_solicitada", "correcao_aprovada", "correcao_rejeitada"
        ]) assert.ok(acoes.has(acao), acao);
        const solicitada = r.corpo.registros.find((l) => l.acao === "correcao_solicitada");
        assert.deepEqual([solicitada.usuario_nome, solicitada.organizacao_nome], ["Mecanico Teste", "Oficina ABC"]);
        assert.doesNotMatch(JSON.stringify(r.corpo), /cpf|\d{11}/i);

        const filtrado = await obter("auditoria?acao=correcao_aprovada", contas.detran);
        assert.ok(filtrado.corpo.registros.length >= 1);
        assert.ok(filtrado.corpo.registros.every((l) => l.acao === "correcao_aprovada"));
    });
});

// ---------------------------------------------------------- comprovantes
describe("comprovantes (/api/upload e /api/documento)", () => {
    const pdf = Buffer.from("%PDF-1.4\n% comprovante ficticio de teste\n%%EOF\n");
    const hashPdf = "0x" + createHash("sha256").update(pdf).digest("hex");
    const enviarArquivo = (quem, bytes = pdf, hash = hashPdf) => pedir("upload", quem, { conteudoBase64: bytes.toString("base64"), chassi: CHASSI, hash });
    const pedirLink = async (quem, hash = hashPdf) => pedir("documento", quem, { hash, ...(await assinar(quem.i, (t) => mensagemDocumento(hash, quem.email, t))) });
    const abrir = (quem, url) => obter(url.replace(/^\/api\//, ""), quem);

    test("upload sem sessão: 401; sem vínculo: 403", async () => {
        assert.equal((await enviarArquivo(null)).status, 401);
        assert.equal((await enviarArquivo(contas.semVinculo)).status, 403);
    });

    test("upload de tipo não aceito: 415; hash que não confere: 400; acima de 3 MB: 413", async () => {
        const html = Buffer.from("<html><script>alert(1)</script></html>");
        const hashHtml = "0x" + createHash("sha256").update(html).digest("hex");
        assert.equal((await enviarArquivo(contas.oficina, html, hashHtml)).status, 415);
        assert.equal((await enviarArquivo(contas.oficina, pdf, "0x" + "00".repeat(32))).status, 400);
        const grande = Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(3 * 1024 * 1024)]);
        assert.equal((await enviarArquivo(contas.oficina, grande, "0x" + createHash("sha256").update(grande).digest("hex"))).status, 413);
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
        assert.equal((await abrir(contas.oficina, link.corpo.url)).status, 410, "uso único");
    });

    test("link não serve para outra sessão e expira", async () => {
        const link = await pedirLink(contas.oficina);
        assert.equal((await abrir(contas.detran, link.corpo.url)).status, 410);

        const outro = await pedirLink(contas.oficina);
        await bd("UPDATE tokens_documento SET expira_em = now() - interval '1 second' WHERE usado_em IS NULL");
        assert.equal((await abrir(contas.oficina, outro.corpo.url)).status, 410);

        const semSessao = await abrir(null, outro.corpo.url);
        assert.equal(semSessao.status, 401);
        assert.match(semSessao.cabecalhos["content-type"], /text\/plain/);
    });

    test("outra organização não abre o comprovante; DETRAN abre", async () => {
        for (const quem of [contas.vistoria, contas.seguradora]) {
            const negado = await pedirLink(quem);
            assert.equal(negado.status, 403);
            assert.equal(negado.corpo.codigo, "sem_acesso_documento");
        }
        assert.equal((await pedirLink(contas.detran)).status, 200);
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
            assert.equal((await abrir(contas.detran, link.corpo.url)).status, 409);
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
        assert.equal((await pedirLink(contas.oficina)).status, 429);
    });
});
