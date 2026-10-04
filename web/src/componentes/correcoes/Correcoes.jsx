import { useCallback, useEffect, useState } from "react";
import { SITUACOES_DA_SOLICITACAO, listarSolicitacoes } from "../../lib/correcoes";
import { mensagemDeErro } from "../../lib/erros";
import { dataHora, km } from "../../lib/formato";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import { Vazio } from "../../ui/Pagina";
import Tabela from "../../ui/Tabela";
import AnaliseCorrecao from "./AnaliseCorrecao";
import CorrigirLeitura from "./CorrigirLeitura";
import SolicitarCorrecao from "./SolicitarCorrecao";

// Correcoes de quilometragem. Para oficinas, empresas de vistoria e
// seguradoras: solicitar e acompanhar. Para o DETRAN: analisar as
// solicitacoes e, quando for o caso, corrigir de oficio.
export default function Correcoes({ acesso, aoVerHistorico }) {
    const { ehDetran } = acesso;
    const [modo, setModo] = useState("lista"); // lista | nova
    const [aberta, setAberta] = useState(null);
    const [solicitacoes, setSolicitacoes] = useState(null);
    const [erro, setErro] = useState("");

    const carregar = useCallback(async () => {
        setErro("");
        try {
            setSolicitacoes(await listarSolicitacoes());
        } catch (e) {
            setErro(mensagemDeErro(e, "Não foi possível carregar as solicitações."));
        }
    }, []);

    useEffect(() => {
        const espera = setTimeout(carregar);
        return () => clearTimeout(espera);
    }, [carregar]);

    if (aberta !== null) {
        return <AnaliseCorrecao id={aberta} podeDecidir={ehDetran} aoVoltar={() => setAberta(null)} aoDecidir={carregar} />;
    }

    const situacao = (s) => <span className={`etiqueta-status situacao-${s.situacao.toLowerCase()}`}>{SITUACOES_DA_SOLICITACAO[s.situacao]}</span>;
    const pendentes = solicitacoes?.filter((s) => s.situacao === "PENDENTE").length ?? 0;

    return (
        <div className="empilhado">
            <div className="segmentos" role="group" aria-label="Correções">
                <button type="button" aria-pressed={modo === "lista"} onClick={() => setModo("lista")}>
                    {ehDetran ? `Solicitações${pendentes ? ` (${pendentes} em análise)` : ""}` : "Minhas solicitações"}
                </button>
                <button type="button" aria-pressed={modo === "nova"} onClick={() => setModo("nova")}>
                    {ehDetran ? "Correção de ofício" : "Solicitar correção"}
                </button>
            </div>

            {modo === "nova" && (ehDetran
                ? <CorrigirLeitura aoVerHistorico={aoVerHistorico} />
                : <SolicitarCorrecao aoEnviar={() => { setModo("lista"); carregar(); }} />)}

            {modo === "lista" && (
                <div className="painel painel-tabela">
                    {erro && <Aviso tipo="erro">{erro}</Aviso>}
                    {solicitacoes?.length === 0 && (
                        <Vazio titulo="Nenhuma solicitação">
                            {ehDetran
                                ? "As solicitações de correção das organizações credenciadas aparecem aqui."
                                : "Quando identificar um registro com quilometragem errada, solicite a correção ao DETRAN."}
                        </Vazio>
                    )}
                    {solicitacoes?.length > 0 && (
                        <Tabela
                            rotulo="Solicitações de correção"
                            linhas={solicitacoes}
                            chave={(s) => s.id}
                            colunas={[
                                { titulo: "Solicitada em", render: (s) => <span className="numero">{dataHora(new Date(s.solicitada_em))}</span> },
                                { titulo: "Veículo", render: (s) => <span className="mono">{s.chassi}</span> },
                                { titulo: "Registrada → solicitada", render: (s) => <span className="numero">{km(s.km_original)} → {km(s.km_solicitada)}</span> },
                                { titulo: "Solicitante", render: (s) => <>{s.organizacao_nome}<span className="celula-secundaria">{s.solicitante_nome}</span></> },
                                { titulo: "Situação", render: situacao },
                                {
                                    titulo: "Ações", classe: "celula-acoes",
                                    render: (s) => (
                                        <Botao variante="fantasma" tamanho="p" onClick={() => setAberta(s.id)}>
                                            {ehDetran && s.situacao === "PENDENTE" ? "Analisar" : "Ver"}
                                        </Botao>
                                    )
                                }
                            ]}
                            itemMovel={(s) => (
                                <div className="item-movel">
                                    <div className="item-movel-topo">
                                        <span>
                                            <strong className="numero">{km(s.km_original)} → {km(s.km_solicitada)}</strong>
                                            <span className="celula-secundaria mono">{s.chassi}</span>
                                        </span>
                                        <Botao variante="secundario" tamanho="p" onClick={() => setAberta(s.id)}>
                                            {ehDetran && s.situacao === "PENDENTE" ? "Analisar" : "Ver"}
                                        </Botao>
                                    </div>
                                    <p className="item-movel-linha">{situacao(s)} {s.organizacao_nome} · {dataHora(new Date(s.solicitada_em))}</p>
                                </div>
                            )}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
