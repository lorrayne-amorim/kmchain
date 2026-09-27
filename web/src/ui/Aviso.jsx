import Icone from "./Icone";

const ICONES = { info: "info", sucesso: "check", alerta: "alerta", erro: "alerta" };

// Mensagem em linha. tipo: info | sucesso | alerta | erro
export default function Aviso({ tipo = "info", titulo, children, acao, className = "" }) {
    return (
        <div className={`aviso aviso-${tipo} ${className}`} role={tipo === "erro" ? "alert" : "status"}>
            <Icone nome={ICONES[tipo]} className="aviso-icone" />
            <div className="aviso-conteudo">
                {titulo && <p className="aviso-titulo">{titulo}</p>}
                {children && <div className="aviso-texto">{children}</div>}
                {acao && <div className="aviso-acao">{acao}</div>}
            </div>
        </div>
    );
}
