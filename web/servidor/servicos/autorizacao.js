// Regras de acesso das rotas, num lugar so. O acesso tem tres camadas:
//   1. sessao de login valida (a PESSOA);
//   2. carteira vinculada a essa conta;
//   3. vinculo ATIVO dessa carteira com uma organizacao ATIVA, lido direto do
//      contrato. Nao existe lista paralela de quem pode o que: a organizacao,
//      o tipo dela e o papel de administrador vem sempre da blockchain.
// Nas leituras sensiveis a carteira ainda assina uma mensagem na hora.
import { bd } from "../nucleo/banco.js";
import { contrato, naRede, recuperarAssinante } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import { sessaoAtual } from "../nucleo/sessao.js";
import { TIPO_ORGANIZACAO, organizacaoPodeRegistrar, rotuloDaOrganizacao, rotuloDoEvento } from "../../src/lib/eventos.js";

export const SO_DETRAN = [TIPO_ORGANIZACAO.DETRAN];
// Oficinas, empresas de vistoria e seguradoras: quem o DETRAN credencia.
export const CREDENCIADAS = [TIPO_ORGANIZACAO.OFICINA, TIPO_ORGANIZACAO.VISTORIA, TIPO_ORGANIZACAO.SEGURADORA];

// Situacao de uma carteira no contrato: organizacao, tipo, se esta ativa e se administra.
export async function vinculoDaCarteira(carteira) {
    const v = await naRede(contrato().vinculoDe(carteira));
    return {
        organizacao: Number(v.organizacao),
        tipo: Number(v.tipo),
        organizacaoAtiva: v.organizacaoAtiva,
        ativo: v.ativo,
        administrador: v.administrador
    };
}

// Camada 1: sessao valida e a conta ainda existe no banco.
export async function exigirConta(req) {
    const sessao = sessaoAtual(req);
    if (!sessao) throw new ErroHttp(401, "sem_sessao", "Faça login para continuar.");
    const r = await bd("SELECT id, nome, email, carteira FROM usuarios WHERE id = $1", [sessao.id]);
    const usuario = r.rows[0];
    if (!usuario) throw new ErroHttp(401, "sem_sessao", "Faça login para continuar.");
    return usuario;
}

function exigirCarteiraVinculada(usuario) {
    if (!usuario.carteira) {
        throw new ErroHttp(403, "carteira_nao_vinculada", "Vincule a carteira à sua conta para continuar.");
    }
}

// Confere o vinculo contra o que a rota exige: `tipos` de organizacao
// aceitos e, se `administrador`, o papel de administrador.
export function validarVinculo(vinculo, { tipos, administrador = false } = {}) {
    if (!vinculo.ativo) {
        throw new ErroHttp(403, "sem_vinculo", "Sua conta não tem vínculo ativo com uma organização credenciada.");
    }
    if (!vinculo.organizacaoAtiva) {
        throw new ErroHttp(403, "organizacao_suspensa", "O credenciamento da sua organização está suspenso.");
    }
    if (tipos && !tipos.includes(vinculo.tipo)) {
        throw new ErroHttp(403, "sem_permissao", `Esta ação não está disponível para ${rotuloDaOrganizacao(vinculo.tipo)}.`);
    }
    if (administrador && !vinculo.administrador) {
        throw new ErroHttp(403, "apenas_administrador", "Apenas o administrador da organização pode fazer isso.");
    }
}

// Verifica se a organizacao pode registrar o tipo de evento informado.
export function validarOrganizacaoPodeRegistrarEvento(vinculo, codigoEvento) {
    if (!organizacaoPodeRegistrar(vinculo.tipo, codigoEvento)) {
        throw new ErroHttp(
            403, "tipo_nao_permitido",
            `${rotuloDaOrganizacao(vinculo.tipo)} não registra eventos do tipo “${rotuloDoEvento(codigoEvento)}”.`
        );
    }
}

async function montarAcesso(usuario, carteira, regras) {
    const vinculo = await vinculoDaCarteira(carteira);
    validarVinculo(vinculo, regras);
    const r = await bd("SELECT * FROM organizacoes WHERE id_cadeia = $1", [vinculo.organizacao]);
    const organizacao = r.rows[0];
    if (!organizacao) {
        throw new ErroHttp(409, "organizacao_sem_cadastro", "A organização desta carteira não tem cadastro no KMChain. Fale com o DETRAN.");
    }
    return { usuario, carteira: carteira.toLowerCase(), vinculo, organizacao };
}

// Camadas 1 a 3, sem assinatura na hora: usado quando a acao sozinha nao
// entrega dado sensivel (ex.: enviar um comprovante).
export async function exigirMembro(req, regras) {
    const usuario = await exigirConta(req);
    exigirCarteiraVinculada(usuario);
    return montarAcesso(usuario, usuario.carteira, regras);
}

// Camadas 1 a 3 com assinatura na hora, para leituras sensiveis. A mensagem
// e montada pela rota (com o e-mail da SESSAO), nunca aceita pronta.
export async function exigirMembroComAssinatura(req, regras, montarMensagem) {
    const usuario = await exigirConta(req);
    exigirCarteiraVinculada(usuario);
    const { emitidoEm, assinatura } = req.body ?? {};
    const assinante = recuperarAssinante(montarMensagem(usuario.email, emitidoEm), emitidoEm, assinatura);
    if (assinante.toLowerCase() !== usuario.carteira.toLowerCase()) {
        throw new ErroHttp(403, "carteira_diferente", "A carteira conectada não é a vinculada à sua conta. Troque de conta na MetaMask.");
    }
    return montarAcesso(usuario, assinante, regras);
}

export const ehDetran = (acesso) => acesso.vinculo.tipo === TIPO_ORGANIZACAO.DETRAN;
