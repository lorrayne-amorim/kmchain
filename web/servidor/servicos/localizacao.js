// Verificacao da localizacao do dispositivo no registro de um evento.
//
// O navegador envia a posicao que obteve (ou o motivo de nao ter obtido). O
// servidor valida o formato e decide a situacao por conta propria, com as
// coordenadas cadastradas da organizacao: situacao e distancia enviadas pelo
// navegador sao ignoradas. Nada disso vai para a blockchain.
import { ErroHttp } from "../nucleo/http.js";
import {
    JUSTIFICATIVA_MAXIMA, JUSTIFICATIVA_MINIMA, MOTIVOS_DE_INDISPONIBILIDADE, VALIDADE_DA_CAPTURA_MS,
    classificarLocalizacao, exigeJustificativa
} from "../../src/lib/localizacao.js";
import { limparNome } from "../../src/lib/veiculo.js";

const FOLGA_RELOGIO_MS = 5 * 60 * 1000;
const PRECISAO_ACEITAVEL_METROS = 10_000_000;

const invalida = (mensagem) =>
    new ErroHttp(400, "localizacao_invalida", mensagem, { campos: { localizacao: mensagem } });

// Posicao enviada pelo navegador, validada, ou null se ele nao a obteve.
// `referencia` e o instante do registro (agora, ou a data do bloco).
function posicaoCapturada(localizacao, referencia) {
    if (localizacao?.latitude === undefined || localizacao?.latitude === null) return null;
    const latitude = Number(localizacao.latitude);
    const longitude = Number(localizacao.longitude);
    const precisao = Number(localizacao.precisao);
    const capturadaEm = new Date(localizacao.capturadaEm);
    if (
        !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        !Number.isFinite(precisao) || precisao < 0 || precisao > PRECISAO_ACEITAVEL_METROS ||
        Number.isNaN(capturadaEm.getTime())
    ) throw invalida("A localização enviada é inválida. Capture a localização de novo.");
    if (capturadaEm.getTime() > referencia + FOLGA_RELOGIO_MS || capturadaEm.getTime() < referencia - VALIDADE_DA_CAPTURA_MS) {
        throw invalida("A localização foi capturada há muito tempo. Capture de novo antes de registrar.");
    }
    return { latitude, longitude, precisao: Math.round(precisao), capturadaEm };
}

// Verifica a localizacao do registro contra o cadastro da organizacao e
// exige a justificativa quando a situacao pede. Devolve o que sera gravado
// junto do evento.
export function verificarLocalizacaoDoRegistro(corpo, organizacao, referencia = Date.now()) {
    const posicao = posicaoCapturada(corpo?.localizacao, referencia);
    const { situacao, distancia } = classificarLocalizacao(posicao, organizacao);

    let justificativa = null;
    if (exigeJustificativa(situacao)) {
        justificativa = limparNome(corpo?.justificativaLocalizacao);
        if (justificativa.length < JUSTIFICATIVA_MINIMA || justificativa.length > JUSTIFICATIVA_MAXIMA) {
            throw new ErroHttp(400, "justificativa_localizacao_obrigatoria", "Informe por que o registro está sendo feito sem a localização verificada.", {
                campos: { justificativaLocalizacao: `Descreva o motivo (de ${JUSTIFICATIVA_MINIMA} a ${JUSTIFICATIVA_MAXIMA} caracteres).` },
                localizacao: { situacao, distancia }
            });
        }
    }

    const motivo = posicao ? null : String(corpo?.localizacao?.motivo ?? "");
    return {
        situacao,
        distancia,
        latitude: posicao?.latitude ?? null,
        longitude: posicao?.longitude ?? null,
        precisao: posicao?.precisao ?? null,
        capturadaEm: posicao?.capturadaEm ?? null,
        motivo: posicao ? null : (MOTIVOS_DE_INDISPONIBILIDADE[motivo] ? motivo : "erro"),
        justificativa
    };
}
