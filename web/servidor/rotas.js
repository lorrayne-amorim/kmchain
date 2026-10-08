// Tabela de rotas do backend e o despacho de cada requisicao.
//
// Todas as rotas /api passam por uma unica Serverless Function
// (api/index.js): o plano gratuito da Vercel limita a quantidade de functions
// por deploy, e uma function por arquivo de rota nao comportaria o sistema.
// Cada entrada liga METODO + caminho a um controlador; a regra de negocio
// fica em servicos/ e o acesso ao banco em repositorios/.
import { responderErro } from "./nucleo/http.js";
import * as auth from "./controladores/auth.js";
import * as documento from "./controladores/documento.js";
import * as eventos from "./controladores/eventos.js";
import * as marcas from "./controladores/marcas.js";
import * as organizacoes from "./controladores/organizacoes.js";
import { enviarComprovante } from "./controladores/upload.js";
import * as veiculo from "./controladores/veiculo.js";

export const ROTAS = {
    "auth/cadastrar": { POST: auth.cadastrarConta },
    "auth/entrar": { POST: auth.entrar },
    "auth/eu": { GET: auth.sessaoDaConta, DELETE: auth.sairDaConta },
    "auth/vincular-carteira": { POST: auth.vincularCarteira },
    "auth/redefinir-senha": { POST: auth.redefinirSenha },
    "auth/pendentes": { POST: organizacoes.listarContas },
    "contas/localizar": { POST: organizacoes.localizarConta },
    "contas/carteira": { POST: organizacoes.definirCarteira },

    "organizacoes": { GET: organizacoes.listarPublicas, POST: organizacoes.cadastrar, PATCH: organizacoes.atualizar },
    "organizacoes/gestao": { GET: organizacoes.listarParaGestao },
    "organizacoes/credenciamento": { POST: organizacoes.confirmarCredenciamento },
    "organizacoes/sincronizar": { POST: organizacoes.sincronizar },
    "organizacoes/remover": { POST: organizacoes.remover },
    "funcionarios": { GET: organizacoes.listarEquipe },
    "funcionarios/sincronizar": { POST: organizacoes.sincronizarEquipe },
    "funcionarios/remover": { POST: organizacoes.removerDaEquipe },

    "eventos": { GET: eventos.listar, POST: eventos.registrar },
    "eventos/conferir": { POST: eventos.conferir },
    "correcoes": { GET: eventos.listarCorrecoes, POST: eventos.solicitarCorrecao, PATCH: eventos.decidirCorrecao },

    "veiculo": { GET: veiculo.identificacaoPublica, POST: veiculo.conferirCadastro },
    "veiculo/dados-complementares": { POST: veiculo.dadosComplementares },
    "veiculo/alteracoes": { POST: veiculo.alteracoes },
    "marcas": { GET: marcas.listar, POST: marcas.propor, PATCH: marcas.revisar },
    "upload": { POST: enviarComprovante },
    "documento": { GET: documento.entregar, POST: documento.pedirAcesso },
    "auditoria": { GET: veiculo.auditoria }
};

// Caminho da rota, sem "/api/". Na Vercel ele chega no parametro `rota`
// (ver vercel.json); no desenvolvimento e nos testes, na propria URL.
function caminhoDaRota(req) {
    const url = new URL(req.url ?? "/", "http://local");
    const rota = req.query?.rota ?? url.searchParams.get("rota") ?? url.pathname.replace(/^\/api\/?/, "");
    return String(Array.isArray(rota) ? rota.join("/") : rota).replace(/^\/+|\/+$/g, "");
}

export async function rotear(req, res) {
    const caminho = caminhoDaRota(req);
    const metodos = ROTAS[caminho];
    if (!metodos) return res.status(404).json({ erro: "Rota não encontrada.", codigo: "rota" });
    const controlador = metodos[req.method];
    if (!controlador) {
        return res.status(405).json({ erro: `Use ${Object.keys(metodos).join(" ou ")}.`, codigo: "metodo" });
    }
    try {
        await controlador(req, res);
    } catch (erro) {
        responderErro(res, erro, caminho);
    }
}
