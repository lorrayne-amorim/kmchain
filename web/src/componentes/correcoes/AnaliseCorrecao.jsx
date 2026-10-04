import { useEffect, useState } from "react";
import { SITUACOES_DA_SOLICITACAO, aprovarSolicitacao, assinarCorrecao, detalharSolicitacao, rejeitarSolicitacao } from "../../lib/correcoes";
import { abrirDocumento } from "../../lib/documentos";
import { mensagemDeErro } from "../../lib/erros";
import { HASH_VAZIO, agoraLocal, dataHora, km, localParaSegundos } from "../../lib/formato";
import { avisar } from "../../lib/toast";
import { useMunicipios } from "../../lib/useMunicipios";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo from "../../ui/Campo";
import SeletorMunicipio from "../../ui/SeletorMunicipio";
import { DetalhesTecnicos, Progresso } from "../../ui/Transacao";
import ComplementoPendente from "../ComplementoPendente";

const quando = (valor) => (valor ? dataHora(new Date(valor)) : "—");

// Uma solicitacao de correcao com tudo o que fundamenta a decisao: o
// registro questionado, o valor proposto, a justificativa e a evidencia.
// O DETRAN aprova (assinando o evento de correcao em cadeia) ou rejeita; a
// organizacao que solicitou so acompanha.
export default function AnaliseCorrecao({ id, podeDecidir, aoVoltar, aoDecidir }) {
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState("");
    const [motivo, setMotivo] = useState("");
    const [dataEvento, setDataEvento] = useState(agoraLocal);
    const [municipio, setMunicipio] = useState("");
    const [erros, setErros] = useState({});
    const [passo, setPasso] = useState(null);
    const [rejeitando, setRejeitando] = useState(false);
    const [falha, setFalha] = useState("");
    const [abrindo, setAbrindo] = useState(false);
    const [aprovacao, setAprovacao] = useState(null); // { recibo, falha } depois da transacao
    const municipios = useMunicipios();

    useEffect(() => {
        let ativo = true;
        detalharSolicitacao(id)
            .then((d) => ativo && setDados(d))
            .catch((e) => ativo && setErro(mensagemDeErro(e, "Não foi possível carregar a solicitação.")));
        return () => { ativo = false; };
    }, [id]);

    if (erro) return <Aviso tipo="erro" acao={<Botao variante="secundario" tamanho="p" onClick={aoVoltar}>Voltar</Botao>}>{erro}</Aviso>;
    if (!dados) return <div className="painel"><div className="esqueleto-linha esqueleto-titulo" style={{ width: "50%" }} /></div>;

    const { solicitacao: s, original, vistoria } = dados;
    const local = (codigo) => (municipios && codigo ? municipios.rotuloDoMunicipio(codigo) : "—");
    const pendente = s.situacao === "PENDENTE" && !aprovacao;

    function validar(aprovando) {
        const novos = {};
        if (motivo.trim().length < 10) novos.motivo = "Descreva o motivo da decisão.";
        if (aprovando && !municipio) novos.municipio = "Escolha a UF e a cidade.";
        setErros(novos);
        return Object.keys(novos).length === 0;
    }

    async function aprovar() {
        setFalha("");
        if (!validar(true)) return;
        try {
            const recibo = await assinarCorrecao({
                chassi: s.chassi, indice: s.indice_original, km: s.km_solicitada,
                dataEvento: localParaSegundos(dataEvento), municipio, hashDocumento: s.hash_evidencia ?? HASH_VAZIO
            }, setPasso);
            // A correcao ja esta em cadeia; falta registrar a decisao no banco.
            let falhaDecisao = null;
            try {
                await aprovarSolicitacao(s.id, motivo, recibo.hash);
            } catch (e) {
                falhaDecisao = mensagemDeErro(e, "");
            }
            setAprovacao({ recibo, falha: falhaDecisao });
            avisar("Correção registrada no histórico.");
            if (falhaDecisao === null) aoDecidir();
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível registrar a correção. Tente novamente."));
        } finally {
            setPasso(null);
        }
    }

    async function rejeitar() {
        setFalha("");
        if (!validar(false)) return;
        setRejeitando(true);
        try {
            await rejeitarSolicitacao(s.id, motivo);
            avisar("Solicitação rejeitada.");
            aoDecidir();
            aoVoltar();
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível rejeitar a solicitação."));
        } finally {
            setRejeitando(false);
        }
    }

    async function abrirEvidencia() {
        setFalha("");
        setAbrindo(true);
        try {
            await abrirDocumento(s.hash_evidencia);
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível abrir o documento."));
        } finally {
            setAbrindo(false);
        }
    }

    return (
        <div className="empilhado">
            <Botao variante="fantasma" tamanho="p" icone="voltar" className="voltar" onClick={aoVoltar}>Todas as solicitações</Botao>

            <section className="painel">
                <h2 className="painel-titulo">Solicitação de correção · {SITUACOES_DA_SOLICITACAO[s.situacao]}</h2>
                <p className="painel-texto"><span className="mono">{s.chassi}</span></p>
                <div className="comparacao">
                    <div>
                        <p className="comparacao-rotulo">Registro questionado</p>
                        <p className="comparacao-valor comparacao-anterior">{km(s.km_original)}</p>
                        <p className="comparacao-meta">{original?.tipo_evento ?? `Registro ${s.indice_original + 1}`}</p>
                    </div>
                    <div>
                        <p className="comparacao-rotulo">Quilometragem solicitada</p>
                        <p className="comparacao-valor">{km(s.km_solicitada)}</p>
                        <p className="comparacao-meta">{s.organizacao_nome}</p>
                    </div>
                </div>
                <dl className="lista-dados">
                    <div><dt>Justificativa</dt><dd>{s.justificativa}</dd></div>
                    <div><dt>Solicitada por</dt><dd>{s.solicitante_nome} · {s.organizacao_nome}</dd></div>
                    <div><dt>Solicitada em</dt><dd>{quando(s.solicitada_em)}</dd></div>
                </dl>
            </section>

            {original && (
                <section className="painel">
                    <h2 className="painel-titulo">Registro original</h2>
                    <dl className="lista-dados">
                        <div><dt>Evento</dt><dd>{original.tipo_evento}</dd></div>
                        <div><dt>Quilometragem</dt><dd>{km(original.quilometragem)}</dd></div>
                        <div><dt>Data e hora do evento</dt><dd>{quando(original.observada_em)}</dd></div>
                        <div><dt>Local do evento</dt><dd>{local(original.municipio_ibge)}</dd></div>
                        <div><dt>Organização</dt><dd>{original.organizacao_nome}</dd></div>
                        <div><dt>Registrado por</dt><dd>{original.usuario_nome}</dd></div>
                    </dl>
                </section>
            )}

            <section className="painel">
                <h2 className="painel-titulo">Evidência</h2>
                <dl className="lista-dados">
                    <div>
                        <dt>Documento</dt>
                        <dd>
                            {s.hash_evidencia ? "Anexado" : "Não anexado"}
                            {s.hash_evidencia && (
                                <Botao variante="secundario" tamanho="p" icone="arquivo" carregando={abrindo} onClick={abrirEvidencia}>Abrir documento</Botao>
                            )}
                        </dd>
                    </div>
                    {vistoria ? (
                        <>
                            <div><dt>Vistoria indicada</dt><dd>{vistoria.tipo_evento} · {km(vistoria.quilometragem)}</dd></div>
                            <div><dt>Data e hora da vistoria</dt><dd>{quando(vistoria.observada_em)}</dd></div>
                            <div><dt>Local da vistoria</dt><dd>{local(vistoria.municipio_ibge)}</dd></div>
                            <div><dt>Organização que vistoriou</dt><dd>{vistoria.organizacao_nome}</dd></div>
                            <div><dt>Funcionário responsável</dt><dd>{vistoria.usuario_nome}</dd></div>
                        </>
                    ) : (
                        <div><dt>Vistoria indicada</dt><dd>Nenhuma</dd></div>
                    )}
                </dl>
            </section>

            {s.situacao !== "PENDENTE" && (
                <section className="painel">
                    <h2 className="painel-titulo">Decisão do DETRAN</h2>
                    <dl className="lista-dados">
                        <div><dt>Situação</dt><dd>{SITUACOES_DA_SOLICITACAO[s.situacao]}</dd></div>
                        <div><dt>Motivo</dt><dd>{s.motivo_decisao}</dd></div>
                        <div><dt>Analisada por</dt><dd>{s.analista_nome}</dd></div>
                        <div><dt>Analisada em</dt><dd>{quando(s.analisada_em)}</dd></div>
                        {s.situacao === "APROVADA" && <div><dt>Evento de correção</dt><dd>Registro {s.correcao_indice + 1} do histórico</dd></div>}
                    </dl>
                    {s.situacao === "REJEITADA" && (
                        <p className="painel-texto">Solicitação rejeitada: nenhum evento foi registrado na blockchain.</p>
                    )}
                </section>
            )}

            {aprovacao && (
                <Aviso tipo="sucesso" titulo="Correção registrada na blockchain">
                    <p>O registro original continua no histórico, sem alteração.</p>
                    <DetalhesTecnicos recibo={aprovacao.recibo} />
                    {aprovacao.falha !== null && (
                        <ComplementoPendente enviar={() => aprovarSolicitacao(s.id, motivo, aprovacao.recibo.hash)}
                            falhaInicial={aprovacao.falha} oQue="A decisão e o motivo" aoSalvar={aoDecidir} />
                    )}
                </Aviso>
            )}

            {pendente && podeDecidir && (
                <section className="painel formulario-empilhado">
                    <h2 className="painel-titulo">Decisão</h2>
                    <Campo rotulo="Motivo da decisão" erro={erros.motivo}>
                        <textarea rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                    </Campo>
                    <Campo rotulo="Data e hora da correção" className="campo-curto" ajuda="Usada só na aprovação.">
                        <input type="datetime-local" value={dataEvento} max={agoraLocal()} onChange={(e) => setDataEvento(e.target.value)} />
                    </Campo>
                    <SeletorMunicipio valor={municipio} erro={erros.municipio} rotuloCidade="Cidade da correção"
                        ajuda="Onde a correção é feita. O local do registro original não muda." aoEscolher={setMunicipio} />
                    <Aviso tipo="info">
                        Aprovar registra na blockchain um novo evento de correção com {km(s.km_solicitada)}, que
                        referencia o registro original. Rejeitar não registra nada em cadeia: a decisão fica no
                        cadastro do KMChain.
                    </Aviso>
                    {falha && <Aviso tipo="erro">{falha}</Aviso>}
                    {passo ? <Progresso passo={passo} /> : (
                        <div className="acoes acoes-fim">
                            <Botao variante="fantasma" className="texto-perigo" carregando={rejeitando} onClick={rejeitar}>Rejeitar</Botao>
                            <Botao onClick={aprovar} disabled={rejeitando}>Aprovar e registrar correção</Botao>
                        </div>
                    )}
                </section>
            )}
            {pendente && !podeDecidir && <Aviso tipo="info">Aguardando análise do DETRAN.</Aviso>}
            {!podeDecidir && falha && <Aviso tipo="erro">{falha}</Aviso>}
        </div>
    );
}
