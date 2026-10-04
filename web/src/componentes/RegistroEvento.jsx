import { useEffect, useId, useRef, useState } from "react";
import { contratoEscrita } from "../lib/blockchain";
import { chaveDoChassi } from "../lib/chassi";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { TIPO_EVENTO, TIPO_ORGANIZACAO, eventosRegistraveis, rotuloDoEvento } from "../lib/eventos";
import { focarPrimeiroErro } from "../lib/foco";
import { HASH_VAZIO, agoraLocal, dataHora, formatarCpf, km, localParaIso, localParaSegundos, normalizarChassi, numero, validarChassi } from "../lib/formato";
import { capturarLocalizacao, municipioDaPosicao } from "../lib/geocodificacao";
import { carregarHistorico } from "../lib/historico";
import { carregarIdentificacao } from "../lib/identificacao";
import {
    CAPTURA_RECENTE_MS, JUSTIFICATIVA_MAXIMA, MOTIVOS_DE_INDISPONIBILIDADE, ROTULOS_DA_LOCALIZACAO, SITUACAO_DA_LOCALIZACAO, exigeJustificativa, formatarDistancia
} from "../lib/localizacao";
import { listarOrganizacoes } from "../lib/organizacoes";
import { conferirEvento, registrarComplemento } from "../lib/registros";
import { avisar } from "../lib/toast";
import { useMunicipios } from "../lib/useMunicipios";
import { cpfValido } from "../lib/validar";
import { problemaDaDataDoEvento } from "../lib/veiculo";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Dialogo from "../ui/Dialogo";
import Icone from "../ui/Icone";
import SeletorMunicipio from "../ui/SeletorMunicipio";
import { Concluido, Progresso } from "../ui/Transacao";
import ComplementoPendente from "./ComplementoPendente";

// O que dizer a quem registra em cada situacao que pede justificativa.
const AVISOS_DE_LOCALIZACAO = {
    FORA_DA_AREA: {
        titulo: "A localização atual está distante do endereço cadastrado da organização",
        pedido: "Informe por que este evento está sendo registrado fora do estabelecimento."
    },
    BAIXA_PRECISAO: {
        titulo: "A localização foi obtida com precisão insuficiente para ser verificada",
        pedido: "Para continuar, informe o motivo. Ativar o Wi-Fi ou a localização precisa do dispositivo costuma resolver."
    },
    INDISPONIVEL: {
        titulo: "Não foi possível verificar sua localização",
        pedido: "Para continuar, informe o motivo."
    }
};

