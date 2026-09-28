import { useMemo, useState } from "react";
import { abrirDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { correcoesVerificaveis as calcularVerificaveis, origemDoRegistro } from "../lib/origem";
import {
    TIPOS, TIPO, dataCurta, dataDe, dataHora, encurtar, numero, rotulosPapel, temDocumento
} from "../lib/formato";
import Botao from "../ui/Botao";
import Copiar from "../ui/Copiar";
import Icone from "../ui/Icone";
import EtiquetaQr from "./EtiquetaQr";

// Dossie do veiculo: identificacao, resumo e a linha do tempo. A
// quilometragem e o dado principal de cada registro; hash, carteira e
// comprovante ficam dentro de "Ver detalhes".
export default function Historico({ chassi, veiculo, identificacao, historico, conforme, possuiAtipicas, entidades, institucional }) {
    const total = historico.length;
    const correcoes = Number(veiculo.totalCorrecoes);
    // Ver lib/origem.js: quando nao da para saber quais registros do tipo
    // correcao sao reais, nenhum e atribuido ao DETRAN.
    const correcoesVerificaveis = calcularVerificaveis(historico, correcoes);

    // Avanco em relacao a leitura valida anterior (leituras contestadas nao
    // entram na conta). Depois, do mais recente para o mais antigo.
    const eventos = useMemo(() => {
        const lista = [];
        let anterior = null;
        for (const [indice, leitura] of historico.entries()) {
            const quilometragem = Number(leitura.quilometragem);
            const tipo = Number(leitura.tipo);
            lista.unshift({
                indice,
                quilometragem,
                tipo,
                avanco: anterior === null || leitura.contestada || tipo === TIPO.CORRECAO ? null : quilometragem - anterior,
                data: dataDe(leitura.data),
                entidade: leitura.entidade,
                hashDocumento: leitura.hashDocumento,
                atipica: leitura.atipica,
                contestada: leitura.contestada
            });
            if (!leitura.contestada) anterior = quilometragem;
        }
        return lista;
    }, [historico]);

    return (
        <article className="dossie">
            <header className="dossie-cabecalho">
                <p className="sobretitulo">Veículo consultado</p>
                <h1 className="dossie-titulo">
                    {identificacao ? `${identificacao.marca_nome} ${identificacao.modelo}` : veiculo.modelo}
                </h1>
                <dl className="dossie-meta">
                    <div>
                        <dt>Chassi</dt>
                        <dd><span className="mono">{chassi}</span><Copiar texto={chassi} rotulo="Copiar chassi" /></dd>
                    </div>
                    {identificacao ? (
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
                    ) : (
                        <div>
                            <dt>Ano-modelo</dt>
                            <dd>{Number(veiculo.ano)}</dd>
                        </div>
                    )}
                </dl>
                {identificacao && (
                    <p className="dossie-nota">
                        Placa e UF vigentes, informadas pelo DETRAN. Ficam no cadastro do KMChain, não na blockchain.
                    </p>
                )}
            </header>

            <section className="resumo" aria-label="Resumo do histórico">
                <dl className="resumo-faixa">
                    <div className="resumo-item resumo-principal">
                        <dt>Última quilometragem</dt>
                        <dd className="resumo-valor">{numero(veiculo.ultimaKm)}<span> km</span></dd>
                    </div>
                    <div className="resumo-item">
                        <dt>Último registro em cadeia</dt>
                        <dd className="resumo-valor">{dataCurta(dataDe(veiculo.ultimaData))}</dd>
                    </div>
                    <div className="resumo-item">
                        <dt>Registros</dt>
                        <dd className="resumo-valor">{numero(veiculo.totalLeituras)}</dd>
                    </div>
                </dl>

                <ul className="resumo-notas">
                    {total > 1 && (
                        <li className={conforme ? "nota-positiva" : ""}>
                            <Icone nome={conforme ? "check" : "info"} tamanho={16} />
                            {conforme
                                ? "Todos os registros após o cadastro têm comprovante anexado."
                                : "Há registros sem comprovante anexado."}
                        </li>
                    )}
                    {possuiAtipicas && (
                        <li className="nota-alerta">
                            <Icone nome="alerta" tamanho={16} />
                            Há leituras com avanço acima do esperado, confirmadas pela entidade responsável.
                        </li>
                    )}
                    {!correcoesVerificaveis && (
                        <li className="nota-alerta">
                            <Icone nome="alerta" tamanho={16} />
                            Há registros do tipo correção que não foram feitos pela função de correção do DETRAN.
                        </li>
                    )}
                    {correcoes > 0 && (
                        <li>
                            <Icone nome="info" tamanho={16} />
                            {correcoes === 1 ? "1 correção feita" : `${correcoes} correções feitas`} pelo DETRAN.
                            As leituras originais continuam no histórico.
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
                    {eventos.map((evento, posicao) => (
                        <EventoHistorico
                            key={evento.indice}
                            evento={evento}
                            recente={posicao === 0}
                            total={total}
                            papeis={entidades[evento.entidade.toLowerCase()]}
                            correcoesVerificaveis={correcoesVerificaveis}
                            institucional={institucional}
                        />
                    ))}
                </ol>
            </section>

            <section className="dossie-rodape">
                <p className="dossie-nota">
                    Os registros não podem ser alterados nem apagados. Uma correção do DETRAN é
                    adicionada ao histórico, e a leitura original continua visível.
                </p>
                <p className="dossie-nota">
                    Cada leitura foi informada por uma carteira credenciada no KmChain, e a data
                    mostrada é a do registro em cadeia. O histórico não comprova que o hodômetro
                    marcava o valor real em cada leitura, nem que não houve adulteração antes do
                    primeiro registro ou entre registros. Credenciamento no KmChain não é
                    credenciamento oficial por órgão público.
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

function EventoHistorico({ evento, recente, total, papeis, correcoesVerificaveis, institucional }) {
    const [aberto, setAberto] = useState(false);
    const [abrindo, setAbrindo] = useState(false);
    const [erroDocumento, setErroDocumento] = useState("");

    // Funcao na epoca so e garantida quando o contrato a exigiu (ver
    // lib/origem.js); fora isso, a funcao exibida e a ATUAL, rotulada assim.
    const origem = origemDoRegistro(evento.tipo, evento.indice, correcoesVerificaveis);
    const exigeDetran = origem === "detran";
    const tipoSemGarantia = origem === "sem-garantia";
    const correcaoReal = exigeDetran && evento.tipo === TIPO.CORRECAO;
    const funcaoAtual = papeis
        ? rotulosPapel(papeis).filter((r) => r !== "Administração").join(" · ") || "sem função ativa"
        : null;
    const responsavel = exigeDetran
        ? "DETRAN"
        : funcaoAtual ? `Carteira credenciada · função atual: ${funcaoAtual}` : "Carteira credenciada";
    const comDocumento = temDocumento(evento.hashDocumento);
    const idDetalhes = `evento-${evento.indice}-detalhes`;

    const classes = [
        "evento",
        recente && "evento-recente",
        evento.contestada && "evento-contestado",
        evento.atipica && "evento-atipico",
        evento.tipo === TIPO.CORRECAO && "evento-correcao"
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
                <span className="visualmente-oculto">Registrado em cadeia em </span>
                <time dateTime={evento.data.toISOString()}>{dataCurta(evento.data)}</time>
                {recente && <span className="evento-rotulo-recente">Mais recente</span>}
            </div>
            <span className="evento-marcador" aria-hidden="true" />
            <div className="evento-corpo">
                <p className="evento-km">
                    <span className="evento-km-valor">{numero(evento.quilometragem)}</span> km
                    {evento.avanco !== null && evento.avanco > 0 && (
                        <span className="evento-avanco">+{numero(evento.avanco)} km</span>
                    )}
                </p>
                <p className="evento-tipo">
                    {correcaoReal ? "Correção do DETRAN" : tipoSemGarantia ? `Registro marcado como ${TIPOS[evento.tipo].toLowerCase()}` : TIPOS[evento.tipo]}
                </p>
                <p className="evento-entidade">
                    {responsavel}
                    <span className="mono">{encurtar(evento.entidade)}</span>
                </p>

                {evento.contestada && (
                    <p className="evento-nota">
                        <Icone nome="info" tamanho={15} />
                        Leitura corrigida pelo DETRAN. Mantida no histórico para consulta.
                    </p>
                )}
                {tipoSemGarantia && (
                    <p className="evento-nota evento-nota-alerta">
                        <Icone nome="alerta" tamanho={15} />
                        {evento.tipo === TIPO.CADASTRO
                            ? "Não é o cadastro original do veículo: foi registrado como leitura comum por uma carteira credenciada."
                            : "Não foi possível confirmar que esta é uma correção do DETRAN. Trate como leitura comum de carteira credenciada."}
                    </p>
                )}
                {evento.atipica && (
                    <p className="evento-nota evento-nota-alerta">
                        <Icone nome="alerta" tamanho={15} />
                        Avanço acima do esperado para o período, confirmado pela entidade.
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
                                <dt>Registrado em cadeia</dt>
                                <dd>{dataHora(evento.data)}</dd>
                            </div>
                            <div>
                                <dt>Função na época</dt>
                                <dd>{exigeDetran ? "DETRAN (exigido pelo contrato)" : "Credenciada (DETRAN, vistoria ou oficina)"}</dd>
                            </div>
                            <div>
                                <dt>Função atual</dt>
                                <dd>{funcaoAtual ?? "—"}</dd>
                            </div>
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
                                <dd>{evento.indice + 1} de {total}</dd>
                            </div>
                        </dl>
                        {erroDocumento && <p className="campo-erro" role="alert"><Icone nome="alerta" tamanho={14} />{erroDocumento}</p>}

                        <p className="evento-detalhes-subtitulo">Dados técnicos</p>
                        <dl className="lista-dados lista-dados-compacta">
                            <div>
                                <dt>Carteira da entidade</dt>
                                <dd><span className="mono quebra">{evento.entidade}</span><Copiar texto={evento.entidade} rotulo="Copiar carteira" /></dd>
                            </div>
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
