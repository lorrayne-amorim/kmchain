// Rotas de organizacoes, contas e funcionarios.
import { bd } from "../nucleo/banco.js";
import { ErroHttp, parametro } from "../nucleo/http.js";
import { buscarOrganizacao } from "../repositorios/organizacoes.js";
import { SO_DETRAN, ehDetran, exigirMembro, exigirMembroComAssinatura } from "../servicos/autorizacao.js";
import { listarFuncionarios, sincronizarFuncionario } from "../servicos/funcionarios.js";
import * as servico from "../servicos/organizacoes.js";
import { mensagemContas } from "../../src/lib/mensagens.js";

// GET /api/organizacoes: lista publica (mapa e nome de quem registrou cada evento).
export async function listarPublicas(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ organizacoes: await servico.listarOrganizacoesPublicas() });
}

// GET /api/organizacoes/gestao: cadastro completo, so para o DETRAN.
export async function listarParaGestao(req, res) {
    await exigirMembro(req, { tipos: SO_DETRAN });
    res.status(200).json({ organizacoes: await servico.listarOrganizacoesParaGestao() });
}

// POST /api/organizacoes: o DETRAN cadastra a organizacao, que fica pendente
// ate a transacao de credenciamento ser confirmada.
export async function cadastrar(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    res.status(201).json(await servico.cadastrarOrganizacao(req.body ?? {}, acesso));
}

// PATCH /api/organizacoes: o DETRAN altera os dados cadastrais.
export async function atualizar(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    const organizacao = await servico.atualizarCadastroDaOrganizacao(req.body?.id, req.body ?? {}, acesso);
    res.status(200).json({ organizacao });
}

// POST /api/organizacoes/credenciamento: confirma a transacao que credenciou.
export async function confirmarCredenciamento(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    const r = await servico.confirmarCredenciamento(req.body?.id, req.body?.txHash, acesso);
    res.status(r.jaCredenciada ? 200 : 201).json(r);
}

// POST /api/organizacoes/sincronizar: espelha situacao e administrador do contrato.
export async function sincronizar(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    res.status(200).json({ organizacao: await servico.sincronizarOrganizacaoComContrato(req.body?.id, acesso) });
}

// POST /api/auth/pendentes: contas cadastradas, para o DETRAN localizar quem
// pediu acesso. Exige a carteira assinando na hora.
export async function listarContas(req, res) {
    const { emitidoEm } = req.body ?? {};
    await exigirMembroComAssinatura(req, { tipos: SO_DETRAN }, (email) => mensagemContas(email, emitidoEm));
    const r = await bd("SELECT nome, email, carteira, criado_em FROM usuarios ORDER BY criado_em DESC LIMIT 200");
    res.status(200).json({ contas: r.rows });
}

// POST /api/contas/localizar: acha a conta de um e-mail para vincula-la. O
// DETRAN usa ao indicar um administrador; o administrador, ao vincular um
// funcionario da propria organizacao.
export async function localizarConta(req, res) {
    const acesso = await exigirMembro(req);
    if (!ehDetran(acesso) && !acesso.vinculo.administrador) {
        throw new ErroHttp(403, "apenas_administrador", "Apenas o administrador da organização pode vincular funcionários.");
    }
    // O DETRAN pode indicar a organizacao de destino (troca de administrador);
    // os demais so vinculam a propria.
    let destino = acesso.organizacao;
    if (ehDetran(acesso) && req.body?.organizacaoId) destino = await buscarOrganizacao(Number(req.body.organizacaoId));
    const { conta } = await servico.localizarContaParaVinculo(req.body?.email, destino?.id_cadeia ?? null);
    res.status(200).json({ conta: { nome: conta.nome, email: conta.email, carteira: conta.carteira } });
}

// POST /api/contas/carteira: o DETRAN informa ou troca a carteira de uma conta.
export async function definirCarteira(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    const conta = await servico.definirCarteiraDaConta(req.body?.email, req.body?.carteira, acesso);
    res.status(200).json({ conta: { nome: conta.nome, email: conta.email, carteira: conta.carteira } });
}

// GET /api/funcionarios[?organizacao=id]: equipe da organizacao.
export async function listarEquipe(req, res) {
    const acesso = await exigirMembro(req);
    if (!ehDetran(acesso) && !acesso.vinculo.administrador) {
        throw new ErroHttp(403, "apenas_administrador", "Apenas o administrador da organização vê a equipe.");
    }
    res.status(200).json(await listarFuncionarios(parametro(req, "organizacao"), acesso));
}

// POST /api/funcionarios/sincronizar: espelha o vinculo de uma carteira
// depois que o administrador o alterou no contrato.
export async function sincronizarEquipe(req, res) {
    const acesso = await exigirMembro(req, { administrador: true });
    res.status(200).json({ funcionario: await sincronizarFuncionario(req.body?.carteira, acesso) });
}