// Veiculo -> evento -> localizacao -> revisao -> assinatura. Os tipos
// oferecidos sao os da organizacao de quem registra; o servidor e o contrato
// conferem de novo. A localizacao do dispositivo e pedida uma vez, ao
// revisar, e fica so no banco do KMChain.
export default function RegistroEvento({ acesso, aoVerHistorico }) {
    const { usuario, organizacao, vinculo } = acesso;
    const tipos = eventosRegistraveis(vinculo.tipo);

    const [chassi, setChassi] = useState("");
    const [veiculo, setVeiculo] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [kmNova, setKmNova] = useState("");
    const [dataEvento, setDataEvento] = useState(agoraLocal);
    const [municipio, setMunicipio] = useState(organizacao?.municipio_ibge ? String(organizacao.municipio_ibge) : "");
    const [tipo, setTipo] = useState(tipos[0]?.codigo);
    const [arquivo, setArquivo] = useState(null);
    const [nomeNovoProprietario, setNomeNovoProprietario] = useState("");
    const [cpfNovoProprietario, setCpfNovoProprietario] = useState("");
    const [seguradoraId, setSeguradoraId] = useState("");
    const [seguradoras, setSeguradoras] = useState([]);
    const [erros, setErros] = useState({});
    const [localizacao, setLocalizacao] = useState(null);       // o que o navegador capturou
    const [verificacao, setVerificacao] = useState(null);       // { situacao, distancia } decididos pelo servidor
    const [municipioDetectado, setMunicipioDetectado] = useState(null);
    const [justificativaLocalizacao, setJustificativaLocalizacao] = useState("");

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando | concluido
    const [conferindo, setConferindo] = useState(false);
    const [passo, setPasso] = useState(null);
    const [enviaDocumento, setEnviaDocumento] = useState(false);
    const [atipica, setAtipica] = useState(null);
    const [hashDoc, setHashDoc] = useState(null);
    const [falha, setFalha] = useState("");
    const [concluido, setConcluido] = useState(null);
    const buscaAtual = useRef("");
    const idTipo = useId();
    const municipios = useMunicipios();

    const transferencia = tipo === TIPO_EVENTO.TRANSFERENCIA_PROPRIEDADE;
    const paraSeguradora = tipo === TIPO_EVENTO.VISTORIA_SEGURADORA;
    const avanco = veiculo && kmNova !== "" ? Number(kmNova) - veiculo.ultima : null;
    const regressiva = avanco !== null && avanco < 0;
    const local = municipios && municipio ? municipios.rotuloDoMunicipio(municipio) : "";
    const pedeJustificativa = Boolean(verificacao && exigeJustificativa(verificacao.situacao));

    // Seguradoras credenciadas, para a vistoria feita a pedido de uma delas.
    useEffect(() => {
        if (vinculo.tipo !== TIPO_ORGANIZACAO.VISTORIA) return;
        listarOrganizacoes()
            .then((lista) => setSeguradoras(lista.filter((o) => o.tipo === "SEGURADORA" && o.situacao === "ativa")))
            .catch(() => { });
    }, [vinculo.tipo]);

    async function buscarVeiculo(alvo) {
        buscaAtual.current = alvo;
        setVeiculo(null);
        setBuscando(true);
        try {
            const [historico, identificacao] = await Promise.all([
                carregarHistorico(alvo),
                carregarIdentificacao(alvo).catch(() => null)
            ]);
            if (buscaAtual.current !== alvo) return null;
            if (!historico) {
                setErros((e) => ({ ...e, chassi: "Não encontramos um veículo com esse chassi." }));
                return null;
            }
            const v = identificacao?.veiculo;
            const dados = {
                chassi: alvo,
                nome: v ? `${v.marca_nome} ${v.modelo}` : "Veículo sem identificação cadastrada",
                anos: v ? `${v.ano_fabricacao}/${v.ano_modelo}` : "",
                ultima: historico.ultimaKm,
                data: historico.ultimaData
            };
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

    // O que so alguns tipos de evento exigem, e que fica fora da blockchain.
    const complemento = () => ({
        ...(transferencia && { nomeProprietario: nomeNovoProprietario, cpfProprietario: cpfNovoProprietario }),
        ...(paraSeguradora && { seguradoraId })
    });

    async function revisar(e) {
        e.preventDefault();
        setFalha("");

        const novos = {};
        const problemaChassi = validarChassi(chassi);
        if (problemaChassi) novos.chassi = problemaChassi;
        if (kmNova === "") novos.km = "Informe a quilometragem.";
        const problemaData = problemaDaDataDoEvento(localParaIso(dataEvento));
        if (problemaData) novos.dataEvento = problemaData;
        if (!municipio) novos.municipio = "Escolha a UF e a cidade do evento.";
        if (transferencia) {
            if (!nomeNovoProprietario.trim()) novos.nomeProprietario = "Informe o nome do novo proprietário.";
            if (!cpfValido(cpfNovoProprietario)) novos.cpfProprietario = "Informe um CPF válido, com 11 dígitos.";
        }
        if (paraSeguradora && !seguradoraId) novos.seguradoraId = "Escolha a seguradora que solicitou a vistoria.";
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        const v = veiculo?.chassi === chassi ? veiculo : await buscarVeiculo(chassi);
        if (!v) return;

        // O servidor confere a permissao, os dados e a localizacao do
        // dispositivo antes de qualquer assinatura.
        setConferindo(true);
        try {
            const capturada = await capturarLocalizacao();
            setLocalizacao(capturada);
            setMunicipioDetectado(null);
            if (capturada.latitude !== undefined && municipios) {
                municipioDaPosicao(capturada, municipios).then(setMunicipioDetectado).catch(() => { });
            }
            const r = await conferirEvento({
                chassi, tipo, km: kmNova, dataEvento: localParaIso(dataEvento), municipio, ...complemento(),
                localizacao: capturada, justificativaLocalizacao
            });
            setVerificacao(r.localizacao);
            setEtapa("revisao");
            window.scrollTo(0, 0);
        } catch (erro) {
            if (erro.codigo === "justificativa_localizacao_obrigatoria") {
                // Na primeira vez so aparece o pedido; o erro do campo, se a
                // pessoa tentar de novo sem justificar.
                setErros(verificacao ? erro.dados.campos : {});
                setVerificacao(erro.dados.localizacao);
            } else if (erro.dados?.campos) {
                setErros(erro.dados.campos);
                focarPrimeiroErro();
            } else {
                setFalha(mensagemDeErro(erro, "Não foi possível conferir o registro. Tente novamente."));
            }
        } finally {
            setConferindo(false);
        }
    }

    function voltar() {
        setEtapa("formulario");
        setAtipica(null);
        setFalha("");
    }

    async function enviar(confirmarAtipica) {
        setAtipica(null);
        setFalha("");
        // O servidor recusa uma captura antiga; melhor refazer a revisao
        // agora do que gravar em cadeia um evento que ficaria sem complemento.
        if (localizacao?.capturadaEm && Date.now() - new Date(localizacao.capturadaEm).getTime() > CAPTURA_RECENTE_MS) {
            return setFalha("A localização foi verificada há muito tempo. Volte e revise o registro de novo antes de assinar.");
        }
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
            const tx = await contrato.registrarEvento(
                chaveDoChassi(chassi), BigInt(kmNova), tipo, localParaSegundos(dataEvento), Number(municipio), hash, confirmarAtipica
            );

            setPasso("confirmacao");
            const recibo = await tx.wait();

            // Complemento fora da blockchain: quem registrou (nome, nao so a
            // carteira) e os dados que o tipo de evento pede. O servidor le o
            // evento no contrato; tipo, km, data e local vem de la, nao daqui.
            const dadosComplementares = { chassi, txHash: tx.hash, ...complemento(), localizacao, justificativaLocalizacao };
            let complementoFalhou = null;
            try {
                await registrarComplemento(dadosComplementares);
            } catch (erroComplemento) {
                complementoFalhou = mensagemDeErro(erroComplemento, "");
            }

            setConcluido({
                recibo: { hash: tx.hash, gas: recibo.gasUsed.toString() },
                atipica: confirmarAtipica,
                complementoFalhou,
                dadosComplementares,
                chassi,
                nome: veiculo?.nome,
                km: Number(kmNova),
                tipo,
                local
            });
            setEtapa("concluido");
            avisar("Evento registrado no histórico.");
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
        setDataEvento(agoraLocal());
        setArquivo(null);
        setHashDoc(null);
        setNomeNovoProprietario("");
        setCpfNovoProprietario("");
        setSeguradoraId("");
        setLocalizacao(null);
        setVerificacao(null);
        setMunicipioDetectado(null);
        setJustificativaLocalizacao("");
        setErros({});
        setConcluido(null);
        setEtapa("formulario");
    }

    if (tipos.length === 0) {
        return <Aviso tipo="info">Sua organização não tem tipos de evento liberados para registro.</Aviso>;
    }

    if (etapa === "concluido") {
        return (
            <Concluido
                titulo="Evento registrado no histórico"
                recibo={concluido.recibo}
                acoes={
                    <>
                        <Botao icone="mais" onClick={novoRegistro}>Novo registro</Botao>
                        <Botao variante="secundario" onClick={() => aoVerHistorico(concluido.chassi)}>Ver histórico do veículo</Botao>
                    </>
                }
            >
                <p className="concluido-destaque">{km(concluido.km)} · {rotuloDoEvento(concluido.tipo)}</p>
                <p>{concluido.nome} · <span className="mono">{concluido.chassi}</span></p>
                <p>{concluido.local} · {organizacao?.nome_fantasia}</p>
                {concluido.atipica && <p>O evento ficou marcado como atípico no histórico público.</p>}
                {concluido.complementoFalhou !== null && (
                    <ComplementoPendente
                        enviar={() => registrarComplemento(concluido.dadosComplementares)}
                        falhaInicial={concluido.complementoFalhou}
                        oQue={transferencia ? "O responsável pelo registro e os dados do novo proprietário" : "Os dados de quem realizou o registro"}
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
                        <p className="comparacao-meta">{dataHora(veiculo.data)}</p>
                    </div>
                    <Icone nome="direita" className="comparacao-seta" />
                    <div>
                        <p className="comparacao-rotulo">Novo registro</p>
                        <p className="comparacao-valor">{km(kmNova)}</p>
                        <p className={`comparacao-meta ${regressiva ? "texto-perigo" : ""}`}>
                            {regressiva ? `${numero(avanco)} km em relação à anterior` : `+${numero(avanco)} km`}
                        </p>
                    </div>
                </div>

                <dl className="lista-dados">
                    <div><dt>Veículo</dt><dd>{veiculo.nome}{veiculo.anos && ` · ${veiculo.anos}`}</dd></div>
                    <div><dt>Chassi</dt><dd className="mono">{chassi}</dd></div>
                    <div><dt>Evento</dt><dd>{rotuloDoEvento(tipo)}</dd></div>
                    <div><dt>Data e hora do evento</dt><dd>{dataHora(new Date(dataEvento))}</dd></div>
                    <div><dt>Local do evento</dt><dd>{local}</dd></div>
                    <div>
                        <dt>Localização do dispositivo</dt>
                        <dd>
                            {ROTULOS_DA_LOCALIZACAO[verificacao?.situacao]}
                            {verificacao?.distancia !== null && verificacao?.distancia !== undefined && (
                                <span className="celula-secundaria">a {formatarDistancia(verificacao.distancia)} do endereço cadastrado</span>
                            )}
                            {pedeJustificativa && <span className="celula-secundaria">Justificativa: {justificativaLocalizacao}</span>}
                        </dd>
                    </div>
                    {transferencia && (
                        <>
                            <div><dt>Novo proprietário</dt><dd>{nomeNovoProprietario}</dd></div>
                            <div><dt>CPF</dt><dd>{formatarCpf(cpfNovoProprietario)}</dd></div>
                        </>
                    )}
                    {paraSeguradora && (
                        <div><dt>Seguradora contratante</dt><dd>{seguradoras.find((s) => String(s.id) === String(seguradoraId))?.nome_fantasia}</dd></div>
                    )}
                    <div><dt>Comprovante</dt><dd>{arquivo ? arquivo.name : "Nenhum anexado"}</dd></div>
                    <div><dt>Organização</dt><dd>{organizacao?.nome_fantasia}</dd></div>
                    <div><dt>Registrado por</dt><dd>{usuario?.nome}</dd></div>
                </dl>

                {regressiva && (
                    <Aviso tipo="erro" titulo="Quilometragem menor que a última registrada">
                        O registro será recusado. Volte e corrija o valor informado.
                    </Aviso>
                )}
                {!regressiva && (
                    <Aviso tipo="info" titulo="O que vai para a blockchain">
                        Quilometragem, tipo, data e hora do evento, município, o identificador da sua organização, a
                        carteira que assina e, se houver, o hash do comprovante. A localização do dispositivo e a
                        justificativa não vão para a blockchain. Depois de confirmado, o registro não
                        pode ser alterado nem apagado; um erro só é tratado por uma correção aprovada pelo DETRAN,
                        que entra como novo evento.
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
                                Este registro representa <strong>{km(atipica.avanco)}</strong> a mais que o anterior
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
                            <p className="veiculo-nome">{veiculo.nome}</p>
                            <p className="veiculo-meta">{veiculo.anos}</p>
                        </div>
                        <div className="veiculo-ultimo">
                            <p className="veiculo-meta">Último registro</p>
                            <p className="veiculo-km">{km(veiculo.ultima)}</p>
                            <p className="veiculo-meta">{dataHora(veiculo.data)}</p>
                        </div>
                    </div>
                )}
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">2</span>Evento</legend>

                <div className="campo">
                    <span className="campo-rotulo" id={idTipo}>Tipo do evento</span>
                    <div className="opcoes" role="radiogroup" aria-labelledby={idTipo}>
                        {tipos.map((t) => (
                            <label key={t.codigo} className="opcao">
                                <input type="radio" name="tipo" checked={tipo === t.codigo} onChange={() => setTipo(t.codigo)} />
                                <span>{t.rotulo}</span>
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

                <Campo rotulo="Data e hora do evento" erro={erros.dataEvento} className="campo-curto"
                    ajuda={erros.dataEvento ? undefined : "Quando o evento ocorreu, não o momento deste registro. Até 30 dias atrás."}>
                    <input type="datetime-local" value={dataEvento} max={agoraLocal()}
                        onChange={(e) => {
                            setDataEvento(e.target.value);
                            setErros((er) => ({ ...er, dataEvento: undefined }));
                        }} />
                </Campo>

                <SeletorMunicipio
                    valor={municipio}
                    erro={erros.municipio}
                    rotuloCidade="Cidade do evento"
                    ajuda="Onde o evento ocorreu. Normalmente é a cidade da sua organização."
                    aoEscolher={(codigo) => {
                        setMunicipio(codigo);
                        setErros((er) => ({ ...er, municipio: undefined }));
                    }}
                />

                {paraSeguradora && (
                    <Campo rotulo="Seguradora que solicitou a vistoria" erro={erros.seguradoraId}
                        ajuda={erros.seguradoraId ? undefined : "A relação com a seguradora fica no cadastro do KMChain, não na blockchain."}>
                        <select value={seguradoraId} onChange={(e) => setSeguradoraId(e.target.value)}>
                            <option value="">Selecione</option>
                            {seguradoras.map((s) => <option key={s.id} value={s.id}>{s.nome_fantasia}</option>)}
                        </select>
                    </Campo>
                )}

                {transferencia && (
                    <>
                        <div className="grade-2">
                            <Campo rotulo="Nome do novo proprietário" erro={erros.nomeProprietario}>
                                <input value={nomeNovoProprietario} onChange={(e) => setNomeNovoProprietario(e.target.value)} />
                            </Campo>
                            <Campo rotulo="CPF do novo proprietário" erro={erros.cpfProprietario}>
                                <input inputMode="numeric" value={cpfNovoProprietario} placeholder="000.000.000-00"
                                    onChange={(e) => setCpfNovoProprietario(e.target.value)} />
                            </Campo>
                        </div>
                        <p className="nota-privacidade">
                            <Icone nome="info" tamanho={14} />
                            Nome e CPF ficam só no cadastro do KMChain, com acesso restrito ao DETRAN. Não vão para a blockchain nem aparecem na consulta pública.
                        </p>
                    </>
                )}

                <CampoArquivo
                    arquivo={arquivo}
                    aoEscolher={escolherArquivo}
                    ajuda="Laudo, nota de serviço ou outro documento do evento. PDF ou imagem."
                />
            </fieldset>

            {municipioDetectado && String(municipioDetectado.codigo) !== String(municipio) && (
                <Aviso tipo="info" acao={<Botao variante="secundario" tamanho="p" onClick={() => setMunicipio(String(municipioDetectado.codigo))}>Usar {municipioDetectado.nome}</Botao>}>
                    A localização do dispositivo indica {municipioDetectado.nome} - {municipioDetectado.uf}, diferente da cidade
                    escolhida para o evento. Confira a cidade em que o evento ocorreu.
                </Aviso>
            )}

            {pedeJustificativa && (
                <fieldset className="grupo">
                    <legend className="grupo-titulo"><span className="grupo-numero">3</span>Localização</legend>
                    <Aviso tipo="alerta" titulo={AVISOS_DE_LOCALIZACAO[verificacao.situacao].titulo}>
                        <dl className="lista-dados lista-dados-compacta">
                            <div><dt>Organização</dt><dd>{organizacao?.nome_fantasia}</dd></div>
                            <div><dt>Município cadastrado</dt><dd>{municipios && organizacao?.municipio_ibge ? municipios.rotuloDoMunicipio(organizacao.municipio_ibge) : "—"}</dd></div>
                            {verificacao.situacao === SITUACAO_DA_LOCALIZACAO.INDISPONIVEL ? (
                                <div><dt>Motivo</dt><dd>{MOTIVOS_DE_INDISPONIBILIDADE[localizacao?.motivo] ?? MOTIVOS_DE_INDISPONIBILIDADE.erro}</dd></div>
                            ) : (
                                <>
                                    <div><dt>Local detectado</dt><dd>{municipioDetectado ? `${municipioDetectado.nome} - ${municipioDetectado.uf}` : "não identificado"}</dd></div>
                                    <div><dt>Distância aproximada</dt><dd>{formatarDistancia(verificacao.distancia)}</dd></div>
                                    <div><dt>Precisão informada</dt><dd>{formatarDistancia(localizacao?.precisao)}</dd></div>
                                </>
                            )}
                        </dl>
                    </Aviso>
                    <Campo rotulo="Justificativa" erro={erros.justificativaLocalizacao}
                        ajuda={erros.justificativaLocalizacao ? undefined : `${AVISOS_DE_LOCALIZACAO[verificacao.situacao].pedido} Fica no cadastro do KMChain, visível ao DETRAN; não vai para a blockchain.`}>
                        <textarea rows={3} maxLength={JUSTIFICATIVA_MAXIMA} value={justificativaLocalizacao}
                            onChange={(e) => {
                                setJustificativaLocalizacao(e.target.value);
                                setErros((er) => ({ ...er, justificativaLocalizacao: undefined }));
                            }} />
                    </Campo>
                </fieldset>
            )}

            {falha && <Aviso tipo="erro">{falha}</Aviso>}

            <p className="nota-privacidade">
                <Icone nome="info" tamanho={14} />
                Ao revisar, o navegador pede a localização do dispositivo, uma única vez, para comparar com o endereço da organização. Ela fica só no cadastro do KMChain, com acesso restrito ao DETRAN.
            </p>
            <div className="acoes acoes-fim">
                <Botao type="submit" carregando={conferindo}>
                    {conferindo ? "Verificando localização…" : "Revisar registro"}
                </Botao>
            </div>
        </form>
    );
}
