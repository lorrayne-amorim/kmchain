import { useState } from "react";
import { assinarCorrecao } from "../../lib/correcoes";
import { enviarDocumento } from "../../lib/documentos";
import { mensagemDeErro } from "../../lib/erros";
import { HASH_VAZIO, agoraLocal, dataHora, km, localParaSegundos, normalizarChassi, validarChassi } from "../../lib/formato";
import { carregarHistorico, foiCorrigido } from "../../lib/historico";
import { registrarComplemento } from "../../lib/registros";
import { avisar } from "../../lib/toast";
import { useMunicipios } from "../../lib/useMunicipios";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo, { CampoArquivo } from "../../ui/Campo";
import Icone from "../../ui/Icone";
import SeletorMunicipio from "../../ui/SeletorMunicipio";
import { Concluido, Progresso } from "../../ui/Transacao";
import ComplementoPendente from "../ComplementoPendente";

// Correcao de oficio, exclusiva do DETRAN, sem solicitacao de outra
// organizacao. Nada e apagado nem alterado: entra um novo evento de
// correcao, com data, local e justificativa proprios, que referencia o
// registro original.
export default function CorrigirLeitura({ aoVerHistorico }) {
    const [chassi, setChassi] = useState("");
    const [chassiCarregado, setChassiCarregado] = useState("");
    const [erroChassi, setErroChassi] = useState("");
    const [carregando, setCarregando] = useState(false);
    const [eventos, setEventos] = useState(null);

    const [indice, setIndice] = useState(null);
    const [kmCorreta, setKmCorreta] = useState("");
    const [justificativa, setJustificativa] = useState("");
    const [dataEvento, setDataEvento] = useState(agoraLocal);
    const [municipio, setMunicipio] = useState("");
    const [arquivo, setArquivo] = useState(null);
    const [erros, setErros] = useState({});

    const [etapa, setEtapa] = useState("selecao"); // selecao | revisao | enviando | concluido
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [recibo, setRecibo] = useState(null);
    const [pendente, setPendente] = useState(null); // { dados, falha } se o complemento falhou
    const municipios = useMunicipios();

    async function carregar(alvo) {
        setErroChassi("");
        setFalha("");
        const problema = validarChassi(alvo);
        if (problema) return setErroChassi(problema);

        setCarregando(true);
        try {
            const historico = await carregarHistorico(alvo);
            if (!historico) {
                setEventos(null);
                return setErroChassi("Não encontramos um veículo com esse chassi.");
            }
            setEventos(historico.eventos);
            setChassiCarregado(alvo);
        } catch (e) {
            setErroChassi(mensagemDeErro(e, "Não foi possível carregar o histórico. Tente novamente."));
        } finally {
            setCarregando(false);
        }
    }

    function recomecar() {
        setIndice(null);
        setKmCorreta("");
        setJustificativa("");
        setArquivo(null);
        setErros({});
        setEtapa("selecao");
        setRecibo(null);
        setPendente(null);
    }

    function revisar(e) {
        e.preventDefault();
        const novos = {};
        if (kmCorreta === "") novos.km = "Informe a quilometragem correta.";
        if (justificativa.trim().length < 10) novos.justificativa = "Descreva o motivo da correção.";
        if (!municipio) novos.municipio = "Escolha a UF e a cidade.";
        setErros(novos);
        if (Object.keys(novos).length === 0) setEtapa("revisao");
    }

    async function corrigir() {
        setFalha("");
        setEtapa("enviando");
        try {
            let hashDocumento = HASH_VAZIO;
            if (arquivo) {
                setPasso("documento");
                hashDocumento = await enviarDocumento(arquivo, chassiCarregado);
            }
            const r = await assinarCorrecao({
                chassi: chassiCarregado, indice, km: kmCorreta, dataEvento: localParaSegundos(dataEvento), municipio, hashDocumento
            }, setPasso);

            // A justificativa e quem corrigiu ficam no banco do KMChain.
            const dados = { chassi: chassiCarregado, txHash: r.hash, justificativa };
            try {
                await registrarComplemento(dados);
                setPendente(null);
            } catch (erroComplemento) {
                setPendente({ dados, falha: mensagemDeErro(erroComplemento, "") });
            }

            setRecibo(r);
            setEtapa("concluido");
            avisar("Correção adicionada ao histórico.");
            carregar(chassiCarregado);
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível concluir a correção. Tente novamente."));
            setEtapa("revisao");
        } finally {
            setPasso(null);
        }
    }

    const selecionado = eventos?.find((e) => e.indice === indice);
    const local = municipios && municipio ? municipios.rotuloDoMunicipio(municipio) : "";

    return (
        <div className="empilhado">
            <form
                className="painel busca-linha"
                noValidate
                onSubmit={(e) => {
                    e.preventDefault();
                    recomecar();
                    carregar(chassi);
                }}
            >
                <Campo rotulo="Chassi do veículo" erro={erroChassi}>
                    <input className="mono" value={chassi} maxLength={17} placeholder="Digite o chassi"
                        autoComplete="off" autoCapitalize="characters" spellCheck={false}
                        onChange={(e) => setChassi(normalizarChassi(e.target.value))} />
                </Campo>
                <Botao type="submit" variante="secundario" icone="busca" carregando={carregando}>Carregar histórico</Botao>
            </form>

            {etapa === "concluido" && (
                <Concluido
                    titulo="Correção adicionada ao histórico"
                    recibo={recibo}
                    acoes={
                        <>
                            <Botao variante="secundario" onClick={() => aoVerHistorico(chassiCarregado)}>Ver histórico do veículo</Botao>
                            <Botao variante="fantasma" onClick={recomecar}>Corrigir outro registro</Botao>
                        </>
                    }
                >
                    <p>O registro original continua no histórico, sem alteração, ao lado da correção.</p>
                    {pendente && (
                        <ComplementoPendente enviar={() => registrarComplemento(pendente.dados)} falhaInicial={pendente.falha}
                            oQue="A justificativa e o responsável pela correção" />
                    )}
                </Concluido>
            )}

            {eventos && etapa === "selecao" && (
                <div className="painel">
                    <h2 className="painel-titulo">Selecione o registro a corrigir</h2>
                    <p className="painel-texto">Registros já corrigidos não podem ser selecionados novamente.</p>

                    <fieldset className="lista-selecao">
                        <legend className="visualmente-oculto">Registros do veículo</legend>
                        {[...eventos].reverse().map((e) => (
                            <label key={e.indice} className={`selecao-item ${foiCorrigido(e) ? "selecao-desativada" : ""}`}>
                                <input type="radio" name="registro" disabled={foiCorrigido(e)}
                                    checked={indice === e.indice}
                                    onChange={() => {
                                        setIndice(e.indice);
                                        setErros({});
                                    }} />
                                <span className="selecao-km">{km(e.km)}</span>
                                <span className="selecao-meta">{e.rotulo} · {dataHora(e.dataEvento)}</span>
                                <span className="selecao-meta selecao-estado">
                                    {foiCorrigido(e) ? "Já corrigido" : `Registro ${e.indice + 1}`}
                                </span>
                            </label>
                        ))}
                    </fieldset>

                    {selecionado && (
                        <form className="grupo" onSubmit={revisar} noValidate>
                            <Campo rotulo="Quilometragem correta" sufixo="km" erro={erros.km} className="campo-curto">
                                <input className="entrada-km" inputMode="numeric" autoComplete="off" value={kmCorreta}
                                    onChange={(e) => setKmCorreta(e.target.value.replace(/\D/g, ""))} />
                            </Campo>
                            <Campo rotulo="Justificativa" erro={erros.justificativa}
                                ajuda={erros.justificativa ? undefined : "Fica no cadastro do KMChain, junto do evento de correção."}>
                                <textarea rows={3} maxLength={1000} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} />
                            </Campo>
                            <Campo rotulo="Data e hora da correção" className="campo-curto">
                                <input type="datetime-local" value={dataEvento} max={agoraLocal()} onChange={(e) => setDataEvento(e.target.value)} />
                            </Campo>
                            <SeletorMunicipio valor={municipio} erro={erros.municipio} rotuloCidade="Cidade da correção"
                                ajuda="Onde a correção é feita. O local do registro original não muda." aoEscolher={setMunicipio} />
                            <CampoArquivo rotulo="Documento que fundamenta" arquivo={arquivo} aoEscolher={setArquivo}
                                ajuda="Laudo ou documento que comprova o valor correto. PDF ou imagem." />
                            <div className="acoes acoes-fim">
                                <Botao type="submit">Revisar correção</Botao>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {selecionado && (etapa === "revisao" || etapa === "enviando") && (
                <div className="painel">
                    <h2 className="painel-titulo">Confira a correção</h2>
                    <p className="painel-texto"><span className="mono">{chassiCarregado}</span></p>

                    <div className="comparacao">
                        <div>
                            <p className="comparacao-rotulo">Registro original</p>
                            <p className="comparacao-valor comparacao-anterior">{km(selecionado.km)}</p>
                            <p className="comparacao-meta">{selecionado.rotulo} · {dataHora(selecionado.dataEvento)}</p>
                        </div>
                        <Icone nome="direita" className="comparacao-seta" />
                        <div>
                            <p className="comparacao-rotulo">Quilometragem correta</p>
                            <p className="comparacao-valor">{km(kmCorreta)}</p>
                            <p className="comparacao-meta">{dataHora(new Date(dataEvento))} · {local}</p>
                        </div>
                    </div>

                    <Aviso tipo="info">
                        O registro original permanece no histórico, sem nenhuma alteração. A correção entra como um
                        novo evento que aponta para ele e não pode ser desfeita.
                    </Aviso>
                    {falha && <Aviso tipo="erro">{falha}</Aviso>}

                    {etapa === "enviando" ? (
                        <Progresso passo={passo} comDocumento={Boolean(arquivo)} />
                    ) : (
                        <div className="acoes acoes-fim">
                            <Botao variante="secundario" onClick={() => setEtapa("selecao")}>Voltar e editar</Botao>
                            <Botao onClick={corrigir}>Confirmar e assinar</Botao>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
