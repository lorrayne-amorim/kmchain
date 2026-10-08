// Vinculos das carteiras com as organizacoes: funcionarios e administradores.
//
// Quem cria e altera um vinculo e o contrato: o administrador vincula e
// desativa funcionarios, e o DETRAN define os administradores. O servidor so
// ESPELHA no banco o que o contrato mostra para cada carteira, e registra a
// auditoria. O vinculo e da carteira: ela pode ser vinculada antes de a
// pessoa ter conta, e a conta assume o vinculo quando vincula essa carteira.
import { ErroHttp } from "../nucleo/http.js";
import { buscarOrganizacao, buscarOrganizacaoPorIdCadeia } from "../repositorios/organizacoes.js";
import * as membros from "../repositorios/membros.js";
import { ACOES, registrarAuditoria } from "./auditoria.js";
import { ehDetran, vinculoDaCarteira } from "./autorizacao.js";

const curta = (carteira) => `${carteira.slice(0, 8)}…${carteira.slice(-4)}`;

// Acao de auditoria que descreve a passagem do vinculo anterior para o atual.
function acaoDoVinculo(anterior, atual) {
    if (!anterior) {
        if (!atual.ativo) return null;
        return atual.papel === "administrador" ? ACOES.ADMINISTRADOR_DEFINIDO : ACOES.FUNCIONARIO_CADASTRADO;
    }
    if (anterior.ativo && !atual.ativo) return ACOES.FUNCIONARIO_DESATIVADO;
    if (!anterior.ativo && atual.ativo) return ACOES.FUNCIONARIO_REATIVADO;
    if (anterior.papel !== atual.papel) {
        return atual.papel === "administrador" ? ACOES.ADMINISTRADOR_DEFINIDO : ACOES.ADMINISTRADOR_REMOVIDO;
    }
    return null;
}

// Grava no banco o vinculo que o contrato mostra para a carteira: na equipe,
// se a carteira ja pertence a uma conta, ou na lista de carteiras que
// aguardam conta. `acesso` e quem fez a alteracao, para a auditoria.
export async function espelharVinculo(carteira, vinculo, organizacao, acesso = null) {
    const atual = { ativo: vinculo.ativo, papel: vinculo.administrador ? "administrador" : "funcionario" };
    const conta = await membros.buscarContaPorCarteira(carteira);

    let anterior;
    if (conta) {
        anterior = await membros.salvarMembro({ organizacaoId: organizacao.id, usuarioId: conta.id, carteira: conta.carteira, ...atual });
        await membros.removerVinculoSemConta(carteira);
    } else {
        anterior = await membros.buscarVinculoSemConta(carteira);
        if (anterior) anterior = { ...anterior, ativo: true };
        if (atual.ativo) await membros.salvarVinculoSemConta(carteira, organizacao.id, atual.papel);
        else await membros.removerVinculoSemConta(carteira);
    }

    const acao = acesso && acaoDoVinculo(anterior, atual);
    if (acao) {
        await registrarAuditoria(acao, acesso, { tipo: conta ? "usuario" : "carteira", id: conta?.id ?? carteira.toLowerCase() }, {
            funcionario: conta?.nome ?? `carteira ${curta(carteira)}`, organizacao: organizacao.nome_fantasia
        });
    }
    return { nome: conta?.nome ?? null, email: conta?.email ?? null, carteira: carteira.toLowerCase(), semConta: !conta, ...atual };
}

// Espelha o vinculo de uma carteira depois de uma alteracao no contrato. O
// administrador so alcanca carteiras da propria organizacao; o DETRAN, as de
// qualquer uma (e ele quem define os administradores).
export async function sincronizarVinculo(carteira, acesso) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
        throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.");
    }
    if (!ehDetran(acesso) && !acesso.vinculo.administrador) {
        throw new ErroHttp(403, "apenas_administrador", "Apenas o administrador da organização pode fazer isso.");
    }
    const vinculo = await vinculoDaCarteira(carteira);
    if (!ehDetran(acesso) && vinculo.organizacao !== acesso.vinculo.organizacao) {
        throw new ErroHttp(403, "outra_organizacao", "Esta carteira não pertence à sua organização.");
    }
    const organizacao = await buscarOrganizacaoPorIdCadeia(vinculo.organizacao);
    if (!organizacao) throw new ErroHttp(404, "sem_vinculo_no_contrato", "Esta carteira não tem vínculo com uma organização no contrato.");
    return espelharVinculo(carteira, vinculo, organizacao, acesso);
}

