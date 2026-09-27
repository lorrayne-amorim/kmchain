import { useEffect, useState } from "react";
import { ouvirAvisos } from "../lib/toast";
import Icone from "./Icone";

export default function Toasts() {
    const [avisos, setAvisos] = useState([]);

    useEffect(() => ouvirAvisos((aviso) => {
        setAvisos((lista) => [...lista.slice(-2), aviso]);
        setTimeout(() => setAvisos((lista) => lista.filter((a) => a.id !== aviso.id)), 3500);
    }), []);

    return (
        <div className="toasts" role="status" aria-live="polite">
            {avisos.map((aviso) => (
                <div key={aviso.id} className={`toast toast-${aviso.tipo}`}>
                    <Icone nome={aviso.tipo === "erro" ? "alerta" : "check"} tamanho={16} />
                    {aviso.texto}
                </div>
            ))}
        </div>
    );
}
