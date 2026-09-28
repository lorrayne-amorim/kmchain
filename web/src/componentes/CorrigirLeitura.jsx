import { useState } from "react";
import { contratoLeitura, contratoEscrita } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { HASH_VAZIO, TIPOS, dataDe, dataNumerica, km, normalizarChassi, validarChassi } from "../lib/formato";
import { registrarPrivado } from "../lib/privado";
import { avisar } from "../lib/toast";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Icone from "../ui/Icone";
import { Concluido, Progresso } from "../ui/Transacao";
import PrivadoPendente from "./PrivadoPendente";

// Exclusivo do DETRAN. Nao apaga nada: marca a leitura equivocada como
// contestada e anexa uma correcao com o documento que a justifica.
export default function CorrigirLeitura({ aoVerHistorico }) {
    const [chassi, setChassi] = useState("");
    const [chassiCarregado, setChassiCarregado] = useState("");
    const [erroChassi, setErroChassi] = useState("");
    const [carregando, setCarregando] = useState(false);
    const [historico, setHistorico] = useState(null);

    const [indice, setIndice] = useState(null);
    const [kmCorreta, setKmCorreta] = useState("");
    const [erroKm, setErroKm] = useState("");
    const [arquivo, setArquivo] = useState(null);

    const [etapa, setEtapa] = useState("selecao"); // selecao | revisao | enviando | concluido
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [recibo, setRecibo] = useState(null);
    const [privado, setPrivado] = useState(null); // { dados, falha } se o registro privado falhou

    async function carregar(alvo) {
        setErroChassi("");
        setFalha("");
        const problema = validarChassi(alvo);
        if (problema) return setErroChassi(problema);

        setCarregando(true);
        try {
            const h = await contratoLeitura().getHistorico(alvo);
            if (h.length === 0) {
                setHistorico(null);
                return setErroChassi("Não encontramos um veículo com esse chassi.");
            }
            setHistorico(h.map((l, i) => ({
                indice: i,
                quilometragem: Number(l.quilometragem),
                data: dataDe(l.data),
                tipo: Number(l.tipo),
                contestada: l.contestada
            })));
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
        setArquivo(null);
        setErroKm("");
        setEtapa("selecao");
        setRecibo(null);
        setPrivado(null);
    }

    function revisar(e) {
        e.preventDefault();
        if (kmCorreta === "") return setErroKm("Informe a quilometragem correta.");
        setEtapa("revisao");
    }

    async function corrigir() {
        setFalha("");
        setEtapa("enviando");
        try {
            let hash = HASH_VAZIO;
            if (arquivo) {
                setPasso("documento");
                hash = await enviarDocumento(arquivo, chassiCarregado);
            }

            setPasso("assinatura");
            const contrato = await contratoEscrita();
            const tx = await contrato.corrigirLeitura(chassiCarregado, BigInt(indice), BigInt(kmCorreta), hash);

            setPasso("confirmacao");
            const r = await tx.wait();

            // Quem, de fato, fez a correcao fica no registro privado.
            const dadosPrivados = { chassi: chassiCarregado, txHash: tx.hash };
            try {
                await registrarPrivado(dadosPrivados);
                setPrivado(null);
            } catch (erroPrivado) {
                setPrivado({ dados: dadosPrivados, falha: mensagemDeErro(erroPrivado, "") });
            }

            setRecibo({ hash: tx.hash, gas: r.gasUsed.toString() });
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

    const selecionada = historico?.find((l) => l.indice === indice);

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
                            <Botao variante="fantasma" onClick={recomecar}>Corrigir outra leitura</Botao>
                        </>
                    }
                >
                    <p>A leitura original continua visível, marcada como corrigida.</p>
                    {privado && (
                        <PrivadoPendente dados={privado.dados} falhaInicial={privado.falha} oQue="O responsável pela correção" />
                    )}
                </Concluido>
            )}

            {historico && etapa === "selecao" && (
                <div className="painel">
                    <h2 className="painel-titulo">Selecione a leitura a corrigir</h2>
                    <p className="painel-texto">Leituras já corrigidas não podem ser selecionadas novamente.</p>

                        <fieldset className="lista-selecao">
                            <legend className="visualmente-oculto">Leituras do veículo</legend>
                            {[...historico].reverse().map((l) => (
                                <label key={l.indice} className={`selecao-item ${l.contestada ? "selecao-desativada" : ""}`}>
                                    <input type="radio" name="leitura" disabled={l.contestada}
                                        checked={indice === l.indice}
                                        onChange={() => {
                                            setIndice(l.indice);
                                            setErroKm("");
                                        }} />
                                    <span className="selecao-km">{km(l.quilometragem)}</span>
                                    <span className="selecao-meta">{TIPOS[l.tipo]} · {dataNumerica(l.data)}</span>
                                    <span className="selecao-meta selecao-estado">
                                        {l.contestada ? "Já corrigida" : `Registro ${l.indice + 1}`}
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                    {selecionada && (
                        <form className="grupo" onSubmit={revisar} noValidate>
                            <Campo rotulo="Quilometragem correta" sufixo="km" erro={erroKm} className="campo-curto">
                                <input className="entrada-km" inputMode="numeric" autoComplete="off" value={kmCorreta}
                                    onChange={(e) => {
                                        setKmCorreta(e.target.value.replace(/\D/g, ""));
                                        setErroKm("");
                                    }} />
                            </Campo>
                            <CampoArquivo rotulo="Justificativa" arquivo={arquivo} aoEscolher={setArquivo}
                                ajuda="Documento que comprova o valor correto. PDF ou imagem." />
                            <div className="acoes acoes-fim">
                                <Botao type="submit">Revisar correção</Botao>
                            </div>
                        </form>
                    )}
                </div>
            )}

            {selecionada && (etapa === "revisao" || etapa === "enviando") && (
                <div className="painel">
                    <h2 className="painel-titulo">Confira a correção</h2>
                    <p className="painel-texto"><span className="mono">{chassiCarregado}</span></p>

                    <div className="comparacao">
                        <div>
                            <p className="comparacao-rotulo">Leitura original</p>
                            <p className="comparacao-valor comparacao-anterior">{km(selecionada.quilometragem)}</p>
                            <p className="comparacao-meta">{TIPOS[selecionada.tipo]} · {dataNumerica(selecionada.data)}</p>
                        </div>
                        <Icone nome="direita" className="comparacao-seta" />
                        <div>
                            <p className="comparacao-rotulo">Quilometragem correta</p>
                            <p className="comparacao-valor">{km(kmCorreta)}</p>
                            <p className="comparacao-meta">{arquivo ? `Justificativa: ${arquivo.name}` : "Sem justificativa anexada"}</p>
                        </div>
                    </div>

                    <Aviso tipo="info">
                        A leitura original permanece no histórico, marcada como corrigida. A correção é
                        adicionada como um novo registro e não pode ser desfeita.
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
