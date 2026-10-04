// Funcionarios de uma organizacao. Quem vincula e desativa e o
// administrador, assinando no contrato; o servidor espelha o resultado no
// banco e registra a auditoria.
import { ErroHttp } from "../nucleo/http.js";
import { buscarOrganizacao, buscarOrganizacaoPorIdCadeia, definirAdministrador } from "../repositorios/organizacoes.js";
import { buscarContaPorCarteira, listarMembros, salvarMembro } from "../repositorios/membros.js";
import { ACOES, registrarAuditoria } from "./auditoria.js";
import { ehDetran, vinculoDaCarteira } from "./autorizacao.js";

// Espelha no banco o vinculo que o contrato mostra para `carteira`. So vale
// para carteiras da organizacao de quem pede: um administrador nao alcanca
// funcionarios de outra organizacao.
export async function sincronizarFuncionario(carteira, acesso) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
        throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.");
    }
    const vinculo = await vinculoDaCarteira(carteira);
    if (vinculo.organizacao !== acesso.vinculo.organizacao) {
        throw new ErroHttp(403, "outra_organizacao", "Esta carteira não pertence à sua organização.");
    }
    const conta = await buscarContaPorCarteira(carteira);
    if (!conta) throw new ErroHttp(404, "conta_nao_encontrada", "Não há conta com esta carteira vinculada.");

    const anterior = await salvarMembro({
        organizacaoId: acesso.organizacao.id, usuarioId: conta.id, carteira: conta.carteira,
        papel: vinculo.administrador ? "administrador" : "funcionario", ativo: vinculo.ativo
    });

    let acao = null;
    if (!anterior) acao = vinculo.ativo ? ACOES.FUNCIONARIO_CADASTRADO : null;
    else if (anterior.ativo && !vinculo.ativo) acao = ACOES.FUNCIONARIO_DESATIVADO;
    else if (!anterior.ativo && vinculo.ativo) acao = ACOES.FUNCIONARIO_REATIVADO;
    if (acao) {
        await registrarAuditoria(acao, acesso, { tipo: "usuario", id: conta.id }, {
            funcionario: conta.nome, organizacao: acesso.organizacao.nome_fantasia
        });
    }
    return { nome: conta.nome, email: conta.email, carteira: conta.carteira, ativo: vinculo.ativo };
}

// Funcionarios de uma organizacao. O administrador ve os da propria; o DETRAN, os de qualquer uma.
export async function listarFuncionarios(organizacaoId, acesso) {
    const alvo = organizacaoId ? Number(organizacaoId) : acesso.organizacao.id;
    if (alvo !== acesso.organizacao.id && !ehDetran(acesso)) {
        throw new ErroHttp(403, "outra_organizacao", "Você só pode ver os funcionários da sua organização.");
    }
    const organizacao = await buscarOrganizacao(alvo);
    if (!organizacao) throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada.");
    return { organizacao: { id: organizacao.id, nome_fantasia: organizacao.nome_fantasia, tipo: organizacao.tipo }, funcionarios: await listarMembros(alvo) };
}

// Garante que a conta logada aparece na equipe da organizacao a que o
// contrato a vincula (ex.: quem implantou o contrato e o primeiro
// administrador do DETRAN e nao passou pelo cadastro de funcionarios).
export async function espelharVinculoDaConta(usuario, vinculo) {
    if (!vinculo.ativo) return null;
    const organizacao = await buscarOrganizacaoPorIdCadeia(vinculo.organizacao);
    if (!organizacao) return null;
    await salvarMembro({
        organizacaoId: organizacao.id, usuarioId: usuario.id, carteira: usuario.carteira,
        papel: vinculo.administrador ? "administrador" : "funcionario", ativo: true
    });
    if (vinculo.administrador && organizacao.administrador_id !== usuario.id) {
        await definirAdministrador(organizacao.id, usuario.id);
    }
    return organizacao;
}