// Equipe de uma organizacao: quem tem conta e as carteiras ja vinculadas no
// contrato que ainda aguardam a criacao da conta. O administrador ve a da
// propria organizacao; o DETRAN, a de qualquer uma.
export async function listarFuncionarios(organizacaoId, acesso) {
    const alvo = organizacaoId ? Number(organizacaoId) : acesso.organizacao.id;
    if (alvo !== acesso.organizacao.id && !ehDetran(acesso)) {
        throw new ErroHttp(403, "outra_organizacao", "Você só pode ver os funcionários da sua organização.");
    }
    const organizacao = await buscarOrganizacao(alvo);
    if (!organizacao) throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada.");
    return {
        organizacao: { id: organizacao.id, id_cadeia: organizacao.id_cadeia, nome_fantasia: organizacao.nome_fantasia, tipo: organizacao.tipo },
        funcionarios: await membros.listarMembros(alvo),
        aguardando: await membros.listarVinculosSemConta(alvo)
    };
}

// A conta logada assume o vinculo que o contrato ja tem para a carteira dela:
// e assim que a pessoa credenciada pela carteira passa a ver a organizacao e
// o papel ao vincular a carteira a conta.
export async function espelharVinculoDaConta(usuario, vinculo) {
    if (!vinculo.ativo) return null;
    const organizacao = await buscarOrganizacaoPorIdCadeia(vinculo.organizacao);
    if (!organizacao) return null;
    await espelharVinculo(usuario.carteira, vinculo, organizacao);
    return organizacao;
}

// Tira uma pessoa da lista da equipe. O contrato nao apaga vinculos, so os
// desativa: por isso a remocao exige o vinculo ja desativado em cadeia, e o
// que sai e a linha do banco. O administrador remove da propria organizacao;
// o DETRAN, de qualquer uma. A auditoria guarda quem saiu.
export async function removerVinculo(carteira, organizacaoId, acesso) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
        throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.");
    }
    if (!ehDetran(acesso) && !acesso.vinculo.administrador) {
        throw new ErroHttp(403, "apenas_administrador", "Apenas o administrador da organização pode fazer isso.");
    }
    const alvo = organizacaoId ? Number(organizacaoId) : acesso.organizacao.id;
    if (alvo !== acesso.organizacao.id && !ehDetran(acesso)) {
        throw new ErroHttp(403, "outra_organizacao", "Você só pode remover funcionários da sua organização.");
    }
    const organizacao = await buscarOrganizacao(alvo);
    if (!organizacao) throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada.");

    const vinculo = await vinculoDaCarteira(carteira);
    if (vinculo.ativo && vinculo.organizacao === organizacao.id_cadeia) {
        throw new ErroHttp(409, "vinculo_ativo", vinculo.administrador
            ? "Esta carteira administra a organização. O DETRAN precisa retirar a administração dela antes da remoção."
            : "O vínculo ainda está ativo no contrato. Desative-o antes de remover.");
    }
    const removido = await membros.removerDaEquipe(organizacao.id, carteira);
    if (!removido) throw new ErroHttp(404, "vinculo_nao_encontrado", "Esta carteira não está na equipe.");

    await registrarAuditoria(ACOES.FUNCIONARIO_REMOVIDO, acesso, { tipo: removido.id ? "usuario" : "carteira", id: removido.id ?? carteira.toLowerCase() }, {
        funcionario: removido.nome ?? `carteira ${curta(carteira)}`, organizacao: organizacao.nome_fantasia
    });
    return { carteira: carteira.toLowerCase(), nome: removido.nome };
}
