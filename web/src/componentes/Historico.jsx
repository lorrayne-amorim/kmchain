import { useMemo, useState } from "react";
import { linkTransacao } from "../lib/blockchain";
import { abrirDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { dataCurta, dataHora, encurtar, numero, temDocumento } from "../lib/formato";
import { foiCorrigido } from "../lib/historico";
import Botao from "../ui/Botao";
import Copiar from "../ui/Copiar";
import Icone from "../ui/Icone";
import EtiquetaQr from "./EtiquetaQr";

// Nome da organizacao na data do evento: o identificador gravado em cadeia
// nao muda, mas o nome pode ter mudado depois.
function nomeNaData(organizacao, data) {
    const nomes = organizacao.nomes ?? [];
    const vigente = [...nomes].reverse().find((n) => new Date(n.desde) <= data) ?? nomes[0];
    return vigente?.nome ?? organizacao.nome_fantasia;
}

// Dossie do veiculo: identificacao, resumo, a linha do tempo e os locais dos
// registros. Os eventos vem da blockchain; identificacao do veiculo e nomes
// das organizacoes vem do cadastro do KMChain.
export default function Historico({ historico, identificacao, complementos, organizacoes, municipios, institucional }) {
    const { chassi, eventos } = historico;
    const total = eventos.length;

    // Avanco em relacao ao registro valido anterior (os corrigidos nao entram
    // na conta). Depois, do mais recente para o mais antigo.
    const linhas = useMemo(() => {
        const lista = [];
        let anterior = null;
        eventos.forEach((evento, posicao) => {
            const corrigido = foiCorrigido(evento);
            lista.unshift({
                ...evento,
                posicao,
                avanco: anterior === null || corrigido || evento.correcao ? null : evento.km - anterior
            });
            if (!corrigido) anterior = evento.km;
        });
        return lista;
    }, [eventos]);

    const organizacaoDe = (evento) => organizacoes?.[evento.organizacao] ?? null;
    const localDe = (evento) => (municipios ? municipios.rotuloDoMunicipio(evento.municipio) : null);

    return (
        <article className="dossie">
            <header className="dossie-cabecalho">
                <p className="sobretitulo">Veículo consultado</p>
                <h1 className="dossie-titulo">
                    {identificacao ? `${identificacao.marca_nome} ${identificacao.modelo}` : "Veículo sem identificação cadastrada"}
                </h1>
                <dl className="dossie-meta">
                    <div>
                        <dt>Chassi</dt>
                        <dd><span className="mono">{chassi}</span><Copiar texto={chassi} rotulo="Copiar chassi" /></dd>
                    </div>
                    {identificacao && (
                        <>
                            <div>
                                <dt>Placa</dt>
                                <dd className="mono">{identificacao.placa ?? "—"}</dd>
                            </div>
                            <div>
                                <dt>UF de registro</dt>
                                <dd>{identificacao.uf ?? "—"}</dd>
                            </div>
                            <div>
                                <dt>Fabricação / modelo</dt>
                                <dd>{identificacao.ano_fabricacao} / {identificacao.ano_modelo}</dd>
                            </div>
                        </>
                    )}
                </dl>
                {identificacao && (
                    <p className="dossie-nota">
                        Marca, modelo, anos, placa e UF vêm do cadastro do KMChain, informados pelo DETRAN. Não ficam na blockchain.
                    </p>
                )}
            </header>

            <section className="resumo" aria-label="Resumo do histórico">
                <dl className="resumo-faixa">
                    <div className="resumo-item resumo-principal">
                        <dt>Última quilometragem</dt>
                        <dd className="resumo-valor">{numero(historico.ultimaKm)}<span> km</span></dd>
                    </div>
                    <div className="resumo-item">
                        <dt>Último evento</dt>
                        <dd className="resumo-valor">{dataCurta(historico.ultimaData)}</dd>
                    </div>
                    <div className="resumo-item">
                        <dt>Registros</dt>
                        <dd className="resumo-valor">{numero(total)}</dd>
                    </div>
                </dl>

                <ul className="resumo-notas">
                    {total > 1 && (
                        <li className={historico.semComprovante ? "" : "nota-positiva"}>
                            <Icone nome={historico.semComprovante ? "info" : "check"} tamanho={16} />
                            {historico.semComprovante
                                ? "Há registros sem comprovante anexado."
                                : "Todos os registros após o cadastro têm comprovante anexado."}
                        </li>
                    )}
                    {historico.possuiAtipicas && (
                        <li className="nota-alerta">
                            <Icone nome="alerta" tamanho={16} />
                            Há registros com avanço acima do esperado, confirmados por quem registrou.
                        </li>
                    )}
                    {historico.correcoes > 0 && (
                        <li>
                            <Icone nome="info" tamanho={16} />
                            {historico.correcoes === 1 ? "1 correção feita" : `${historico.correcoes} correções feitas`} pelo DETRAN.
                            Os registros originais continuam no histórico.
                        </li>
                    )}
                </ul>
            </section>

            <section className="historico" aria-labelledby="titulo-historico">
                <div className="secao-titulo">
                    <h2 id="titulo-historico">Histórico de quilometragem</h2>
                    <p>Do mais recente para o mais antigo</p>
                </div>

                <ol className="linha-do-tempo">
                    {linhas.map((evento, i) => (
                        <EventoHistorico
                            key={evento.indice}
                            evento={evento}
                            recente={i === 0}
                            total={total}
                            organizacao={organizacaoDe(evento)}
                            local={localDe(evento)}
                            complemento={complementos?.[evento.indice]}
                            institucional={institucional}
                        />
                    ))}
                </ol>
            </section>

            {eventos.length > 0 && (
                <section className="historico" aria-labelledby="titulo-locais">
                    <div className="secao-titulo">
                        <h2 id="titulo-locais">Histórico de locais dos registros</h2>
                        <p>Do mais antigo para o mais recente</p>
                    </div>
                    <ol className="locais">
                        {eventos.map((e) => (
                            <li key={e.indice}>
                                <span className="locais-cidade">{localDe(e) ?? "…"}</span>
                                <span className="locais-meta">{numero(e.km)} km · {dataHora(e.dataEvento)} · {e.rotulo}</span>
                            </li>
                        ))}
                    </ol>
                    <p className="dossie-nota">
                        São os locais onde os eventos foram registrados no KMChain. Não representam o trajeto do
                        veículo nem um rastreamento.
                    </p>
                </section>
            )}

            <section className="dossie-rodape">
                <p className="dossie-nota">
                    Depois de gravado na blockchain, um registro não pode ser alterado nem apagado. Uma correção
                    aprovada pelo DETRAN entra como novo evento, e o registro original continua visível.
                </p>
                <p className="dossie-nota">
                    “Localização verificada” indica que o dispositivo usado no registro informou uma posição
                    compatível com o endereço cadastrado da organização. É um indício adicional, não uma prova de
                    presença: a posição informada pelo dispositivo pode ser imprecisa ou manipulada.
                </p>
                <p className="dossie-nota">
                    A blockchain protege a integridade dos registros depois de inseridos; ela não comprova que o
                    hodômetro marcava o valor real em cada evento, nem que não houve adulteração antes do primeiro
                    registro ou entre registros. Cada evento foi informado por um usuário vinculado a uma organização
                    credenciada no KMChain, um protótipo acadêmico: esse credenciamento não é oficial, e o uso do
                    nome DETRAN não indica vínculo com órgão público.
                </p>
                <details className="recolhivel">
                    <summary>
                        <Icone nome="qr" />
                        Etiqueta com QR Code deste veículo
                        <Icone nome="baixo" className="recolhivel-seta" />
                    </summary>
                    <EtiquetaQr chassi={chassi} />
                </details>
            </section>
        </article>
    );
}

// `complemento` vem do cadastro do KMChain: a transacao do evento e se a
// localizacao do dispositivo foi verificada no registro (sem coordenadas).
function EventoHistorico({ evento, recente, total, organizacao, local, complemento, institucional }) {
    const transacao = complemento?.tx_hash;
    const [aberto, setAberto] = useState(false);
    const [abrindo, setAbrindo] = useState(false);
    const [erroDocumento, setErroDocumento] = useState("");

    const corrigido = foiCorrigido(evento);
    const comDocumento = temDocumento(evento.hashDocumento);
    const idDetalhes = `evento-${evento.indice}-detalhes`;
    const responsavel = organizacao ? nomeNaData(organizacao, evento.dataRegistro) : `Organização ${evento.organizacao}`;
    const nomeMudou = organizacao && responsavel !== organizacao.nome_fantasia;

    const classes = [
        "evento",
        recente && "evento-recente",
        corrigido && "evento-contestado",
        evento.atipica && "evento-atipico",
        evento.correcao && "evento-correcao"
    ].filter(Boolean).join(" ");

    async function abrir() {
        setErroDocumento("");
        setAbrindo(true);
        try {
            await abrirDocumento(evento.hashDocumento);
        } catch (e) {
            setErroDocumento(mensagemDeErro(e, "Não foi possível abrir o comprovante."));
        } finally {
            setAbrindo(false);
        }
    }

    return (
        <li className={classes}>
            <div className="evento-data">
                <span className="visualmente-oculto">Evento em </span>
                <time dateTime={evento.dataEvento.toISOString()}>{dataCurta(evento.dataEvento)}</time>
                {recente && <span className="evento-rotulo-recente">Mais recente</span>}
            </div>
            <span className="evento-marcador" aria-hidden="true" />
            <div className="evento-corpo">
                <p className="evento-tipo evento-tipo-destaque">
                    {evento.rotulo}
                </p>
                <p className="evento-km">
                    <span className="evento-km-valor">{numero(evento.km)}</span> km
                    {evento.avanco !== null && evento.avanco > 0 && (
                        <span className="evento-avanco">+{numero(evento.avanco)} km</span>
                    )}
                </p>
                <p className="evento-entidade">{dataHora(evento.dataEvento)}</p>
                <p className="evento-entidade">{local ?? "Carregando local…"}</p>
                <p className="evento-entidade">
                    <span>Registrado por: <strong>{responsavel}</strong></span>
                    {nomeMudou && <span>(hoje {organizacao.nome_fantasia})</span>}
                </p>
                <p className="evento-verificado">
                    <Icone nome="check" tamanho={14} />
                    Registro verificado na blockchain
                </p>
                {complemento?.localizacao_verificada && (
                    <p className="evento-verificado evento-local-verificado">
                        <Icone nome="check" tamanho={14} />
                        Localização verificada no momento do registro
                    </p>
                )}

                {evento.correcao && evento.referencia !== null && (
                    <p className="evento-nota">
                        <Icone nome="info" tamanho={15} />
                        Correção do registro {evento.referencia + 1}, validada pelo DETRAN.
                    </p>
                )}
                {corrigido && (
                    <p className="evento-nota">
                        <Icone nome="info" tamanho={15} />
                        Registro corrigido pelo registro {evento.corrigidoPor + 1}. Mantido no histórico, sem alteração.
                    </p>
                )}
                {evento.atipica && (
                    <p className="evento-nota evento-nota-alerta">
                        <Icone nome="alerta" tamanho={15} />
                        Avanço acima do esperado para o período, confirmado por quem registrou.
                    </p>
                )}

                <button
                    type="button"
                    className="evento-alternar"
                    aria-expanded={aberto}
                    aria-controls={idDetalhes}
                    onClick={() => setAberto((v) => !v)}
                >
                    {aberto ? "Ocultar detalhes" : "Ver detalhes"}
                    <Icone nome="baixo" tamanho={16} />
                </button>

                {aberto && (
                    <div id={idDetalhes} className="evento-detalhes">
                        <dl className="lista-dados lista-dados-compacta">
                            <div>
                                <dt>Data e hora do evento</dt>
                                <dd>{dataHora(evento.dataEvento)}</dd>
                            </div>
                            <div>
                                <dt>Data e hora da transação</dt>
                                <dd>{dataHora(evento.dataRegistro)}</dd>
                            </div>
                            {organizacao && (
                                <div>
                                    <dt>Credenciamento</dt>
                                    <dd>Organização ativa na data do registro (exigido pelo contrato){organizacao.situacao === "suspensa" && " · hoje suspensa"}</dd>
                                </div>
                            )}
                            <div>
                                <dt>Comprovante</dt>
                                <dd>
                                    {comDocumento ? "Anexado" : "Não anexado"}
                                    {comDocumento && institucional && (
                                        <Botao variante="secundario" tamanho="p" icone="arquivo" carregando={abrindo} onClick={abrir}>
                                            Abrir comprovante
                                        </Botao>
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>Registro</dt>
                                <dd>{evento.posicao + 1} de {total}</dd>
                            </div>
                        </dl>
                        {erroDocumento && <p className="campo-erro" role="alert"><Icone nome="alerta" tamanho={14} />{erroDocumento}</p>}

                        <p className="evento-detalhes-subtitulo">Dados técnicos (em cadeia)</p>
                        <dl className="lista-dados lista-dados-compacta">
                            <div><dt>Identificador da organização</dt><dd className="numero">{evento.organizacao}</dd></div>
                            <div><dt>Código IBGE do município</dt><dd className="numero">{evento.municipio}</dd></div>
                            <div>
                                <dt>Carteira do responsável</dt>
                                <dd><span className="mono quebra">{evento.responsavel}</span><Copiar texto={evento.responsavel} rotulo="Copiar carteira" /></dd>
                            </div>
                            {transacao && (
                                <div>
                                    <dt>Transação</dt>
                                    <dd>
                                        <span className="mono">{encurtar(transacao, 10, 8)}</span>
                                        <a href={linkTransacao(transacao)} target="_blank" rel="noreferrer" className="link-externo">
                                            Abrir no explorador <Icone nome="externo" tamanho={13} />
                                        </a>
                                    </dd>
                                </div>
                            )}
                            {comDocumento && (
                                <div>
                                    <dt>Hash do comprovante</dt>
                                    <dd><span className="mono quebra">{evento.hashDocumento}</span><Copiar texto={evento.hashDocumento} rotulo="Copiar hash" /></dd>
                                </div>
                            )}
                        </dl>
                    </div>
                )}
            </div>
        </li>
    );
}

export function EsqueletoHistorico() {
    return (
        <div className="dossie esqueleto" aria-busy="true" aria-label="Carregando histórico">
            <div className="esqueleto-linha" style={{ width: 120 }} />
            <div className="esqueleto-linha esqueleto-titulo" style={{ width: "55%" }} />
            <div className="esqueleto-linha" style={{ width: "40%" }} />
            <div className="esqueleto-faixa">
                <div className="esqueleto-bloco" /><div className="esqueleto-bloco" /><div className="esqueleto-bloco" />
            </div>
            {[0, 1, 2].map((i) => (
                <div key={i} className="esqueleto-evento">
                    <div className="esqueleto-no" />
                    <div className="esqueleto-evento-texto">
                        <div className="esqueleto-linha" style={{ width: 90 }} />
                        <div className="esqueleto-linha esqueleto-km" style={{ width: 140 }} />
                        <div className="esqueleto-linha" style={{ width: 180 }} />
                    </div>
                </div>
            ))}
        </div>
    );
}
