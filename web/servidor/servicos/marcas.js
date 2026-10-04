// Marcas validas = lista-base (src/dados/marcas.json) + marcas adicionais
// propostas pelo DETRAN (pendentes ou aprovadas pelo administrador do DETRAN). Rejeitadas nao
// entram. Um veiculo pode ser cadastrado com marca pendente: um catalogo
// incompleto nao pode impedir o cadastro de um veiculo legitimo.
import { bd } from "../nucleo/banco.js";
import { ErroHttp } from "../nucleo/http.js";
import { MARCAS_BASE } from "../../src/lib/veiculo.js";

export async function listarMarcas() {
    const r = await bd(
        "SELECT id, nome, situacao FROM marcas_adicionais WHERE situacao <> 'rejeitada' ORDER BY nome"
    );
    return [
        ...MARCAS_BASE.map((m) => ({ ...m, situacao: "lista" })),
        ...r.rows
    ];
}

// { id, nome, situacao } de uma marca aceitavel, ou 400.
export async function resolverMarca(marcaId) {
    const id = String(marcaId ?? "");
    const daBase = MARCAS_BASE.find((m) => m.id === id);
    if (daBase) return { ...daBase, situacao: "lista" };
    const r = await bd("SELECT id, nome, situacao FROM marcas_adicionais WHERE id = $1", [id]);
    const adicional = r.rows[0];
    if (!adicional || adicional.situacao === "rejeitada") {
        throw new ErroHttp(400, "marca_invalida", "Escolha uma marca da lista.");
    }
    return adicional;
}
