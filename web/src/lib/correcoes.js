// Solicitacoes de correcao: abertas por oficinas, empresas de vistoria e
// seguradoras, e decididas pelo DETRAN.
import { chamarApi } from "./api";
import { contratoEscrita } from "./blockchain";
import { chaveDoChassi } from "./chassi";

// O DETRAN registra em cadeia o evento de correcao, que referencia o evento
// original sem altera-lo. Devolve o hash da transacao e o gas consumido.
export async function assinarCorrecao({ chassi, indice, km, dataEvento, municipio, hashDocumento }, aoMudarPasso = () => {}) {
    aoMudarPasso("assinatura");
    const contrato = await contratoEscrita();
    const tx = await contrato.corrigirLeitura(chaveDoChassi(chassi), indice, BigInt(km), dataEvento, Number(municipio), hashDocumento);
    aoMudarPasso("confirmacao");
    const recibo = await tx.wait();
    return { hash: tx.hash, gas: recibo.gasUsed.toString() };
}

export async function listarSolicitacoes() {
    const { solicitacoes } = await chamarApi("correcoes", { metodo: "GET", padrao: "Não foi possível carregar as solicitações." });
    return solicitacoes;
}

// Solicitacao com o evento questionado e a vistoria indicada como evidencia.
export const detalharSolicitacao = (id) =>
    chamarApi(`correcoes?id=${id}`, { metodo: "GET", padrao: "Não foi possível carregar a solicitação." });

export const solicitarCorrecao = (dados) =>
    chamarApi("correcoes", { corpo: dados, padrao: "Não foi possível enviar a solicitação." });

export const rejeitarSolicitacao = (id, motivo) =>
    chamarApi("correcoes", { metodo: "PATCH", corpo: { id, decisao: "rejeitar", motivo }, padrao: "Não foi possível rejeitar a solicitação." });

// Chamado depois que a correcao foi registrada em cadeia pelo DETRAN.
export const aprovarSolicitacao = (id, motivo, txHash) =>
    chamarApi("correcoes", { metodo: "PATCH", corpo: { id, decisao: "aprovar", motivo, txHash }, padrao: "Não foi possível registrar a aprovação." });

export const SITUACOES_DA_SOLICITACAO = { PENDENTE: "Em análise", APROVADA: "Aprovada", REJEITADA: "Rejeitada" };
