import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BRASIL = [[-33.8, -73.9], [5.3, -34.8]];
const temPosicao = (p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude);

// Mapa com pontos, sobre os blocos do OpenStreetMap (Leaflet). Carregado sob
// demanda por quem o usa. pontos: [{ id, latitude, longitude, cor, rotulo }].
// `aoClicar` recebe { latitude, longitude } de um clique no mapa.
export default function Mapa({ pontos, selecionado, aoSelecionar, aoClicar, rotulo }) {
    const caixa = useRef(null);
    const mapa = useRef(null);
    const camada = useRef(null);

    useEffect(() => {
        const m = L.map(caixa.current, { scrollWheelZoom: false }).fitBounds(BRASIL);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 18,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(m);
        camada.current = L.layerGroup().addTo(m);
        mapa.current = m;
        return () => m.remove();
    }, []);

    useEffect(() => {
        if (!aoClicar) return;
        const m = mapa.current;
        const clicar = (e) => aoClicar({ latitude: e.latlng.lat, longitude: e.latlng.lng });
        m.on("click", clicar);
        return () => m.off("click", clicar);
    }, [aoClicar]);

    // Enquadra os pontos so quando a lista muda, nao a cada selecao.
    useEffect(() => {
        const posicoes = pontos.filter(temPosicao).map((p) => [p.latitude, p.longitude]);
        if (posicoes.length === 1) mapa.current.setView(posicoes[0], 14);
        else if (posicoes.length > 1) mapa.current.fitBounds(posicoes, { padding: [40, 40], maxZoom: 13 });
        else mapa.current.fitBounds(BRASIL);
    }, [pontos]);

    useEffect(() => {
        camada.current.clearLayers();
        for (const p of pontos.filter(temPosicao)) {
            const marcador = L.circleMarker([p.latitude, p.longitude], {
                radius: p.id === selecionado ? 11 : 8, color: "#ffffff", weight: 2, fillColor: p.cor, fillOpacity: 1
            }).addTo(camada.current);
            if (p.rotulo) marcador.bindTooltip(p.rotulo);
            if (aoSelecionar) marcador.on("click", () => aoSelecionar(p.id));
        }
    }, [pontos, selecionado, aoSelecionar]);

    return <div ref={caixa} className="mapa" role="application" aria-label={rotulo} />;
}
