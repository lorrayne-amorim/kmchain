import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { linkConsulta } from "../lib/chassi";
import Botao from "../ui/Botao";

// O QR leva direto para a consulta publica daquele veiculo.
// Ele fica na etiqueta do vidro, no laudo de vistoria ou no anuncio.
export default function EtiquetaQr({ chassi }) {
    const caixa = useRef(null);
    const url = linkConsulta(window.location.origin, chassi);

    function baixarPng() {
        const canvas = caixa.current.querySelector("canvas");
        const link = document.createElement("a");
        link.download = `kmchain-${chassi}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    return (
        <div className="etiqueta">
            <div ref={caixa} className="etiqueta-qr">
                <QRCodeCanvas value={url} size={160} level="M" includeMargin />
                <div>
                    <p className="etiqueta-texto">Aponte a câmera para ver o histórico de quilometragem.</p>
                    <p className="mono etiqueta-chassi">{chassi}</p>
                </div>
            </div>
            <div className="etiqueta-acoes">
                <Botao variante="secundario" tamanho="p" icone="baixar" onClick={baixarPng}>Baixar imagem</Botao>
                <Botao variante="secundario" tamanho="p" icone="imprimir" onClick={() => window.print()}>Imprimir</Botao>
            </div>
        </div>
    );
}
