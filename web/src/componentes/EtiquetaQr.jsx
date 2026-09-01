import { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";

// O QR leva direto para a consulta publica daquele veiculo.
// Ele fica na etiqueta do vidro, no laudo de vistoria ou no anuncio.
export default function EtiquetaQr({ chassi }) {
    const caixa = useRef(null);
    const url = `${window.location.origin}/?chassi=${chassi}`;

    function baixarPng() {
        const canvas = caixa.current.querySelector("canvas");
        const link = document.createElement("a");
        link.download = `kmchain-${chassi}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    }

    return (
        <div ref={caixa} className="etiqueta">
            <QRCodeCanvas value={url} size={180} level="M" includeMargin />
            <p>Aponte a câmera para ver o histórico de quilometragem</p>
            <code>{chassi}</code>
            <button onClick={baixarPng}>Baixar etiqueta</button>
            <button onClick={() => window.print()}>Imprimir</button>
        </div>
    );
}