// Regras da identificacao do veiculo, usadas pela tela (aviso imediato) e
// pelas rotas /api (a regra que vale). Nada aqui e deduzido do chassi:
// marca, modelo e anos vem do documento do veiculo, informados por quem
// cadastra.
import base from "../dados/marcas.json" with { type: "json" };
import { chassiValido, normalizarChassi } from "./chassi.js";
import { cpfValido, placaValida } from "./validar.js";

export const MARCAS_BASE = base.marcas;

// Comparacao de nomes de marca: sem acento, caixa, espacos e pontuacao.
export const normalizarNomeMarca = (nome) =>
    String(nome ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const limparNome = (nome) => String(nome ?? "").trim().replace(/\s+/g, " ");

function distancia(a, b) {
    const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let anterior = linha[0];
        linha[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const guardado = linha[j];
            linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
            anterior = guardado;
        }
    }
    return linha[b.length];
}

// Busca para o seletor: prefixo primeiro, depois "contem".
export function buscarMarcas(termo, lista) {
    const t = normalizarNomeMarca(termo);
    if (!t) return lista;
    const comeca = [], contem = [];
    for (const m of lista) {
        const n = normalizarNomeMarca(m.nome);
        if (n.startsWith(t)) comeca.push(m);
        else if (n.includes(t)) contem.push(m);
    }
    return [...comeca, ...contem];
}

// Marcas iguais ou muito parecidas com `nome` (erro de digitacao provavel).
// Impede que "Volksvagen" vire uma marca nova.
export function marcasParecidas(nome, lista) {
    const alvo = normalizarNomeMarca(nome);
    if (!alvo) return [];
    return lista.filter((m) => {
        const n = normalizarNomeMarca(m.nome);
        const tolerancia = Math.min(2, Math.floor(Math.min(n.length, alvo.length) / 4));
        return n === alvo || distancia(n, alvo) <= tolerancia;
    });
}

export const UFS = [
    ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"], ["BA", "Bahia"],
    ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"], ["GO", "Goiás"],
    ["MA", "Maranhão"], ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"],
    ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"], ["PE", "Pernambuco"], ["PI", "Piauí"],
    ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"], ["RS", "Rio Grande do Sul"],
    ["RO", "Rondônia"], ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
    ["SE", "Sergipe"], ["TO", "Tocantins"]
];
export const ufValida = (uf) => UFS.some(([sigla]) => sigla === uf);

const MODELO = /^[\p{L}\p{N}][\p{L}\p{N} .\-/+&']*$/u;
export function problemaDoModelo(modelo) {
    const m = limparNome(modelo);
    if (!m) return "Informe o modelo, como consta no documento do veículo.";
    if (m.length > 60) return "O modelo tem no máximo 60 caracteres.";
    if (!MODELO.test(m)) return "Use letras, números, espaço e . - / + & '";
    return "";
}

// Ano de fabricacao e ano-modelo: o ano-modelo e o proprio ano de
// fabricacao ou o seguinte.
export function problemasDosAnos(anoFabricacao, anoModelo, agora = new Date()) {
    const erros = {};
    const limite = agora.getFullYear() + 1;
    const fab = Number(anoFabricacao);
    const mod = Number(anoModelo);
    if (!/^\d{4}$/.test(String(anoFabricacao ?? "")) || fab < 1900 || fab > limite) {
        erros.anoFabricacao = `Informe o ano de fabricação, entre 1900 e ${limite}.`;
    }
    if (!/^\d{4}$/.test(String(anoModelo ?? "")) || mod < 1900 || mod > limite + 1) {
        erros.anoModelo = "Informe o ano-modelo com 4 dígitos.";
    } else if (!erros.anoFabricacao && (mod < fab || mod > fab + 1)) {
        erros.anoModelo = "O ano-modelo é o ano de fabricação ou o seguinte.";
    }
    return erros;
}

// Data e hora em que o hodometro foi observado: nao pode estar no futuro e
// nao pode ter mais de 30 dias (mesma janela proposta para o contrato v2).
export const ATRASO_MAXIMO_MS = 30 * 24 * 60 * 60 * 1000;
const FOLGA_RELOGIO_MS = 5 * 60 * 1000;
export function problemaDaObservacao(valor, referencia = Date.now()) {
    const instante = new Date(valor).getTime();
    if (!valor || Number.isNaN(instante)) return "Informe a data e a hora em que o hodômetro foi observado.";
    if (instante > referencia + FOLGA_RELOGIO_MS) return "A observação não pode estar no futuro.";
    if (instante < referencia - ATRASO_MAXIMO_MS) return "A observação precisa ter no máximo 30 dias.";
    return "";
}

// O contrato em uso (v1) guarda um unico texto de modelo; a marca vai junto.
export const modeloEmCadeia = (marcaNome, modelo) => `${limparNome(marcaNome)} ${limparNome(modelo)}`;

export function problemasDoProprietario(nome, cpf) {
    const erros = {};
    if (limparNome(nome).length < 2) erros.nomeProprietario = "Informe o nome do proprietário.";
    if (!cpfValido(cpf)) erros.cpfProprietario = "Informe um CPF válido, com 11 dígitos.";
    return erros;
}

// Todas as regras do cadastro. `marca` e { id, nome } ja resolvida pela
// lista (base + adicionais) ou { proposta: "Nome" } para marca nova.
export function problemasDoCadastro(d, agora = new Date()) {
    const erros = {};
    if (!chassiValido(d.chassi)) erros.chassi = "Chassi inválido.";
    if (!placaValida(d.placa)) erros.placa = "Informe a placa no formato ABC1234 ou ABC1D23.";
    if (!d.marca) erros.marca = "Escolha a marca na lista.";
    const modelo = problemaDoModelo(d.modelo);
    if (modelo) erros.modelo = modelo;
    Object.assign(erros, problemasDosAnos(d.anoFabricacao, d.anoModelo, agora));
    if (!ufValida(d.uf)) erros.uf = "Escolha a UF de registro na data do cadastro.";
    if (!/^\d+$/.test(String(d.kmInicial ?? ""))) erros.kmInicial = "Informe a quilometragem observada.";
    const obs = problemaDaObservacao(d.observadaEm, agora.getTime());
    if (obs) erros.observadaEm = obs;
    Object.assign(erros, problemasDoProprietario(d.nomeProprietario, d.cpfProprietario));
    return erros;
}

export { normalizarChassi };
