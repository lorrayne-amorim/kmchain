import { useState } from "react";
import { solicitarCorrecao } from "../../lib/correcoes";
import { enviarDocumento } from "../../lib/documentos";
import { mensagemDeErro } from "../../lib/erros";
import { eventoPorCodigo } from "../../lib/eventos";
import { focarPrimeiroErro } from "../../lib/foco";
import { dataHora, km, normalizarChassi, validarChassi } from "../../lib/formato";
import { carregarHistorico, foiCorrigido } from "../../lib/historico";
import { avisar } from "../../lib/toast";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo, { CampoArquivo } from "../../ui/Campo";

// Oficina, empresa de vistoria ou seguradora aponta um registro que considera
// errado e propoe a quilometragem correta. Nada muda na blockchain: a
// solicitacao fica no banco ate o DETRAN decidir.
export default function SolicitarCorrecao({ aoEnviar }) {
    const [chassi, setChassi] = useState("");
    const [chassiCarregado, setChassiCarregado] = useState("");
    const [erroChassi, setErroChassi] = useState("");
    const [carregando, setCarregando] = useState(false);
    const [eventos, setEventos] = useState(null);

    const [indice, setIndice] = useState(null);
    const [kmSolicitada, setKmSolicitada] = useState("");
    const [justificativa, setJustificativa] = useState("");
    const [vistoriaIndice, setVistoriaIndice] = useState("");
    const [arquivo, setArquivo] = useState(null);
    const [erros, setErros] = useState({});
    const [falha, setFalha] = useState("");
    const [enviando, setEnviando] = useState(false);

    async function carregar(e) {
        e.preventDefault();
        setErroChassi("");
        setEventos(null);
        setIndice(null);
        const problema = validarChassi(chassi);
        if (problema) return setErroChassi(problema);

        setCarregando(true);
        try {
            const historico = await carregarHistorico(chassi);
            if (!historico) return setErroChassi("Não encontramos um veículo com esse chassi.");
            setEventos(historico.eventos);
            setChassiCarregado(chassi);
        } catch (erro) {
            setErroChassi(mensagemDeErro(erro, "Não foi possível carregar o histórico. Tente novamente."));
        } finally {
            setCarregando(false);
        }
    }

    async function enviar(e) {
        e.preventDefault();
        setFalha("");
        const novos = {};
        if (kmSolicitada === "") novos.kmSolicitada = "Informe a quilometragem considerada correta.";
        if (justificativa.trim().length < 10) novos.justificativa = "Descreva o erro encontrado.";
        if (!arquivo && vistoriaIndice === "") novos.evidencia = "Anexe um documento ou indique uma vistoria registrada.";
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        setEnviando(true);
        try {
            const hashEvidencia = arquivo ? await enviarDocumento(arquivo, chassiCarregado) : null;
            await solicitarCorrecao({
                chassi: chassiCarregado, indice, kmSolicitada, justificativa, hashEvidencia,
                vistoriaIndice: vistoriaIndice === "" ? null : Number(vistoriaIndice)
            });
            avisar("Solicitação enviada ao DETRAN.");
            aoEnviar();
        } catch (erro) {
            if (erro.dados?.campos) {
                setErros(erro.dados.campos);
                focarPrimeiroErro();
            } else {
                setFalha(mensagemDeErro(erro, "Não foi possível enviar a solicitação."));
            }
        } finally {
            setEnviando(false);
        }
    }

    const selecionado = eventos?.find((ev) => ev.indice === indice);
    // Vistorias do mesmo veiculo que podem servir de evidencia.
    const vistorias = eventos?.filter((ev) => ev.indice !== indice && eventoPorCodigo(ev.tipo)?.vistoria) ?? [];

    return (
        <div className="empilhado">
            <form className="painel busca-linha" noValidate onSubmit={carregar}>
                <Campo rotulo="Chassi do veículo" erro={erroChassi}>
                    <input className="mono" value={chassi} maxLength={17} placeholder="Digite o chassi"
                        autoComplete="off" autoCapitalize="characters" spellCheck={false}
                        onChange={(e) => setChassi(normalizarChassi(e.target.value))} />
                </Campo>
                <Botao type="submit" variante="secundario" icone="busca" carregando={carregando}>Carregar histórico</Botao>
            </form>

            {eventos && (
                <div className="painel">
                    <h2 className="painel-titulo">Selecione o registro questionado</h2>
                    <p className="painel-texto">O registro original não é alterado. Se o DETRAN aprovar, a correção entra como um novo evento.</p>

                    <fieldset className="lista-selecao">
                        <legend className="visualmente-oculto">Registros do veículo</legend>
                        {[...eventos].reverse().map((ev) => (
                            <label key={ev.indice} className={`selecao-item ${foiCorrigido(ev) ? "selecao-desativada" : ""}`}>
                                <input type="radio" name="registro" disabled={foiCorrigido(ev)} checked={indice === ev.indice}
                                    onChange={() => {
                                        setIndice(ev.indice);
                                        setVistoriaIndice("");
                                        setErros({});
                                    }} />
                                <span className="selecao-km">{km(ev.km)}</span>
                                <span className="selecao-meta">{ev.rotulo} · {dataHora(ev.dataEvento)}</span>
                                <span className="selecao-meta selecao-estado">{foiCorrigido(ev) ? "Já corrigido" : `Registro ${ev.indice + 1}`}</span>
                            </label>
                        ))}
                    </fieldset>

                    {selecionado && (
                        <form className="grupo" onSubmit={enviar} noValidate>
                            <Campo rotulo="Quilometragem considerada correta" sufixo="km" erro={erros.kmSolicitada} className="campo-curto">
                                <input className="entrada-km" inputMode="numeric" autoComplete="off" value={kmSolicitada}
                                    onChange={(e) => setKmSolicitada(e.target.value.replace(/\D/g, ""))} />
                            </Campo>
                            <Campo rotulo="Justificativa" erro={erros.justificativa}
                                ajuda={erros.justificativa ? undefined : "Explique o erro e como chegou ao valor correto."}>
                                <textarea rows={3} maxLength={1000} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
                            </Campo>

                            <p className="campo-rotulo">Evidência</p>
                            {vistorias.length > 0 && (
                                <Campo rotulo="Vistoria já registrada no KMChain" opcional erro={erros.vistoriaIndice}>
                                    <select value={vistoriaIndice} onChange={(e) => setVistoriaIndice(e.target.value)}>
                                        <option value="">Nenhuma</option>
                                        {vistorias.map((v) => (
                                            <option key={v.indice} value={v.indice}>{v.rotulo} · {km(v.km)} · {dataHora(v.dataEvento)}</option>
                                        ))}
                                    </select>
                                </Campo>
                            )}
                            <CampoArquivo rotulo="Documento complementar" arquivo={arquivo} aoEscolher={setArquivo}
                                ajuda="Laudo, nota de serviço ou foto do hodômetro. PDF ou imagem. Só o DETRAN e a sua conta abrem este documento." />
                            {erros.evidencia && <Aviso tipo="erro">{erros.evidencia}</Aviso>}
                            {falha && <Aviso tipo="erro">{falha}</Aviso>}

                            <div className="acoes acoes-fim">
                                <Botao type="submit" carregando={enviando}>Enviar ao DETRAN</Botao>
                            </div>
                        </form>
                    )}
                </div>
            )}
        </div>
    );
}
