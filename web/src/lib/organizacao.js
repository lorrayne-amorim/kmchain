// Regras do cadastro de uma organizacao, usadas pela tela (aviso imediato) e
// pelas rotas /api (a regra que vale). A validacao do municipio fica no
// servidor, que tem a lista do IBGE.
import { ORGANIZACOES_CREDENCIAVEIS } from "./eventos.js";
import { cnpjValido, soDigitos } from "./validar.js";
import { limparNome } from "./veiculo.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Limites aproximados do territorio brasileiro.
const LATITUDE = [-34, 6];
const LONGITUDE = [-74, -28];

export function coordenadasValidas(latitude, longitude) {
    const lat = Number(latitude), lon = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= LATITUDE[0] && lat <= LATITUDE[1] && lon >= LONGITUDE[0] && lon <= LONGITUDE[1];
}

const temValor = (v) => v !== undefined && v !== null && String(v).trim() !== "";

// Erros por campo do cadastro (objeto vazio se estiver tudo certo).
export function problemasDaOrganizacao(d) {
    const erros = {};
    if (!ORGANIZACOES_CREDENCIAVEIS.some((o) => o.chave === d.tipo)) erros.tipo = "Escolha o tipo da organização.";
    const razao = limparNome(d.razaoSocial);
    if (razao.length < 2 || razao.length > 120) erros.razaoSocial = "Informe a razão social (até 120 caracteres).";
    const fantasia = limparNome(d.nomeFantasia);
    if (fantasia.length < 2 || fantasia.length > 80) erros.nomeFantasia = "Informe o nome fantasia (até 80 caracteres).";
    if (!cnpjValido(d.cnpj)) erros.cnpj = "Informe um CNPJ válido, com 14 dígitos.";
    if (![10, 11].includes(soDigitos(d.telefone).length)) erros.telefone = "Informe o telefone com DDD.";
    if (!EMAIL.test(String(d.email ?? "").trim())) erros.email = "Informe um e-mail válido.";
    if (soDigitos(d.cep).length !== 8) erros.cep = "Informe o CEP com 8 dígitos.";
    if (limparNome(d.logradouro).length < 2) erros.logradouro = "Informe o logradouro.";
    if (!limparNome(d.numero)) erros.numero = "Informe o número (ou S/N).";
    if (limparNome(d.bairro).length < 2) erros.bairro = "Informe o bairro.";
    if (!/^\d{7}$/.test(String(d.municipio ?? ""))) erros.municipio = "Escolha a UF e a cidade.";
    if ((temValor(d.latitude) || temValor(d.longitude)) && !coordenadasValidas(d.latitude, d.longitude)) {
        erros.latitude = "Coordenadas fora do território brasileiro. Localize o endereço de novo.";
    }
    return erros;
}

export function formatarCnpj(cnpj) {
    const d = soDigitos(cnpj).padStart(14, "0");
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// "Rua X, 100 - Centro" a partir do cadastro (campos do banco).
export function enderecoEmLinha(o) {
    const rua = [o.logradouro, o.numero].filter(Boolean).join(", ");
    return [rua, o.complemento, o.bairro].filter(Boolean).join(" - ");
}

// Cor de cada tipo de organizacao no mapa.
export const COR_DO_TIPO = { OFICINA: "#204e4a", VISTORIA: "#2e933c", SEGURADORA: "#93470a" };

export const SITUACOES = { pendente: "Aguardando credenciamento", ativa: "Credenciada", suspensa: "Suspensa" };
