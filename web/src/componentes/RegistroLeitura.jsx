import { useId, useRef, useState } from "react";
import { contratoLeitura, contratoEscrita } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import { HASH_VAZIO, TIPO, TIPOS, agoraLocal, dataDe, dataHora, dataNumerica, formatarCpf, km, localParaIso, normalizarChassi, numero, validarChassi } from "../lib/formato";
import { registrarPrivado } from "../lib/privado";
import { cpfValido } from "../lib/validar";
import { problemaDaObservacao } from "../lib/veiculo";
import { avisar } from "../lib/toast";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Dialogo from "../ui/Dialogo";
import Icone from "../ui/Icone";
import { Concluido, Progresso } from "../ui/Transacao";
import PrivadoPendente from "./PrivadoPendente";

// Tipos que uma entidade credenciada registra (Cadastro e Correcao tem
// telas proprias, exclusivas do DETRAN).
const EVENTOS = [1, 2, 3, 4];

// Veiculo -> evento -> revisao -> assinatura. A revisao mostra a ultima
// leitura gravada e o avanco, antes de qualquer assinatura.
export default function RegistroLeitura({ usuario, aoVerHistorico }) {
    const [chassi, setChassi] = useState("");
    const [veiculo, setVeiculo] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [kmNova, setKmNova] = useState("");
    const [observadaEm, setObservadaEm] = useState(agoraLocal);
    const [tipo, setTipo] = useState(1);
    const [arquivo, setArquivo] = useState(null);
    const [nomeNovoProprietario, setNomeNovoProprietario] = useState("");
    const [cpfNovoProprietario, setCpfNovoProprietario] = useState("");
    const [erros, setErros] = useState({});

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando | concluido
    const [passo, setPasso] = useState(null);
    const [enviaDocumento, setEnviaDocumento] = useState(false);
    const [atipica, setAtipica] = useState(null);
    const [hashDoc, setHashDoc] = useState(null);
    const [falha, setFalha] = useState("");
    const [concluido, setConcluido] = useState(null);
    const buscaAtual = useRef("");
    const idTipo = useId();

    const transferencia = tipo === TIPO.TRANSFERENCIA;
    const avanco = veiculo && kmNova !== "" ? Number(kmNova) - veiculo.ultima : null;
    const regressiva = avanco !== null && avanco < 0;

    async function buscarVeiculo(alvo) {
        buscaAtual.current = alvo;
        setVeiculo(null);
        setBuscando(true);
        try {
            const v = await contratoLeitura().getVeiculo(alvo);
            if (buscaAtual.current !== alvo) return null;
            if (!v.cadastrado) {
                setErros((e) => ({ ...e, chassi: "Não encontramos um veículo com esse chassi." }));
                return null;
            }
            const dados = { chassi: alvo, modelo: v.modelo, ano: Number(v.ano), ultima: Number(v.ultimaKm), data: dataDe(v.ultimaData) };
            setVeiculo(dados);
            return dados;
        } catch (e) {
            if (buscaAtual.current === alvo) {
                setErros((er) => ({ ...er, chassi: mensagemDeErro(e, "Não foi possível buscar o veículo. Tente novamente.") }));
            }
            return null;
        } finally {
            if (buscaAtual.current === alvo) setBuscando(false);
        }
    }

    function alterarChassi(valor) {
        const alvo = normalizarChassi(valor);
        setChassi(alvo);
        setErros((e) => ({ ...e, chassi: undefined }));
        if (alvo.length === 17) {
            buscarVeiculo(alvo);
        } else {
            buscaAtual.current = "";
            setVeiculo(null);
            setBuscando(false);
        }
    }

    function escolherArquivo(novo) {
        setArquivo(novo);
        setHashDoc(null); // o novo arquivo precisa ser enviado de novo
    }

    async function revisar(e) {
        e.preventDefault();
        setFalha("");

        const novos = {};
        const problemaChassi = validarChassi(chassi);
        if (problemaChassi) novos.chassi = problemaChassi;
        if (kmNova === "") novos.km = "Informe a quilometragem.";
        const problemaObs = problemaDaObservacao(localParaIso(observadaEm));
        if (problemaObs) novos.observadaEm = problemaObs;
        if (transferencia) {
            if (!nomeNovoProprietario.trim()) novos.nome = "Informe o nome do novo proprietário.";
            if (!cpfValido(cpfNovoProprietario)) novos.cpf = "Informe um CPF válido, com 11 dígitos.";
        }
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        const v = veiculo?.chassi === chassi ? veiculo : await buscarVeiculo(chassi);
        if (!v) return;
        setEtapa("revisao");
        window.scrollTo(0, 0);
    }

    function voltar() {
        setEtapa("formulario");
        setAtipica(null);
        setFalha("");
    }

    async function enviar(confirmarAtipica) {
        setAtipica(null);
        setFalha("");
        setEnviaDocumento(Boolean(arquivo && !hashDoc));
        setEtapa("enviando");
        try {
            let hash = hashDoc ?? HASH_VAZIO;
            if (arquivo && !hashDoc) {
                setPasso("documento");
                hash = await enviarDocumento(arquivo, chassi);
                setHashDoc(hash); // evita reenviar o arquivo na segunda tentativa
            }

            setPasso("assinatura");
            const contrato = await contratoEscrita();
            const tx = await contrato.registrarLeitura(chassi, BigInt(kmNova), tipo, hash, confirmarAtipica);

            setPasso("confirmacao");
            const recibo = await tx.wait();

            // Registro privado: quem de fato assinou (nome, nao so carteira) e,
            // numa transferencia, os dados do novo proprietario - nunca em cadeia.
            // O servidor confere a transacao; tipo e km vem dela, nao daqui.
            const dadosPrivados = {
                chassi, txHash: tx.hash, observadaEm: localParaIso(observadaEm),
                ...(transferencia && {
                    nomeProprietario: nomeNovoProprietario,
                    cpfProprietario: cpfNovoProprietario
                })
            };
            let privadoFalhou = null;
            try {
                await registrarPrivado(dadosPrivados);
            } catch (erroPrivado) {
                privadoFalhou = mensagemDeErro(erroPrivado, "");
            }

            setConcluido({
                recibo: { hash: tx.hash, gas: recibo.gasUsed.toString() },
                atipica: confirmarAtipica,
                privadoFalhou,
                dadosPrivados,
                chassi,
                modelo: veiculo?.modelo,
                km: Number(kmNova),
                tipo
            });
            setEtapa("concluido");
            avisar("Leitura registrada no histórico.");
        } catch (e) {
            // SEGUNDA CONFIRMACAO - so aparece quando o proprio contrato recusa o
            // avanco por estar acima do limite. Os numeros vem do erro do contrato,
            // nao de uma conta feita aqui.
            if (e.revert?.name === "LeituraAtipica") {
                const [avancoContrato, limite, dias] = e.revert.args;
                setAtipica({ avanco: Number(avancoContrato), limite: Number(limite), dias: Number(dias) });
                setEtapa("revisao");
                return;
            }
            setFalha(mensagemDeErro(e, "Não foi possível concluir o registro. Tente novamente."));
            setEtapa("revisao");
        } finally {
            setPasso(null);
        }
    }

    function novoRegistro() {
        setChassi("");
        setVeiculo(null);
        setKmNova("");
        setObservadaEm(agoraLocal());
        setTipo(1);
        setArquivo(null);
        setHashDoc(null);
        setNomeNovoProprietario("");
        setCpfNovoProprietario("");
        setErros({});
        setConcluido(null);
        setEtapa("formulario");
    }

    if (etapa === "concluido") {
        return (
            <Concluido
                titulo="Leitura registrada no histórico"
                recibo={concluido.recibo}
                acoes={
                    <>
                        <Botao icone="mais" onClick={novoRegistro}>Novo registro</Botao>
                        <Botao variante="secundario" onClick={() => aoVerHistorico(concluido.chassi)}>Ver histórico do veículo</Botao>
                    </>
                }
            >
                <p className="concluido-destaque">{km(concluido.km)} · {TIPOS[concluido.tipo]}</p>
                <p>{concluido.modelo} · <span className="mono">{concluido.chassi}</span></p>
                {concluido.atipica && <p>A leitura ficou marcada como atípica no histórico público.</p>}
                {concluido.privadoFalhou !== null && (
                    <PrivadoPendente
                        dados={concluido.dadosPrivados}
                        falhaInicial={concluido.privadoFalhou}
                        oQue={transferencia ? "O responsável pelo registro e os dados do novo proprietário" : "O responsável pelo registro"}
                    />
                )}
            </Concluido>
        );
    }

    if (etapa === "revisao" || etapa === "enviando") {
        const enviando = etapa === "enviando";
        return (
            <div className="painel">
                <h2 className="painel-titulo">Confira o registro</h2>
                <p className="painel-texto">Verifique os dados antes de assinar.</p>

                <div className="comparacao">
                    <div>
                        <p className="comparacao-rotulo">Última registrada</p>
                        <p className="comparacao-valor comparacao-anterior">{km(veiculo.ultima)}</p>
                        <p className="comparacao-meta">{dataNumerica(veiculo.data)}</p>
                    </div>
                    <Icone nome="direita" className="comparacao-seta" />
                    <div>
                        <p className="comparacao-rotulo">Nova leitura</p>
                        <p className="comparacao-valor">{km(kmNova)}</p>
                        <p className={`comparacao-meta ${regressiva ? "texto-perigo" : ""}`}>
                            {regressiva ? `${numero(avanco)} km em relação à anterior` : `+${numero(avanco)} km`}
                        </p>
                    </div>
                </div>

                <dl className="lista-dados">
                    <div><dt>Veículo</dt><dd>{veiculo.modelo} · {veiculo.ano}</dd></div>
                    <div><dt>Chassi</dt><dd className="mono">{chassi}</dd></div>
                    <div><dt>Evento</dt><dd>{TIPOS[tipo]}</dd></div>
                    <div><dt>Observada em</dt><dd>{dataHora(new Date(observadaEm))}</dd></div>
                    {transferencia && (
                        <>
                            <div><dt>Novo proprietário</dt><dd>{nomeNovoProprietario}</dd></div>
                            <div><dt>CPF</dt><dd>{formatarCpf(cpfNovoProprietario)}</dd></div>
                        </>
                    )}
                    <div><dt>Comprovante</dt><dd>{arquivo ? arquivo.name : "Nenhum anexado"}</dd></div>
                    <div><dt>Registrado por</dt><dd>{usuario?.nome}</dd></div>
                </dl>

                {regressiva && (
                    <Aviso tipo="erro" titulo="Quilometragem menor que a última registrada">
                        O registro será recusado. Volte e corrija o valor informado.
                    </Aviso>
                )}
                {!regressiva && (
                    <Aviso tipo="info">
                        Depois de confirmado, o registro não pode ser alterado nem apagado. Apenas o DETRAN
                        pode anexar uma correção, e a leitura original continuará visível.
                    </Aviso>
                )}
                {falha && <Aviso tipo="erro">{falha}</Aviso>}

                {enviando ? (
                    <Progresso passo={passo} comDocumento={enviaDocumento} />
                ) : (
                    <div className="acoes acoes-fim">
                        <Botao variante="secundario" onClick={voltar}>Voltar e editar</Botao>
                        <Botao disabled={regressiva} onClick={() => enviar(false)}>Confirmar e assinar</Botao>
                    </div>
                )}

                <Dialogo
                    aberto={Boolean(atipica)}
                    aoFechar={() => setAtipica(null)}
                    titulo="Avanço acima do esperado"
                    acoes={
                        <>
                            <Botao variante="secundario" onClick={voltar}>Cancelar e revisar</Botao>
                            <Botao onClick={() => enviar(true)}>Está correta, registrar</Botao>
                        </>
                    }
                >
                    {atipica && (
                        <>
                            <p>
                                Esta leitura representa <strong>{km(atipica.avanco)}</strong> a mais que a anterior
                                em {atipica.dias} {atipica.dias === 1 ? "dia" : "dias"}, acima do limite
                                de {km(atipica.limite)} para este veículo no período.
                            </p>
                            <p>
                                Confirme apenas se a quilometragem estiver correta. Ela será registrada de forma
                                definitiva e ficará marcada como atípica no histórico público.
                            </p>
                        </>
                    )}
                </Dialogo>
            </div>
        );
    }

    return (
        <form className="painel formulario" onSubmit={revisar} noValidate>
            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">1</span>Veículo</legend>
                <Campo
                    rotulo="Chassi"
                    erro={erros.chassi}
                    ajuda={!erros.chassi && !veiculo && !buscando ? "17 caracteres. O veículo é localizado automaticamente." : undefined}
                >
                    <input className="mono" value={chassi} maxLength={17} placeholder="Digite o chassi"
                        autoComplete="off" autoCapitalize="characters" spellCheck={false}
                        onChange={(e) => alterarChassi(e.target.value)} />
                </Campo>
                {buscando && (
                    <p className="carregando-linha" role="status">
                        <Icone nome="carregando" className="girando" tamanho={16} />Buscando veículo…
                    </p>
                )}
                {veiculo && (
                    <div className="veiculo-encontrado">
                        <div>
                            <p className="veiculo-nome">{veiculo.modelo}</p>
                            <p className="veiculo-meta">{veiculo.ano}</p>
                        </div>
                        <div className="veiculo-ultimo">
                            <p className="veiculo-meta">Último registro</p>
                            <p className="veiculo-km">{km(veiculo.ultima)}</p>
                            <p className="veiculo-meta">{dataNumerica(veiculo.data)}</p>
                        </div>
                    </div>
                )}
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">2</span>Evento</legend>

                <div className="campo">
                    <span className="campo-rotulo" id={idTipo}>Tipo do evento</span>
                    <div className="opcoes" role="radiogroup" aria-labelledby={idTipo}>
                        {EVENTOS.map((i) => (
                            <label key={i} className="opcao">
                                <input type="radio" name="tipo" checked={tipo === i} onChange={() => setTipo(i)} />
                                <span>{TIPOS[i]}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <Campo
                    rotulo="Quilometragem"
                    sufixo="km"
                    erro={erros.km ?? (regressiva ? `Menor que a última registrada (${km(veiculo.ultima)}). O registro será recusado.` : undefined)}
                    ajuda={
                        avanco !== null && !regressiva
                            ? `${km(kmNova)} · +${numero(avanco)} km desde o último registro`
                            : "Valor do hodômetro, somente números."
                    }
                >
                    <input className="entrada-km" inputMode="numeric" autoComplete="off" value={kmNova}
                        onChange={(e) => setKmNova(e.target.value.replace(/\D/g, ""))} />
                </Campo>

                <Campo rotulo="Data e hora da observação" erro={erros.observadaEm} className="campo-curto"
                    ajuda={erros.observadaEm ? undefined : "Quando o hodômetro foi lido. Até 30 dias atrás. Fica nos registros privados."}>
                    <input type="datetime-local" value={observadaEm} max={agoraLocal()}
                        onChange={(e) => {
                            setObservadaEm(e.target.value);
                            setErros((er) => ({ ...er, observadaEm: undefined }));
                        }} />
                </Campo>

                {transferencia && (
                    <>
                        <div className="grade-2">
                            <Campo rotulo="Nome do novo proprietário" erro={erros.nome}>
                                <input value={nomeNovoProprietario} onChange={(e) => setNomeNovoProprietario(e.target.value)} />
                            </Campo>
                            <Campo rotulo="CPF do novo proprietário" erro={erros.cpf}>
                                <input inputMode="numeric" value={cpfNovoProprietario} placeholder="000.000.000-00"
                                    onChange={(e) => setCpfNovoProprietario(e.target.value)} />
                            </Campo>
                        </div>
                        <p className="nota-privacidade">
                            <Icone nome="info" tamanho={14} />
                            Nome e CPF ficam só nos registros privados do DETRAN e não aparecem na consulta pública.
                        </p>
                    </>
                )}

                <CampoArquivo
                    arquivo={arquivo}
                    aoEscolher={escolherArquivo}
                    ajuda="Laudo, nota de serviço ou outro documento da leitura. PDF ou imagem."
                />
            </fieldset>

            <div className="acoes acoes-fim">
                <Botao type="submit">Revisar registro</Botao>
            </div>
        </form>
    );
}
