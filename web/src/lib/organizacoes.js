// Organizacoes e funcionarios: o cadastro fica no servidor; credenciar,
// suspender, trocar o administrador e vincular funcionarios sao transacoes
// assinadas no contrato, que o servidor depois espelha.
import { chamarApi } from "./api";
import { contratoEscrita } from "./blockchain";

// Lista publica: nome, tipo, endereco, coordenadas e situacao.
export async function listarOrganizacoes() {
    const { organizacoes } = await chamarApi("organizacoes", { metodo: "GET", padrao: "Não foi possível carregar as organizações." });
    return organizacoes;
}

// Cadastro completo, so para o DETRAN.
export async function listarOrganizacoesParaGestao() {
    const { organizacoes } = await chamarApi("organizacoes/gestao", { metodo: "GET", padrao: "Não foi possível carregar as organizações." });
    return organizacoes;
}

export const cadastrarOrganizacao = (dados) =>
    chamarApi("organizacoes", { corpo: dados, padrao: "Não foi possível cadastrar a organização." });

export const atualizarOrganizacao = (id, dados) =>
    chamarApi("organizacoes", { metodo: "PATCH", corpo: { ...dados, id }, padrao: "Não foi possível alterar o cadastro." });

// Assina uma transacao no contrato, avisando a tela de cada passo.
async function assinar(enviar, aoMudarPasso) {
    aoMudarPasso("assinatura");
    const tx = await enviar(await contratoEscrita());
    aoMudarPasso("confirmacao");
    await tx.wait();
    return tx.hash;
}

const sincronizarOrganizacao = (id) =>
    chamarApi("organizacoes/sincronizar", { corpo: { id }, padrao: "Não foi possível atualizar a situação da organização." });

// O DETRAN assina o credenciamento e o servidor confere a transacao.
export async function credenciarOrganizacao(organizacao, aoMudarPasso = () => {}) {
    const { tipo, administrador } = organizacao.credenciamento;
    const txHash = await assinar((contrato) => contrato.credenciarOrganizacao(tipo, administrador), aoMudarPasso);
    return chamarApi("organizacoes/credenciamento", {
        corpo: { id: organizacao.id, txHash }, padrao: "Não foi possível confirmar o credenciamento."
    });
}

// Suspende ou reativa: a organizacao suspensa nao registra novos eventos.
export async function definirSituacaoDaOrganizacao(organizacao, ativa, aoMudarPasso = () => {}) {
    await assinar((contrato) => contrato.definirSituacaoDaOrganizacao(organizacao.id_cadeia, ativa), aoMudarPasso);
    return sincronizarOrganizacao(organizacao.id);
}

export async function trocarAdministrador(organizacao, carteira, aoMudarPasso = () => {}) {
    await assinar((contrato) => contrato.definirAdministrador(organizacao.id_cadeia, carteira), aoMudarPasso);
    return sincronizarOrganizacao(organizacao.id);
}

// Acha a conta de um e-mail para vincula-la a uma organizacao.
export async function localizarConta(email, organizacaoId) {
    const { conta } = await chamarApi("contas/localizar", { corpo: { email, organizacaoId }, padrao: "Não foi possível localizar a conta." });
    return conta;
}

export const listarFuncionarios = (organizacaoId) =>
    chamarApi(`funcionarios${organizacaoId ? `?organizacao=${organizacaoId}` : ""}`, { metodo: "GET", padrao: "Não foi possível carregar a equipe." });

// O administrador vincula ou desativa um funcionario da propria organizacao.
export async function definirFuncionario(carteira, ativo, aoMudarPasso = () => {}) {
    await assinar((contrato) => contrato.definirFuncionario(carteira, ativo), aoMudarPasso);
    return chamarApi("funcionarios/sincronizar", { corpo: { carteira }, padrao: "Não foi possível atualizar a equipe." });
}
