// Leitura do historico de um veiculo direto da blockchain, num formato
// pronto para a tela.
import { contratoLeitura } from "./blockchain";
import { chaveDoChassi } from "./chassi";
import { SEM_REFERENCIA, TIPO_EVENTO, rotuloDoEvento } from "./eventos";
import { dataDe } from "./formato";

function eventosDoContrato(historico) {
    // O evento original nao guarda que foi corrigido: quem aponta e a correcao.
    const corrigidoPor = new Map();
    historico.forEach((e, indice) => {
        if (Number(e.tipo) === TIPO_EVENTO.CORRECAO) corrigidoPor.set(Number(e.referencia), indice);
    });
    return historico.map((e, indice) => {
        const tipo = Number(e.tipo);
        const referencia = Number(e.referencia);
        return {
            indice,
            km: Number(e.km),
            tipo,
            rotulo: rotuloDoEvento(tipo),
            correcao: tipo === TIPO_EVENTO.CORRECAO,
            dataEvento: dataDe(e.dataEvento),
            dataRegistro: dataDe(e.dataBloco),
            municipio: Number(e.municipio),
            organizacao: Number(e.organizacao),
            responsavel: e.responsavel,
            referencia: referencia === SEM_REFERENCIA ? null : referencia,
            corrigidoPor: corrigidoPor.get(indice) ?? null,
            atipica: e.atipica,
            hashDocumento: e.hashDocumento
        };
    });
}

export const foiCorrigido = (e) => e.corrigidoPor !== null;

// Historico completo do veiculo, em ordem de registro, ou null se o chassi
// nao esta cadastrado no contrato.
export async function carregarHistorico(chassi) {
    const contrato = contratoLeitura();
    const chave = chaveDoChassi(chassi);
    const veiculo = await contrato.getVeiculo(chave);
    if (!veiculo.cadastrado) return null;

    const eventos = eventosDoContrato(await contrato.getHistorico(chave));
    return {
        chassi,
        ultimaKm: Number(veiculo.ultimaKm),
        ultimaData: eventos.at(-1).dataEvento,
        eventos,
        correcoes: Number(veiculo.totalCorrecoes),
        possuiAtipicas: eventos.some((e) => e.atipica),
        semComprovante: eventos.some((e, i) => i > 0 && !foiCorrigido(e) && /^0x0+$/.test(e.hashDocumento))
    };
}
