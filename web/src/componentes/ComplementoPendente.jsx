import { useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";

// A transacao ja confirmou na blockchain, mas a parte que fica no banco do
// KMChain nao foi salva (rede, servidor, transacao ainda nao visivel para o
// servidor). O servidor aceita o mesmo envio de novo sem duplicar, entao da
// para tentar ate conseguir. `enviar` repete a chamada que falhou.
export default function ComplementoPendente({ enviar, oQue, falhaInicial, aoSalvar }) {
    const [estado, setEstado] = useState("falhou"); // falhou | enviando | salvo
    const [motivo, setMotivo] = useState(falhaInicial);

    async function tentar() {
        setEstado("enviando");
        try {
            await enviar();
            setEstado("salvo");
            aoSalvar?.();
        } catch (e) {
            setMotivo(mensagemDeErro(e, "Não foi possível salvar os dados complementares."));
            setEstado("falhou");
        }
    }

    if (estado === "salvo") return <Aviso tipo="sucesso">{oQue} salvos no cadastro do KMChain.</Aviso>;

    return (
        <Aviso
            tipo="alerta"
            titulo="Dados complementares pendentes"
            acao={<Botao variante="secundario" tamanho="p" carregando={estado === "enviando"} onClick={tentar}>Tentar de novo</Botao>}
        >
            {oQue} não puderam ser salvos no cadastro do KMChain{motivo ? `: ${motivo}` : "."} O registro na
            blockchain não foi afetado. Não saia desta tela antes de salvar.
        </Aviso>
    );
}
