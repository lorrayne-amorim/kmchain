// Navegacao minima por hash: a consulta publica vive em "/" (com ?chassi=
// para o QR Code), o mapa publico das organizacoes em "#/organizacoes" e a
// area institucional em "#/institucional/<secao>".
// Assim o botao voltar do celular funciona sem precisar de um roteador.
import { useEffect, useState } from "react";

function ler() {
    const partes = window.location.hash.replace(/^#\/?/, "").split("/");
    if (partes[0] === "institucional") return { area: "institucional", secao: partes[1] || "inicio" };
    if (partes[0] === "organizacoes") return { area: "organizacoes", secao: null };
    return { area: "publico", secao: null };
}

export const linkPara = (secao) => (secao ? `#/institucional/${secao}` : "#/");

export function irPara(secao, { substituir = false } = {}) {
    if (substituir) window.location.replace(linkPara(secao));
    else window.location.hash = linkPara(secao);
}

export function useRota() {
    const [rota, setRota] = useState(ler);
    useEffect(() => {
        const aoMudar = () => {
            setRota(ler());
            window.scrollTo(0, 0);
        };
        window.addEventListener("hashchange", aoMudar);
        return () => window.removeEventListener("hashchange", aoMudar);
    }, []);
    return rota;
}
