import { avisar } from "../lib/toast";
import Icone from "./Icone";

export default function Copiar({ texto, rotulo = "Copiar" }) {
    async function copiar() {
        try {
            await navigator.clipboard.writeText(texto);
            avisar("Copiado para a área de transferência.");
        } catch {
            avisar("Não foi possível copiar.", "erro");
        }
    }

    return (
        <button type="button" className="botao-copiar" onClick={copiar} aria-label={rotulo} title={rotulo}>
            <Icone nome="copiar" tamanho={14} />
        </button>
    );
}
