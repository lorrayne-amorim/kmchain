// Verificacao da localizacao do dispositivo no momento do registro de um
// evento. Compara a posicao informada pelo navegador com o endereco
// cadastrado da organizacao. E uma camada adicional de rastreabilidade, nao
// uma prova de presenca fisica: a posicao pode ser imprecisa ou manipulada.
// Tudo aqui fica fora da blockchain; em cadeia segue so o municipio do evento.
//
// Regras usadas pela tela (para explicar) e pelo servidor (que decide).

// Distancia maxima, em metros, entre o dispositivo e o endereco cadastrado
// para o registro ser considerado feito na organizacao. Cobre o porte de um
// estabelecimento (patio, galpao) e o erro do geocodificador do endereco.
export const TOLERANCIA_DA_ORGANIZACAO_METROS = 300;

// Precisao (raio de incerteza informado pelo dispositivo) acima da qual a
// posicao nao permite concluir nada. Redes sem GPS costumam passar disso.
export const PRECISAO_MAXIMA_METROS = 500;

// Idade maxima da captura em relacao ao registro.
export const VALIDADE_DA_CAPTURA_MS = 30 * 60 * 1000;

// A tela pede nova revisao antes disso, para a captura nao vencer entre a
// assinatura e a gravacao pelo servidor.
export const CAPTURA_RECENTE_MS = 20 * 60 * 1000;

export const JUSTIFICATIVA_MINIMA = 10;
export const JUSTIFICATIVA_MAXIMA = 500;

export const SITUACAO_DA_LOCALIZACAO = {
    VERIFICADA: "VERIFICADA",             // dentro da tolerancia
    FORA_DA_AREA: "FORA_DA_AREA",         // distante do endereco cadastrado
    BAIXA_PRECISAO: "BAIXA_PRECISAO",     // posicao obtida, mas imprecisa demais
    INDISPONIVEL: "INDISPONIVEL",         // posicao nao obtida
    SEM_REFERENCIA: "SEM_REFERENCIA"      // organizacao sem coordenadas cadastradas
};

export const ROTULOS_DA_LOCALIZACAO = {
    VERIFICADA: "Localização compatível com a organização",
    FORA_DA_AREA: "Fora do local cadastrado da organização",
    BAIXA_PRECISAO: "Localização com precisão insuficiente",
    INDISPONIVEL: "Localização não verificada",
    SEM_REFERENCIA: "Organização sem posição cadastrada"
};

// Por que a posicao nao foi obtida (informado pelo navegador).
export const MOTIVOS_DE_INDISPONIBILIDADE = {
    negada: "permissão negada",
    sem_suporte: "navegador sem suporte a geolocalização",
    tempo_esgotado: "tempo esgotado",
    indisponivel: "posição indisponível no dispositivo",
    erro: "erro ao obter a posição"
};

const RAIO_DA_TERRA_METROS = 6371000;
const emRadianos = (graus) => (graus * Math.PI) / 180;

// Distancia em metros entre dois pontos, pela formula de Haversine.
export function distanciaEmMetros(a, b) {
    const dLat = emRadianos(b.latitude - a.latitude);
    const dLon = emRadianos(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(emRadianos(a.latitude)) * Math.cos(emRadianos(b.latitude)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * RAIO_DA_TERRA_METROS * Math.asin(Math.sqrt(h)));
}

const temCoordenadas = (p) => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

// Situacao da verificacao e distancia ate a organizacao. `posicao` e
// { latitude, longitude, precisao } ou null; `organizacao`, o cadastro.
export function classificarLocalizacao(posicao, organizacao) {
    if (!temCoordenadas(posicao)) return { situacao: SITUACAO_DA_LOCALIZACAO.INDISPONIVEL, distancia: null };
    if (!temCoordenadas(organizacao)) return { situacao: SITUACAO_DA_LOCALIZACAO.SEM_REFERENCIA, distancia: null };

    const distancia = distanciaEmMetros(posicao, organizacao);
    // Sem precisao suficiente nao se afirma nem que esta perto nem que esta longe.
    if (posicao.precisao > PRECISAO_MAXIMA_METROS) return { situacao: SITUACAO_DA_LOCALIZACAO.BAIXA_PRECISAO, distancia };
    // A precisao entra como margem: o ponto real pode estar ate `precisao`
    // metros mais perto do que o informado.
    const dentro = distancia <= TOLERANCIA_DA_ORGANIZACAO_METROS + posicao.precisao;
    return { situacao: dentro ? SITUACAO_DA_LOCALIZACAO.VERIFICADA : SITUACAO_DA_LOCALIZACAO.FORA_DA_AREA, distancia };
}

// Situacoes em que o registro so segue com justificativa. Sem posicao
// cadastrada da organizacao nao ha o que justificar: a falta e do cadastro.
export const exigeJustificativa = (situacao) => [
    SITUACAO_DA_LOCALIZACAO.FORA_DA_AREA,
    SITUACAO_DA_LOCALIZACAO.BAIXA_PRECISAO,
    SITUACAO_DA_LOCALIZACAO.INDISPONIVEL
].includes(situacao);

// "350 m" ou "12,4 km".
export function formatarDistancia(metros) {
    if (metros === null || metros === undefined) return "—";
    return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`;
}
