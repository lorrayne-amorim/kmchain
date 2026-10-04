import { useEffect, useState } from "react";
import { linkTransacao } from "../lib/blockchain";
import { mensagemDeErro } from "../lib/erros";
import { dataHora, km } from "../lib/formato";
import { MOTIVOS_DE_INDISPONIBILIDADE, ROTULOS_DA_LOCALIZACAO, formatarDistancia } from "../lib/localizacao";
import { listarEventosDaOrganizacao } from "../lib/registros";
import { useMunicipios } from "../lib/useMunicipios";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import Dialogo from "../ui/Dialogo";
import Icone from "../ui/Icone";
import { Vazio } from "../ui/Pagina";
import Tabela from "../ui/Tabela";

const quando = (valor) => (valor ? dataHora(new Date(valor)) : "—");
const CLASSE_DA_LOCALIZACAO = { VERIFICADA: "situacao-ativa", FORA_DA_AREA: "situacao-suspensa", BAIXA_PRECISAO: "situacao-pendente", INDISPONIVEL: "situacao-pendente" };

// Eventos registrados pela organizacao de quem esta logado, com quem
// registrou cada um e a situacao da verificacao de localizacao. O DETRAN ve
// os de todas as organizacoes, filtra os de localizacao divergente ou nao
// verificada e abre os detalhes (coordenadas, distancia e justificativa).
export default function RegistrosDaOrganizacao({ acesso, aoVerHistorico }) {
    const { ehDetran } = acesso;
    const [eventos, setEventos] = useState(null);
    const [filtro, setFiltro] = useState("");
    const [detalhe, setDetalhe] = useState(null);
    const [erro, setErro] = useState("");
    const municipios = useMunicipios();

    useEffect(() => {
        let ativo = true;
        listarEventosDaOrganizacao(filtro)
            .then((lista) => ativo && setEventos(lista))
            .catch((e) => ativo && setErro(mensagemDeErro(e, "Não foi possível carregar os registros.")));
        return () => { ativo = false; };
    }, [filtro]);

    const cidade = (codigo) => (municipios && codigo ? municipios.rotuloDoMunicipio(codigo) : "");
    const local = (e) => cidade(e.municipio_ibge);
    const transacao = (e) => (
        <a href={linkTransacao(e.tx_hash)} target="_blank" rel="noreferrer" className="link-externo">
            Transação <Icone nome="externo" tamanho={13} />
        </a>
    );
    const localizacao = (e) => {
        if (!e.localizacao_situacao) return <span className="texto-3">—</span>;
        const etiqueta = <span className={`etiqueta-status ${CLASSE_DA_LOCALIZACAO[e.localizacao_situacao] ?? ""}`}>{ROTULOS_DA_LOCALIZACAO[e.localizacao_situacao]}</span>;
        if (!ehDetran) return etiqueta;
        return <>{etiqueta}<Botao variante="fantasma" tamanho="p" onClick={() => setDetalhe(e)}>Detalhes</Botao></>;
    };

    return (
        <div className="empilhado">
            {ehDetran && (
                <div className="painel">
                    <Campo rotulo="Verificação de localização" className="campo-curto">
                        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                            <option value="">Todos os registros</option>
                            <option value="divergente">Localização divergente</option>
                            <option value="nao_verificada">Localização não verificada</option>
                        </select>
                    </Campo>
                </div>
            )}

            <div className="painel painel-tabela">
                {erro && <Aviso tipo="erro">{erro}</Aviso>}
                {eventos?.length === 0 && <Vazio titulo="Nenhum registro">{filtro ? "Nenhum registro nesta situação." : "Os eventos registrados pela organização aparecem aqui."}</Vazio>}
                {eventos?.length > 0 && (
                    <Tabela
                        rotulo="Registros da organização"
                        linhas={eventos}
                        chave={(e) => e.tx_hash}
                        colunas={[
                            { titulo: "Data do evento", render: (e) => <span className="numero">{quando(e.observada_em)}</span> },
                            { titulo: "Evento", render: (e) => <>{e.tipo_evento}<span className="celula-secundaria">{local(e)}</span></> },
                            { titulo: "Quilometragem", render: (e) => <span className="numero">{km(e.quilometragem)}</span> },
                            { titulo: "Veículo", render: (e) => <Botao variante="fantasma" tamanho="p" className="mono" onClick={() => aoVerHistorico(e.chassi)}>{e.chassi}</Botao> },
                            {
                                titulo: ehDetran ? "Organização" : "Registrado por",
                                render: (e) => (ehDetran ? <>{e.organizacao_nome}<span className="celula-secundaria">{e.usuario_nome}</span></> : e.usuario_nome)
                            },
                            { titulo: "Localização do dispositivo", render: localizacao },
                            { titulo: "Blockchain", classe: "celula-acoes", render: transacao }
                        ]}
                        itemMovel={(e) => (
                            <div className="item-movel">
                                <div className="item-movel-topo">
                                    <strong>{e.tipo_evento} · {km(e.quilometragem)}</strong>
                                    {transacao(e)}
                                </div>
                                <dl className="lista-dados lista-dados-compacta">
                                    <div><dt>Data do evento</dt><dd>{quando(e.observada_em)}</dd></div>
                                    <div><dt>Local</dt><dd>{local(e)}</dd></div>
                                    <div><dt>Veículo</dt><dd className="mono">{e.chassi}</dd></div>
                                    <div><dt>Registrado por</dt><dd>{ehDetran && `${e.organizacao_nome} · `}{e.usuario_nome}</dd></div>
                                    <div><dt>Localização do dispositivo</dt><dd>{localizacao(e)}</dd></div>
                                </dl>
                            </div>
                        )}
                    />
                )}
            </div>

            <Dialogo aberto={Boolean(detalhe)} aoFechar={() => setDetalhe(null)} titulo="Verificação de localização">
                {detalhe && (
                    <>
                        <dl className="lista-dados lista-dados-compacta">
                            <div><dt>Situação</dt><dd>{ROTULOS_DA_LOCALIZACAO[detalhe.localizacao_situacao]}</dd></div>
                            <div><dt>Organização responsável</dt><dd>{detalhe.organizacao_nome}<span className="celula-secundaria">{detalhe.usuario_nome}</span></dd></div>
                            <div>
                                <dt>Endereço cadastrado</dt>
                                <dd>
                                    {detalhe.organizacao_logradouro
                                        ? <>{detalhe.organizacao_logradouro}, {detalhe.organizacao_numero} - {detalhe.organizacao_bairro}<span className="celula-secundaria">{cidade(detalhe.organizacao_municipio)}</span></>
                                        : "Sem endereço cadastrado"}
                                    {detalhe.organizacao_latitude !== null && (
                                        <span className="celula-secundaria numero">{detalhe.organizacao_latitude.toFixed(5)}, {detalhe.organizacao_longitude.toFixed(5)}</span>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Localização capturada</dt>
                                <dd className="numero">
                                    {detalhe.localizacao_latitude !== null
                                        ? `${detalhe.localizacao_latitude.toFixed(5)}, ${detalhe.localizacao_longitude.toFixed(5)}`
                                        : `Não obtida (${MOTIVOS_DE_INDISPONIBILIDADE[detalhe.localizacao_motivo] ?? "motivo não informado"})`}
                                </dd>
                            </div>
                            <div><dt>Precisão</dt><dd>{formatarDistancia(detalhe.localizacao_precisao)}</dd></div>
                            <div><dt>Distância da organização</dt><dd>{formatarDistancia(detalhe.localizacao_distancia)}</dd></div>
                            <div><dt>Capturada em</dt><dd>{quando(detalhe.localizacao_capturada_em)}</dd></div>
                            <div><dt>Município do evento (em cadeia)</dt><dd>{local(detalhe)}</dd></div>
                            <div><dt>Justificativa</dt><dd>{detalhe.localizacao_justificativa ?? "—"}</dd></div>
                        </dl>
                        <p className="campo-ajuda">
                            A posição é a informada pelo dispositivo no momento do registro. Indica o contexto do registro, não comprova presença física.
                        </p>
                    </>
                )}
            </Dialogo>
        </div>
    );
}
