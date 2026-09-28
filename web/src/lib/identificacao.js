// Identificacao publica do veiculo (marca, modelo, anos, placa e UF
// vigentes). Vem do banco, nao da blockchain; nunca traz o proprietario.
import { chamarApi } from "./api";

export async function carregarIdentificacao(chassi) {
    const { veiculo } = await chamarApi(`veiculo?chassi=${encodeURIComponent(chassi)}`, {
        metodo: "GET",
        padrao: "Não foi possível carregar a identificação do veículo."
    });
    return veiculo;
}
