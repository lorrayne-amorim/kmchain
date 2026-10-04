// Identificacao publica do veiculo (marca, modelo, anos, placa e UF
// vigentes) e a transacao de cada evento. Vem do banco do KMChain, nao da
// blockchain; nunca traz o proprietario.
import { chamarApi } from "./api";

// { veiculo, transacoes }: `veiculo` e null se o chassi nao tem cadastro.
export const carregarIdentificacao = (chassi) =>
    chamarApi(`veiculo?chassi=${encodeURIComponent(chassi)}`, {
        metodo: "GET",
        padrao: "Não foi possível carregar a identificação do veículo."
    });
