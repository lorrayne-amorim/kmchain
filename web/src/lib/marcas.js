// Marcas: lista-base padronizada (dados/marcas.json) + marcas propostas no
// servidor. A tela usa a lista-base enquanto a do servidor carrega.
import { chamarApi } from "./api";
import { MARCAS_BASE } from "./veiculo";

export const LISTA_INICIAL = MARCAS_BASE.map((m) => ({ ...m, situacao: "lista" }));

export async function carregarMarcas() {
    const { marcas } = await chamarApi("marcas", { metodo: "GET", padrao: "Não foi possível carregar as marcas." });
    return marcas;
}

// Propoe uma marca ausente. Recusa com codigo "marca_existente" (e a marca)
// ou "marca_parecida" (e as sugestoes) em `erro.dados`.
export async function proporMarca(nome, confirmarDiferente = false) {
    const { marca } = await chamarApi("marcas", {
        corpo: { nome, confirmarDiferente },
        padrao: "Não foi possível propor a marca."
    });
    return marca;
}

export const revisarMarca = (id, decisao) =>
    chamarApi("marcas", { metodo: "PATCH", corpo: { id, decisao }, padrao: "Não foi possível revisar a marca." });
