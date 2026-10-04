// Chamadas as rotas /api que guardam e consultam o que fica FORA da
// blockchain: o complemento de cada evento, a identificacao do veiculo e os
// dados do proprietario. Ficam no banco do KMChain, atras de login.
import { assinarComCarteira, chamarApi } from "./api";
import { mensagemAlteracao, mensagemContas, mensagemDadosComplementares } from "./mensagens";

// Confere, antes da assinatura, se a organizacao de quem pede pode registrar
// o evento e se os dados estao em ordem. Recusa com `dados.campos` por campo.
export const conferirEvento = (dados) =>
    chamarApi("eventos/conferir", { corpo: dados, padrao: "Não foi possível conferir o registro." });

// Chamado depois de uma transacao confirmada (cadastro, evento ou correcao).
// O servidor le o evento no contrato; daqui so vao o hash da transacao e os
// dados complementares. Pode ser repetido sem duplicar o registro.
export const registrarComplemento = (dados) =>
    chamarApi("eventos", { corpo: dados, padrao: "Não foi possível salvar os dados complementares." });

// Confere o cadastro no servidor ANTES da assinatura; recusa com `dados.campos`.
export const conferirCadastro = (dados) =>
    chamarApi("veiculo", { corpo: dados, padrao: "Não foi possível conferir o cadastro." });

// Eventos registrados pela organizacao. O DETRAN ve os de todas, com os
// detalhes da verificacao de localizacao, e pode filtrar por
// "divergente" ou "nao_verificada".
export async function listarEventosDaOrganizacao(localizacao) {
    const filtro = localizacao ? `?localizacao=${localizacao}` : "";
    const { eventos } = await chamarApi(`eventos${filtro}`, { metodo: "GET", padrao: "Não foi possível carregar os registros." });
    return eventos;
}

// Exclusivo do DETRAN: assina na hora e recebe a identificacao do veiculo,
// placa, UF e proprietario (com historico) e quem realizou cada registro.
export async function consultarDadosComplementares(chassi) {
    const prova = await assinarComCarteira((email, emitidoEm) => mensagemDadosComplementares(chassi, email, emitidoEm));
    return chamarApi("veiculo/dados-complementares", {
        corpo: { chassi, ...prova },
        padrao: "Não foi possível consultar os dados complementares."
    });
}

// Exclusivo do DETRAN: nova placa, UF ou proprietario, com a data em que
// passou a valer. Nada anterior e apagado.
export async function alterarDado(chassi, campo, valores) {
    const prova = await assinarComCarteira((email, emitidoEm) => mensagemAlteracao(chassi, campo, email, emitidoEm));
    return chamarApi("veiculo/alteracoes", {
        corpo: { chassi, campo, ...valores, ...prova },
        padrao: "Não foi possível registrar a alteração."
    });
}

// Exclusivo do DETRAN: contas de login, para achar quem pediu acesso.
export async function contasCadastradas() {
    const prova = await assinarComCarteira(mensagemContas);
    const { contas } = await chamarApi("auth/pendentes", { corpo: prova, padrao: "Não foi possível carregar as contas." });
    return contas;
}

// Exclusivo do DETRAN: trilha das acoes administrativas.
export async function carregarAuditoria(acao) {
    const filtro = acao ? `?acao=${acao}` : "";
    const { registros } = await chamarApi(`auditoria${filtro}`, { metodo: "GET", padrao: "Não foi possível carregar a auditoria." });
    return registros;
}
