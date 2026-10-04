// Municipios brasileiros pelo codigo IBGE (7 digitos), o valor gravado em
// cadeia como local do evento. A lista vem da API de localidades do IBGE e
// fica em dados/municipios.json, agrupada por UF: { "ES": [[codigo, nome]] }.
// A tela carrega este modulo sob demanda; as rotas /api o usam para validar.
import porUf from "../dados/municipios.json" with { type: "json" };

const porCodigo = new Map();
for (const [uf, lista] of Object.entries(porUf)) {
    for (const [codigo, nome] of lista) porCodigo.set(codigo, { codigo, nome, uf });
}

// { codigo, nome, uf } ou null.
export const municipioPorCodigo = (codigo) => porCodigo.get(Number(codigo)) ?? null;

export const municipioValido = (codigo) => porCodigo.has(Number(codigo));

// [{ codigo, nome, uf }] em ordem alfabetica.
export const municipiosDaUf = (uf) => (porUf[uf] ?? []).map(([codigo, nome]) => ({ codigo, nome, uf }));

// "Vitória - ES", como aparece no historico.
export function rotuloDoMunicipio(codigo) {
    const m = municipioPorCodigo(codigo);
    return m ? `${m.nome} - ${m.uf}` : "Local não identificado";
}
