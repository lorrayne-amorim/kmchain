// Localizacao no navegador: a posicao do dispositivo (API de geolocalizacao)
// e o apoio de servicos publicos e gratuitos:
//   - ViaCEP: logradouro, bairro e municipio (com o codigo IBGE) pelo CEP;
//   - Nominatim (OpenStreetMap): coordenadas de um endereco e municipio de
//     uma posicao.
// Os servicos sao opcionais: se falharem, o endereco e digitado, a posicao no
// mapa e marcada com um clique e o municipio e escolhido na lista.
import { soDigitos } from "./validar";
import { normalizarNomeMarca as semAcentos } from "./veiculo";

const ESPERA_DA_POSICAO_MS = 15000;
// Codigos de erro da API de geolocalizacao do navegador.
const MOTIVOS = { 1: "negada", 2: "indisponivel", 3: "tempo_esgotado" };

// Pede ao navegador a posicao atual do dispositivo, uma unica vez (nao ha
// acompanhamento continuo). Resolve com { latitude, longitude, precisao,
// capturadaEm } ou, se nao der, com { motivo }. Nunca rejeita: a falta de
// localizacao e tratada pelo fluxo do registro, com justificativa.
export function capturarLocalizacao() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ motivo: "sem_suporte" });
        navigator.geolocation.getCurrentPosition(
            ({ coords, timestamp }) => resolve({
                latitude: coords.latitude,
                longitude: coords.longitude,
                precisao: Math.round(coords.accuracy),
                capturadaEm: new Date(timestamp).toISOString()
            }),
            (erro) => resolve({ motivo: MOTIVOS[erro.code] ?? "erro" }),
            { enableHighAccuracy: true, timeout: ESPERA_DA_POSICAO_MS, maximumAge: 0 }
        );
    });
}

// Municipio em que a posicao cai, pelo Nominatim, ou null se o servico
// falhar ou a cidade nao for reconhecida (nao se inventa municipio). So vai
// ao servico a posicao arredondada (cerca de 1 km), suficiente para a cidade.
// `municipios` e o modulo lib/municipios.js.
export async function municipioDaPosicao({ latitude, longitude }, municipios) {
    const consulta = new URLSearchParams({
        format: "jsonv2", zoom: "10", lat: latitude.toFixed(2), lon: longitude.toFixed(2), "accept-language": "pt-BR"
    });
    const resposta = await fetch(`https://nominatim.openstreetmap.org/reverse?${consulta}`, { headers: { Accept: "application/json" } });
    if (!resposta.ok) return null;
    const { address } = await resposta.json();
    const uf = address?.["ISO3166-2-lvl4"]?.replace("BR-", "");
    const cidade = address?.city ?? address?.town ?? address?.municipality ?? address?.village;
    if (!uf || !cidade) return null;
    return municipios.municipiosDaUf(uf).find((m) => semAcentos(m.nome) === semAcentos(cidade)) ?? null;
}

export async function buscarCep(cep) {
    const digitos = soDigitos(cep);
    if (digitos.length !== 8) return null;
    const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
    if (!resposta.ok) return null;
    const d = await resposta.json();
    if (d.erro) return null;
    return { logradouro: d.logradouro ?? "", bairro: d.bairro ?? "", uf: d.uf, municipio: d.ibge ?? "" };
}

// { latitude, longitude } do endereco, ou null se nao for encontrado.
export async function localizarEndereco({ logradouro, numero, cidade, uf }) {
    const consulta = new URLSearchParams({
        format: "jsonv2", limit: "1", countrycodes: "br",
        street: [numero, logradouro].filter(Boolean).join(" "), city: cidade, state: uf
    });
    const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${consulta}`, { headers: { Accept: "application/json" } });
    if (!resposta.ok) return null;
    const [achado] = await resposta.json();
    return achado ? { latitude: Number(achado.lat), longitude: Number(achado.lon) } : null;
}
