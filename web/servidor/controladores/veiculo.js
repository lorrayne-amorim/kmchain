// Rotas dos dados do veiculo mantidos fora da blockchain e da auditoria.
import { ErroHttp, parametro } from "../nucleo/http.js";
import { listarAuditoria } from "../servicos/auditoria.js";
import { SO_DETRAN, exigirMembro, exigirMembroComAssinatura } from "../servicos/autorizacao.js";
import { validarCadastro } from "../servicos/cadastroVeiculo.js";
import * as veiculos from "../servicos/veiculos.js";
import { mensagemAlteracao, mensagemDadosComplementares } from "../../src/lib/mensagens.js";
import { chassiValido, normalizarChassi } from "../../src/lib/chassi.js";

function chassiDe(valor) {
    const chassi = normalizarChassi(valor);
    if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");
    return chassi;
}

// GET /api/veiculo?chassi=...: identificacao PUBLICA. Vem do banco, nao da
// blockchain, e nunca traz proprietario, CPF nem quem registrou.
export async function identificacaoPublica(req, res) {
    const chassi = chassiDe(parametro(req, "chassi"));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(await veiculos.identificacaoPublica(chassi));
}

// POST /api/veiculo: confere um cadastro novo ANTES da assinatura (DETRAN).
export async function conferirCadastro(req, res) {
    await exigirMembro(req, { tipos: SO_DETRAN });
    const dados = await validarCadastro(req.body);
    res.status(200).json({ ok: true, chave: dados.chave, marca: dados.marca });
}

// POST /api/veiculo/dados-complementares: identificacao, placa, UF e
// proprietario com historico, e quem realizou cada registro. So DETRAN,
// com a carteira assinando na hora.
export async function dadosComplementares(req, res) {
    const { emitidoEm } = req.body ?? {};
    const chassi = chassiDe(req.body?.chassi);
    await exigirMembroComAssinatura(req, { tipos: SO_DETRAN }, (email) => mensagemDadosComplementares(chassi, email, emitidoEm));
    res.status(200).json(await veiculos.consultarDadosComplementares(chassi));
}

// POST /api/veiculo/alteracoes: nova placa, UF ou proprietario (datados), ou
// a identificacao de um veiculo que esta em cadeia sem cadastro. So DETRAN,
// com a carteira assinando na hora.
export async function alteracoes(req, res) {
    const corpo = req.body ?? {};
    const campo = corpo.campo;
    if (!veiculos.CAMPOS_ALTERAVEIS.includes(campo)) {
        throw new ErroHttp(400, "campo_invalido", "Escolha placa, UF ou proprietário.");
    }
    const chassi = chassiDe(corpo.chassi);
    const { usuario } = await exigirMembroComAssinatura(
        req, { tipos: SO_DETRAN }, (email) => mensagemAlteracao(chassi, campo, email, corpo.emitidoEm)
    );
    if (campo === "identificacao") await veiculos.completarIdentificacao(chassi, corpo, usuario);
    else await veiculos.registrarAlteracaoDoVeiculo(chassi, campo, corpo, usuario);
    res.status(201).json({ ok: true });
}

// GET /api/auditoria[?acao=]: trilha das acoes administrativas, so para o DETRAN.
export async function auditoria(req, res) {
    await exigirMembro(req, { tipos: SO_DETRAN });
    res.status(200).json({ registros: await listarAuditoria({ acao: parametro(req, "acao") }) });
}
