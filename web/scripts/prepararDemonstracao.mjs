// Cria o cenario de demonstracao (demo/cenario.mjs) num ambiente LIMPO.
//
// O script faz o que uma pessoa faria pela tela, na mesma ordem e pelos
// mesmos caminhos: chama as rotas /api da aplicacao em execucao e ASSINA
// cada transacao no contrato com a carteira da conta responsavel. Nada e
// escrito direto no banco, e nenhum evento e criado sem existir no contrato.
//
// O que ele simula: a posicao do dispositivo em cada registro (a tela usaria
// a geolocalizacao do navegador) e as datas dos eventos, nos ultimos 30 dias.
//
// Uso (com a aplicacao no ar):
//   npm run demo:preparar                              ambiente local
//   npm run demo:preparar -- --rede=sepolia            Sepolia (ver docs/AMBIENTE.md)
//   npm run demo:preparar -- --rede=sepolia --financiar
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, NonceManager, Wallet, ZeroHash, formatEther, getCreateAddress, parseEther } from "ethers";
import { CONTAS as ORDEM_DAS_CONTAS, CHAVES_HARDHAT, chavesDaDemonstracao } from "../demo/carteiras.mjs";
import { CONTAS, ORGANIZACOES, VEICULOS } from "../demo/cenario.mjs";
import { chaveDoChassi } from "../src/lib/chassi.js";
import { TIPO_ORGANIZACAO, rotuloDoEvento } from "../src/lib/eventos.js";
import { mensagemVinculo } from "../src/lib/mensagens.js";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumento = (nome) => process.argv.find((a) => a.startsWith(`--${nome}`))?.split("=")[1];
const rede = argumento("rede") ?? "local";
const financiar = process.argv.includes("--financiar");
const BASE = process.env.DEMO_URL ?? "http://localhost:5173";
const SALDO_MINIMO = parseEther("0.004");
const RECARGA = parseEther("0.01");

if (!["local", "sepolia"].includes(rede)) throw new Error("Use --rede=local ou --rede=sepolia.");
const senha = process.env.DEMO_SENHA ?? (rede === "local" ? "demo-kmchain-local" : null);
if (!senha || senha.length < 8) throw new Error("Defina DEMO_SENHA (8 caracteres ou mais) com a senha das contas de demonstracao.");

// ------------------------------------------------------------ blockchain
const lerEnv = (arquivo, chave) => readFileSync(path.join(raiz, arquivo), "utf8").match(new RegExp(`^${chave}=(.*)$`, "m"))?.[1].trim();
const abi = JSON.parse(readFileSync(path.join(raiz, "src", "lib", "KmChainRegistryV2.abi.json"), "utf8"));
const rpc = rede === "local" ? "http://127.0.0.1:8545" : (process.env.DEMO_RPC_URL ?? lerEnv(".env", "VITE_RPC_URL"));
const provedor = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const chaves = chavesDaDemonstracao(rede);
const carteiras = Object.fromEntries(ORDEM_DAS_CONTAS.map((conta) => [conta, new NonceManager(new Wallet(chaves[conta], provedor))]));
const enderecoDe = (conta) => new Wallet(chaves[conta]).address;
// No ambiente local o contrato e a primeira transacao da primeira conta do Hardhat.
const endereco = rede === "local"
    ? getCreateAddress({ from: new Wallet(CHAVES_HARDHAT[0]).address, nonce: 0 })
    : JSON.parse(readFileSync(path.join(raiz, "src", "lib", "endereco.json"), "utf8")).endereco;
if (!endereco) throw new Error("O contrato ainda nao foi implantado: src/lib/endereco.json esta sem endereco.");
const contrato = (conta) => new Contract(endereco, abi, carteiras[conta]);
const leitura = new Contract(endereco, abi, provedor);
const agoraNaCadeia = async () => (await provedor.getBlock("latest")).timestamp;

async function transacao(descricao, envio) {
    const tx = await envio;
    await tx.wait();
    console.log(`    transacao: ${descricao} (${tx.hash.slice(0, 12)}...)`);
    return tx.hash;
}

