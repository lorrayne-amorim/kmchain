import { useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { registrarPrivado } from "../lib/privado";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";

// A transacao ja confirmou, mas o registro privado nao foi salvo (rede,
// servidor, transacao ainda nao visivel para o servidor). O servidor aceita o
// mesmo envio de novo sem duplicar, entao da para tentar ate conseguir.
export default function PrivadoPendente({ dados, oQue, falhaInicial }) {
    const [estado, setEstado] = useState("falhou"); // falhou | enviando | salvo
    const [motivo, setMotivo] = useState(falhaInicial);

    async function tentar() {
        setEstado("enviando");
        try {
            await registrarPrivado(dados);
            setEstado("salvo");
        } catch (e) {
            setMotivo(mensagemDeErro(e, "Não foi possível salvar o registro privado."));
            setEstado("falhou");
        }
    }

    if (estado === "salvo") return <Aviso tipo="sucesso">{oQue} salvos nos registros privados.</Aviso>;

    return (
        <Aviso
            tipo="alerta"
            titulo="Registro privado pendente"
            acao={<Botao variante="secundario" tamanho="p" carregando={estado === "enviando"} onClick={tentar}>Tentar de novo</Botao>}
        >
            {oQue} não puderam ser salvos nos registros privados{motivo ? `: ${motivo}` : "."} O histórico
            público do veículo não foi afetado. Não saia desta tela antes de salvar.
        </Aviso>
    );
}
