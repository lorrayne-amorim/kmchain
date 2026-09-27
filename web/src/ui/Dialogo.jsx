import { useId, useLayoutEffect, useRef } from "react";
import Icone from "./Icone";

// <dialog> nativo: foco preso no modal, Esc fecha e o fundo fica inerte sem
// codigo extra. `bloqueado` impede fechar durante uma operacao em andamento.
// useLayoutEffect abre o modal antes dos efeitos dos filhos (o leitor de QR
// precisa do elemento visivel para medir a camera).
export default function Dialogo({ aberto, aoFechar, titulo, children, acoes, variante, bloqueado = false }) {
    const ref = useRef(null);
    const idTitulo = useId();

    useLayoutEffect(() => {
        const dialogo = ref.current;
        if (aberto && !dialogo.open) dialogo.showModal();
        if (!aberto && dialogo.open) dialogo.close();
    }, [aberto]);

    return (
        <dialog
            ref={ref}
            className={`dialogo ${variante ? `dialogo-${variante}` : ""}`}
            aria-labelledby={idTitulo}
            onCancel={(e) => {
                e.preventDefault();
                if (!bloqueado) aoFechar();
            }}
            onClick={(e) => {
                if (e.target === ref.current && !bloqueado) aoFechar();
            }}
        >
            {aberto && (
                <div className="dialogo-caixa">
                    <div className="dialogo-topo">
                        <h2 id={idTitulo}>{titulo}</h2>
                        {!bloqueado && (
                            <button type="button" className="botao botao-fantasma botao-icone" aria-label="Fechar" onClick={aoFechar}>
                                <Icone nome="fechar" />
                            </button>
                        )}
                    </div>
                    <div className="dialogo-corpo">{children}</div>
                    {acoes && <div className="dialogo-acoes">{acoes}</div>}
                </div>
            )}
        </dialog>
    );
}