// ------------------------------------------------------------------- api
const sessoes = {};
async function api(rota, { conta, metodo = "POST", corpo } = {}) {
    const resposta = await fetch(`${BASE}/api/${rota}`, {
        method: metodo,
        headers: { ...(corpo && { "Content-Type": "application/json" }), ...(conta && { Cookie: sessoes[conta] }) },
        body: corpo ? JSON.stringify(corpo) : undefined
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
        throw Object.assign(new Error(`${metodo} /api/${rota} -> ${resposta.status}: ${dados.erro ?? ""} ${JSON.stringify(dados.campos ?? "")}`), { status: resposta.status, dados });
    }
    const cookie = resposta.headers.get("set-cookie");
    return { dados, cookie: cookie?.split(";")[0] };
}

// ---------------------------------------------------------------- dados
function digitoCnpj(base) {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const resto = base.split("").reduce((soma, d, i) => soma + Number(d) * pesos[i], 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
}
const cnpjDe = (raizCnpj) => { const d1 = digitoCnpj(raizCnpj); return raizCnpj + d1 + digitoCnpj(raizCnpj + d1); };
function digitoCpf(base) {
    const resto = (base.split("").reduce((soma, d, i) => soma + Number(d) * (base.length + 1 - i), 0) * 10) % 11;
    return resto === 10 ? 0 : resto;
}
const cpfDe = (raizCpf) => { const d1 = digitoCpf(raizCpf); return raizCpf + d1 + digitoCpf(raizCpf + d1); };

// Instante de um evento ocorrido ha `dias` dias, em horario comercial.
function dataDoEvento(dias, ordem) {
    const data = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    if (dias > 0) data.setHours(9 + (ordem % 8), 12 + 7 * ordem, 0, 0);
    else data.setSeconds(0, 0);
    return data;
}
const emSegundos = (data) => Math.floor(data.getTime() / 1000);

const organizacaoDaConta = (conta) => Object.values(ORGANIZACOES).find((o) => o.administrador === conta || o.funcionarios.includes(conta));
// O que a geolocalizacao do navegador entregaria com o dispositivo na sede.
function posicaoNaSede(conta) {
    const o = organizacaoDaConta(conta);
    return o ? { latitude: o.latitude, longitude: o.longitude } : { latitude: -20.3155, longitude: -40.3128 };
}
const capturada = (posicao) => (posicao.motivo ? posicao : { ...posicao, precisao: 25, capturadaEm: new Date().toISOString() });

// ---------------------------------------------------------------- etapas
async function conferirAmbiente() {
    const { dados } = await api("organizacoes", { metodo: "GET" }).catch(() => {
        throw new Error(`A aplicacao nao respondeu em ${BASE}. Suba o ambiente antes (npm run demo:local ou npm run dev).`);
    });
    if (dados.organizacoes.some((o) => o.tipo !== "DETRAN")) {
        throw new Error("O ambiente ja tem organizacoes cadastradas. O cenario so e criado num ambiente limpo (veja docs/AMBIENTE.md).");
    }
    const vinculo = await leitura.vinculoDe(enderecoDe("detran.admin"));
    if (!vinculo.administrador || Number(vinculo.tipo) !== TIPO_ORGANIZACAO.DETRAN) {
        throw new Error("A carteira detran.admin nao e a administradora do DETRAN neste contrato: ela precisa ser a carteira que fez o deploy.");
    }
    if (Number(await leitura.totalOrganizacoes()) !== 1) {
        throw new Error("Este contrato ja tem organizacoes credenciadas, mas o banco esta limpo. Implante um contrato novo para a demonstracao.");
    }
}

async function conferirSaldos() {
    if (rede === "local") return;
    const semSaldo = [];
    for (const conta of ORDEM_DAS_CONTAS) {
        const saldo = await provedor.getBalance(enderecoDe(conta));
        console.log(`  ${conta.padEnd(24)} ${enderecoDe(conta)}  ${formatEther(saldo)} ETH`);
        if (saldo < SALDO_MINIMO) semSaldo.push(conta);
    }
    if (semSaldo.length === 0) return;
    if (!financiar || semSaldo.includes("detran.admin")) {
        throw new Error(`Carteiras sem saldo para as taxas: ${semSaldo.join(", ")}. Envie ETH de teste a elas ou rode com --financiar (a detran.admin transfere ${formatEther(RECARGA)} ETH a cada uma).`);
    }
    for (const conta of semSaldo) {
        await transacao(`recarga de ${conta}`, carteiras["detran.admin"].sendTransaction({ to: enderecoDe(conta), value: RECARGA }));
    }
}

async function criarContas() {
    for (const conta of ORDEM_DAS_CONTAS) {
        const { nome, email } = CONTAS[conta];
        const { cookie } = await api("auth/cadastrar", { corpo: { nome, email, senha } })
            .catch((erro) => (erro.status === 409 ? api("auth/entrar", { corpo: { email, senha } }) : Promise.reject(erro)));
        sessoes[conta] = cookie;
        // a carteira prova, por assinatura, que pertence a conta
        const carteira = enderecoDe(conta);
        const emitidoEm = Date.now();
        const assinatura = await carteiras[conta].signMessage(mensagemVinculo(carteira, email, emitidoEm));
        await api("auth/vincular-carteira", { conta, corpo: { carteira, emitidoEm, assinatura } });
        console.log(`  ${email}  ->  ${carteira}`);
    }
}

async function vincularFuncionario(administrador, funcionario) {
    await transacao(`vinculo de ${funcionario}`, contrato(administrador).definirFuncionario(enderecoDe(funcionario), true));
    await api("funcionarios/sincronizar", { conta: administrador, corpo: { carteira: enderecoDe(funcionario) } });
}

async function credenciarOrganizacoes() {
    // o primeiro acesso do administrador espelha no banco o vinculo que o contrato ja tem
    await api("auth/eu", { conta: "detran.admin", metodo: "GET" });
    await vincularFuncionario("detran.admin", "detran.funcionario");

    const ids = {};
    for (const [chave, o] of Object.entries(ORGANIZACOES)) {
        console.log(`  ${o.nomeFantasia}`);
        const { dados } = await api("organizacoes", {
            conta: "detran.admin",
            corpo: { ...o, cnpj: cnpjDe(o.raizCnpj), municipio: String(o.municipio), administradorEmail: CONTAS[o.administrador].email }
        });
        const { tipo, administrador } = dados.credenciamento;
        const txHash = await transacao("credenciamento", contrato("detran.admin").credenciarOrganizacao(tipo, administrador));
        await api("organizacoes/credenciamento", { conta: "detran.admin", corpo: { id: dados.organizacao.id, txHash } });
        for (const funcionario of o.funcionarios) await vincularFuncionario(o.administrador, funcionario);
        ids[chave] = dados.organizacao.id;
    }
    return ids;
}

async function cadastrarVeiculo(v) {
    const data = dataDoEvento(v.cadastro.diasAtras, 0);
    const identificacao = {
        chassi: v.chassi, placa: v.placa, marcaId: v.marcaId, modelo: v.modelo, anoFabricacao: v.anoFabricacao, anoModelo: v.anoModelo,
        uf: v.uf, nomeProprietario: v.proprietario.nome, cpfProprietario: cpfDe(v.proprietario.raizCpf)
    };
    await api("veiculo", {
        conta: "detran.funcionario",
        corpo: { ...identificacao, kmInicial: String(v.cadastro.km), dataEvento: data.toISOString(), municipio: v.cadastro.municipio }
    });
    const txHash = await transacao(`cadastro, ${v.cadastro.km} km`, contrato("detran.funcionario").cadastrarVeiculo(
        chaveDoChassi(v.chassi), v.cadastro.km, emSegundos(data), v.cadastro.municipio, ZeroHash
    ));
    await api("eventos", { conta: "detran.funcionario", corpo: { ...identificacao, txHash } });
}

async function registrarEvento(v, e, ordem, idsDasOrganizacoes) {
    const data = dataDoEvento(e.diasAtras, ordem);
    const municipio = e.municipio ?? organizacaoDaConta(e.por).municipio;
    const complemento = {
        ...(e.seguradora && { seguradoraId: idsDasOrganizacoes[e.seguradora] }),
        localizacao: capturada(e.posicao ?? posicaoNaSede(e.por)),
        ...(e.justificativaLocalizacao && { justificativaLocalizacao: e.justificativaLocalizacao })
    };
    const { dados } = await api("eventos/conferir", {
        conta: e.por,
        corpo: { chassi: v.chassi, tipo: e.tipo, km: String(e.km), dataEvento: data.toISOString(), municipio, ...complemento }
    });
    const txHash = await transacao(`${rotuloDoEvento(e.tipo)}, ${e.km} km, localizacao ${dados.localizacao.situacao}`, contrato(e.por).registrarEvento(
        chaveDoChassi(v.chassi), e.km, e.tipo, emSegundos(data), municipio, ZeroHash, Boolean(e.confirmarAtipica)
    ));
    await api("eventos", { conta: e.por, corpo: { chassi: v.chassi, txHash, ...complemento } });
}

async function tratarCorrecao(v) {
    const c = v.correcao;
    const { dados } = await api("correcoes", {
        conta: c.solicitante,
        corpo: { chassi: v.chassi, indice: c.indice, kmSolicitada: String(c.kmSolicitada), justificativa: c.justificativa, vistoriaIndice: c.vistoriaIndice }
    });
    console.log(`    solicitacao de correcao aberta por ${c.solicitante}`);
    if (c.decisao !== "aprovar") return console.log("    (fica em analise, para o DETRAN decidir ao vivo)");

    const txHash = await transacao(`correcao para ${c.kmSolicitada} km`, contrato("detran.funcionario").corrigirLeitura(
        chaveDoChassi(v.chassi), c.indice, c.kmSolicitada, await agoraNaCadeia(), ORGANIZACOES.vistoria.municipio, ZeroHash
    ));
    await api("correcoes", { conta: "detran.funcionario", metodo: "PATCH", corpo: { id: dados.solicitacao.id, decisao: "aprovar", motivo: c.motivo, txHash } });
}

// Confere, como a consulta publica faria, que o banco e o contrato contam a mesma historia.
async function validarConsultaPublica() {
    for (const v of VEICULOS) {
        const emCadeia = await leitura.getHistorico(chaveDoChassi(v.chassi));
        const { dados } = await api(`veiculo?chassi=${v.chassi}`, { metodo: "GET" });
        if (emCadeia.length !== dados.transacoes.length || !dados.veiculo) {
            throw new Error(`${v.chassi}: ${emCadeia.length} eventos no contrato e ${dados.transacoes.length} complementos no banco.`);
        }
        console.log(`  ${v.chassi}  ${dados.veiculo.marca_nome} ${dados.veiculo.modelo}: ${emCadeia.length} eventos no contrato e no banco`);
    }
}

// ------------------------------------------------------------------ fluxo
console.log(`Demonstracao em ${BASE} | rede ${rede} | contrato ${endereco}\n`);
await conferirAmbiente();
console.log("Carteiras");
await conferirSaldos();
console.log("Contas e carteiras vinculadas");
await criarContas();
console.log("Organizacoes, administradores e funcionarios");
const idsDasOrganizacoes = await credenciarOrganizacoes();
for (const v of VEICULOS) {
    console.log(`Veiculo ${v.cenario} (${v.chassi})`);
    await cadastrarVeiculo(v);
    for (const [i, e] of v.eventos.entries()) await registrarEvento(v, e, i + 1, idsDasOrganizacoes);
    if (v.correcao) await tratarCorrecao(v);
}
console.log("Consulta publica");
await validarConsultaPublica();
console.log(`\nCenario criado. Consulta de exemplo: ${BASE}/?chassi=${VEICULOS[0].chassi}`);
provedor.destroy();
