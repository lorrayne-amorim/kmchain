import { cloneElement, useId, useRef, useState } from "react";
import { problemaDoArquivo } from "../lib/documentos";
import Icone from "./Icone";

// Rotulo sempre visivel, controle, ajuda e erro logo abaixo. O controle
// (input/select) chega como filho e recebe id e atributos de acessibilidade.
export default function Campo({ rotulo, ajuda, erro, opcional, sufixo, contador, className = "", children }) {
    const id = useId();
    const idAjuda = `${id}-ajuda`;
    const idErro = `${id}-erro`;
    const descritores = [erro && idErro, ajuda && idAjuda].filter(Boolean).join(" ") || undefined;

    const controle = cloneElement(children, {
        id,
        "aria-invalid": erro ? true : undefined,
        "aria-describedby": descritores
    });

    return (
        <div className={`campo ${erro ? "campo-com-erro" : ""} ${className}`}>
            <div className="campo-topo">
                <label htmlFor={id} className="campo-rotulo">
                    {rotulo}
                    {opcional && <span className="campo-opcional"> (opcional)</span>}
                </label>
                {contador && <span className="campo-contador" aria-hidden="true">{contador}</span>}
            </div>
            {sufixo ? (
                <div className="campo-com-sufixo">
                    {controle}
                    <span className="campo-sufixo" aria-hidden="true">{sufixo}</span>
                </div>
            ) : controle}
            {erro && (
                <p id={idErro} className="campo-erro">
                    <Icone nome="alerta" tamanho={14} />
                    {erro}
                </p>
            )}
            {ajuda && <p id={idAjuda} className="campo-ajuda">{ajuda}</p>}
        </div>
    );
}

// Anexo opcional (laudo, nota de servico, justificativa).
export function CampoArquivo({ rotulo = "Comprovante", ajuda, arquivo, aoEscolher }) {
    const id = useId();
    const entrada = useRef(null);
    const [erro, setErro] = useState("");

    function remover() {
        aoEscolher(null);
        setErro("");
        if (entrada.current) entrada.current.value = "";
    }

    function escolher(novo) {
        const problema = problemaDoArquivo(novo);
        setErro(problema);
        if (problema) {
            if (entrada.current) entrada.current.value = "";
            return;
        }
        aoEscolher(novo ?? null);
    }

    return (
        <div className="campo">
            <span className="campo-rotulo" id={`${id}-rotulo`}>
                {rotulo} <span className="campo-opcional">(opcional)</span>
            </span>
            <div className="arquivo">
                <input
                    ref={entrada}
                    id={id}
                    type="file"
                    className="visualmente-oculto"
                    accept="application/pdf,image/png,image/jpeg"
                    aria-labelledby={`${id}-rotulo`}
                    aria-describedby={ajuda ? `${id}-ajuda` : undefined}
                    aria-invalid={erro ? true : undefined}
                    onChange={(e) => escolher(e.target.files[0])}
                />
                {arquivo ? (
                    <>
                        <Icone nome="arquivo" />
                        <span className="arquivo-nome">{arquivo.name}</span>
                        <label htmlFor={id} className="botao botao-fantasma botao-p">Trocar</label>
                        <button type="button" className="botao botao-fantasma botao-p" onClick={remover}>
                            Remover
                        </button>
                    </>
                ) : (
                    <label htmlFor={id} className="botao botao-secundario botao-p">
                        <Icone nome="clipe" />
                        Escolher arquivo
                    </label>
                )}
            </div>
            {erro && <p className="campo-erro" role="alert"><Icone nome="alerta" tamanho={14} />{erro}</p>}
            {ajuda && <p id={`${id}-ajuda`} className="campo-ajuda">{ajuda}</p>}
        </div>
    );
}
