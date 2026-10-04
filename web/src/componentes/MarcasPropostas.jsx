import { useEffect, useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { carregarMarcas, revisarMarca } from "../lib/marcas";
import { avisar } from "../lib/toast";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";

// Exclusivo do administrador do DETRAN: marcas propostas no cadastro que
// ainda nao estao na lista. Aprovar a torna uma marca da lista; recusar impede novas propostas
// com o mesmo nome. Veiculos ja cadastrados mantem o nome da epoca.
export default function MarcasPropostas() {
    const [pendentes, setPendentes] = useState(null);
    const [erro, setErro] = useState("");
    const [revisando, setRevisando] = useState(null);

    async function carregar() {
        setErro("");
        try {
            const todas = await carregarMarcas();
            setPendentes(todas.filter((m) => m.situacao === "pendente"));
        } catch (e) {
            setErro(mensagemDeErro(e, "Não foi possível carregar as marcas propostas."));
        }
    }

    useEffect(() => {
        let ativo = true;
        carregarMarcas()
            .then((todas) => ativo && setPendentes(todas.filter((m) => m.situacao === "pendente")))
            .catch((e) => ativo && setErro(mensagemDeErro(e, "Não foi possível carregar as marcas propostas.")));
        return () => { ativo = false; };
    }, []);

    async function revisar(marca, decisao) {
        setErro("");
        setRevisando(marca.id);
        try {
            await revisarMarca(marca.id, decisao);
            avisar(decisao === "aprovar" ? `${marca.nome} entrou na lista de marcas.` : `${marca.nome} foi recusada.`);
            await carregar();
        } catch (e) {
            setErro(mensagemDeErro(e, "Não foi possível revisar a marca."));
        } finally {
            setRevisando(null);
        }
    }

    return (
        <section className="painel" aria-labelledby="titulo-marcas">
            <h2 id="titulo-marcas" className="painel-titulo">Marcas propostas</h2>
            <p className="painel-texto">Marcas informadas no cadastro que não estavam na lista. Confira o nome no documento do veículo antes de aprovar.</p>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {pendentes?.length === 0 && <p className="painel-texto">Nenhuma marca aguardando aprovação.</p>}
            {pendentes?.length > 0 && (
                <ul className="datado-lista">
                    {pendentes.map((m) => (
                        <li key={m.id}>
                            <span>{m.nome}</span>
                            <span className="acoes">
                                <Botao variante="secundario" tamanho="p" carregando={revisando === m.id} onClick={() => revisar(m, "aprovar")}>Aprovar</Botao>
                                <Botao variante="fantasma" tamanho="p" className="texto-perigo" disabled={revisando === m.id} onClick={() => revisar(m, "rejeitar")}>Recusar</Botao>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
