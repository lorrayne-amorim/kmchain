// Rotas de eventos e de solicitacoes de correcao.
import { ErroHttp, parametro } from "../nucleo/http.js";
import { CREDENCIADAS, SO_DETRAN, exigirMembro } from "../servicos/autorizacao.js";
import * as correcoes from "../servicos/correcoes.js";
import * as eventos from "../servicos/eventos.js";

// POST /api/eventos/conferir: valida permissao e dados antes da assinatura.
export async function conferir(req, res) {
    const acesso = await exigirMembro(req);
    res.status(200).json(await eventos.conferirEvento(req.body, acesso));
}

// POST /api/eventos: guarda o complemento off-chain de um evento confirmado.
export async function registrar(req, res) {
    const acesso = await exigirMembro(req);
    const r = await eventos.registrarEvento(req.body, acesso);
    res.status(r.jaRegistrado ? 200 : 201).json(r);
}

// GET /api/eventos[?organizacao=id][&localizacao=divergente|nao_verificada]:
// eventos da propria organizacao. O DETRAN ve todos, com os detalhes da
// verificacao de localizacao; os filtros so valem para ele.
export async function listar(req, res) {
    const acesso = await exigirMembro(req);
    const filtros = { organizacaoId: parametro(req, "organizacao"), localizacao: parametro(req, "localizacao") };
    res.status(200).json({ eventos: await eventos.listarEventosDaOrganizacao(acesso, filtros) });
}

// GET /api/correcoes[?id=][&situacao=]: lista ou detalha solicitacoes.
export async function listarCorrecoes(req, res) {
    const acesso = await exigirMembro(req);
    const id = parametro(req, "id");
    if (id) return res.status(200).json(await correcoes.detalharSolicitacao(id, acesso));
    res.status(200).json({ solicitacoes: await correcoes.listarSolicitacoes(acesso, parametro(req, "situacao")) });
}

// POST /api/correcoes: oficina, empresa de vistoria ou seguradora abre a solicitacao.
export async function solicitarCorrecao(req, res) {
    const acesso = await exigirMembro(req, { tipos: CREDENCIADAS });
    res.status(201).json({ solicitacao: await correcoes.criarSolicitacaoDeCorrecao(req.body, acesso) });
}

// PATCH /api/correcoes: o DETRAN aprova (com a transacao da correcao) ou rejeita.
export async function decidirCorrecao(req, res) {
    const acesso = await exigirMembro(req, { tipos: SO_DETRAN });
    const { id, decisao } = req.body ?? {};
    if (decisao === "aprovar") {
        return res.status(200).json({ solicitacao: await correcoes.aprovarSolicitacao(id, req.body, acesso) });
    }
    if (decisao === "rejeitar") {
        return res.status(200).json({ solicitacao: await correcoes.rejeitarSolicitacao(id, req.body, acesso) });
    }
    throw new ErroHttp(400, "decisao_invalida", "Escolha aprovar ou rejeitar.");
}
