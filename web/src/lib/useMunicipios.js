// A lista de municipios do IBGE (dados/municipios.json) e grande; a tela so
// a baixa quando precisa mostrar ou escolher um local.
import { useEffect, useState } from "react";

let carregando;
const carregarMunicipios = () => (carregando ??= import("./municipios"));

// Modulo lib/municipios.js, ou null enquanto carrega.
export function useMunicipios() {
    const [modulo, setModulo] = useState(null);
    useEffect(() => {
        let ativo = true;
        carregarMunicipios().then((m) => ativo && setModulo(m)).catch(() => { });
        return () => { ativo = false; };
    }, []);
    return modulo;
}
