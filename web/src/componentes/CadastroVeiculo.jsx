import { useEffect, useState } from "react";
import { contratoLeitura, contratoEscrita } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import { HASH_VAZIO, agoraLocal, dataHora, encurtar, formatarCpf, km, localParaIso, normalizarChassi, validarChassi } from "../lib/formato";
import { LISTA_INICIAL, carregarMarcas } from "../lib/marcas";
import { registrarPrivado, validarCadastro } from "../lib/privado";
import { avisar } from "../lib/toast";
import { UFS, problemasDoCadastro } from "../lib/veiculo";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Icone from "../ui/Icone";
import SeletorMarca from "../ui/SeletorMarca";
import { Concluido, Progresso } from "../ui/Transacao";
import PrivadoPendente from "./PrivadoPendente";

const VAZIO = {
    chassi: "", placa: "", marca: null, modelo: "", anoFabricacao: "", anoModelo: "", uf: "",
    kmInicial: "", observadaEm: "", nomeProprietario: "", cpfProprietario: ""
};

// Exclusivo do DETRAN. Cria o veiculo em cadeia com sua primeira leitura e
// guarda no banco privado a identificacao completa e as informacoes datadas
// (placa, UF de registro e proprietario na data do cadastro).
export default function CadastroVeiculo({ usuario, conta, aoVerHistorico }) {
    const [dados, setDados] = useState(() => ({ ...VAZIO, observadaEm: agoraLocal() }));
    const [marcas, setMarcas] = useState(LISTA_INICIAL);
    const [arquivo, setArquivo] = useState(null);
    const [erros, setErros] = useState({});

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando | concluido
    const [verificando, setVerificando] = useState(false);
    const [emCadeia, setEmCadeia] = useState(null); // { modelo, ano } conferidos pelo servidor
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [concluido, setConcluido] = useState(null);

    // Marcas propostas (pendentes ou aprovadas) chegam do servidor; ate la,
    // vale a lista-base.
    useEffect(() => {
        carregarMarcas().then(setMarcas).catch(() => { });
    }, []);

    const alterar = (campo, valor) => {
        setDados((d) => ({ ...d, [campo]: valor }));
        setErros((e) => ({ ...e, [campo]: undefined }));
    };

    // O que vai para o servidor (validacao previa e registro privado).
    const payload = () => ({
        chassi: dados.chassi,
        placa: dados.placa,
        marcaId: dados.marca?.id,
        modelo: dados.modelo,
        anoFabricacao: dados.anoFabricacao,
        anoModelo: dados.anoModelo,
        uf: dados.uf,
        kmInicial: dados.kmInicial,
        observadaEm: localParaIso(dados.observadaEm),
        nomeProprietario: dados.nomeProprietario,
        cpfProprietario: dados.cpfProprietario
    });

    async function revisar(e) {
        e.preventDefault();
        setFalha("");

        const novos = problemasDoCadastro({ ...dados, observadaEm: localParaIso(dados.observadaEm) });
        const problemaChassi = validarChassi(dados.chassi);
        if (problemaChassi) novos.chassi = problemaChassi;
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        setVerificando(true);
        try {
            const veiculo = await contratoLeitura().getVeiculo(dados.chassi);
            if (veiculo.cadastrado) return setErros({ chassi: "Este chassi já está cadastrado." });
            // O servidor confere tudo antes da assinatura e diz o que vai em cadeia.
            const r = await validarCadastro(payload());
            setEmCadeia(r.emCadeia);
            setEtapa("revisao");
            window.scrollTo(0, 0);
        } catch (erro) {
            if (erro.dados?.campos) {
                setErros(erro.dados.campos);
                focarPrimeiroErro();
            } else {
                setFalha(mensagemDeErro(erro, "Não foi possível verificar o cadastro. Tente novamente."));
            }
        } finally {
            setVerificando(false);
        }
    }

    async function enviar() {
        setFalha("");
        setEtapa("enviando");
        try {
            let hash = HASH_VAZIO;
            if (arquivo) {
                setPasso("documento");
                hash = await enviarDocumento(arquivo, dados.chassi);
            }

            setPasso("assinatura");
            const contrato = await contratoEscrita();
            const tx = await contrato.cadastrarVeiculo(dados.chassi, emCadeia.modelo, emCadeia.ano, BigInt(dados.kmInicial), hash);

            setPasso("confirmacao");
            const recibo = await tx.wait();

            // Identificacao completa, placa, UF e proprietario: so no banco
            // privado. O servidor confere a transacao antes de gravar.
            const dadosPrivados = { txHash: tx.hash, ...payload() };
            let privadoFalhou = null;
            try {
                await registrarPrivado(dadosPrivados);
            } catch (erroPrivado) {
                privadoFalhou = mensagemDeErro(erroPrivado, "");
            }

            setConcluido({ recibo: { hash: tx.hash, gas: recibo.gasUsed.toString() }, privadoFalhou, dadosPrivados, ...dados });
            setEtapa("concluido");
            avisar("Veículo cadastrado.");
        } catch (erro) {
            setFalha(mensagemDeErro(erro, "Não foi possível concluir o cadastro. Tente novamente."));
            setEtapa("revisao");
        } finally {
            setPasso(null);
        }
    }

    function novoCadastro() {
        setDados({ ...VAZIO, observadaEm: agoraLocal() });
        setArquivo(null);
        setErros({});
        setConcluido(null);
        setEmCadeia(null);
        setEtapa("formulario");
    }

    const nomeUf = (sigla) => UFS.find(([s]) => s === sigla)?.[1] ?? sigla;
    const entidade = (
        <>
            {usuario?.nome}
            <span className="celula-secundaria"><span className="mono">{conta ? encurtar(conta) : "—"}</span> · DETRAN</span>
        </>
    );

    if (etapa === "concluido") {
        return (
            <Concluido
                titulo="Veículo cadastrado"
                recibo={concluido.recibo}
                acoes={
                    <>
                        <Botao icone="mais" onClick={novoCadastro}>Cadastrar outro veículo</Botao>
                        <Botao variante="secundario" onClick={() => aoVerHistorico(concluido.chassi)}>Ver histórico do veículo</Botao>
                    </>
                }
            >
                <p className="concluido-destaque">{concluido.marca?.nome} {concluido.modelo} · {concluido.anoFabricacao}/{concluido.anoModelo}</p>
                <p><span className="mono">{concluido.chassi}</span> · {km(concluido.kmInicial)} na primeira leitura</p>
                {concluido.privadoFalhou !== null && (
                    <PrivadoPendente
                        dados={concluido.dadosPrivados}
                        falhaInicial={concluido.privadoFalhou}
                        oQue="A identificação completa, a placa, a UF e o proprietário na data do cadastro"
                    />
                )}
            </Concluido>
        );
    }

    if (etapa === "revisao" || etapa === "enviando") {
        return (
            <div className="painel">
                <h2 className="painel-titulo">Confira o cadastro</h2>
                <p className="painel-texto">Verifique os dados antes de assinar.</p>

                <h3 className="evento-detalhes-subtitulo">Identificação do veículo</h3>
                <dl className="lista-dados">
                    <div><dt>Chassi</dt><dd className="mono">{dados.chassi}</dd></div>
                    <div><dt>Placa</dt><dd className="mono">{dados.placa.trim().toUpperCase()}</dd></div>
                    <div><dt>Marca</dt><dd>{dados.marca?.nome}{dados.marca?.situacao === "pendente" && " (aguardando aprovação)"}</dd></div>
                    <div><dt>Modelo</dt><dd>{dados.modelo}</dd></div>
                    <div><dt>Fabricação / modelo</dt><dd>{dados.anoFabricacao} / {dados.anoModelo}</dd></div>
                    <div><dt>UF de registro na data do cadastro</dt><dd>{nomeUf(dados.uf)}</dd></div>
                </dl>

                <h3 className="evento-detalhes-subtitulo">Primeira leitura</h3>
                <dl className="lista-dados">
                    <div><dt>Quilometragem observada</dt><dd className="destaque-numero">{km(dados.kmInicial)}</dd></div>
                    <div><dt>Observada em</dt><dd>{dataHora(new Date(dados.observadaEm))}</dd></div>
                    <div><dt>Entidade que realizou a leitura</dt><dd>{entidade}</dd></div>
                    <div><dt>Comprovante</dt><dd>{arquivo ? arquivo.name : "Nenhum anexado"}</dd></div>
                </dl>

                <h3 className="evento-detalhes-subtitulo">Proprietário na data do cadastro</h3>
                <dl className="lista-dados">
                    <div><dt>Nome</dt><dd>{dados.nomeProprietario}</dd></div>
                    <div><dt>CPF</dt><dd>{formatarCpf(dados.cpfProprietario)}</dd></div>
                </dl>

                <Aviso tipo="info" titulo="O que fica público">
                    Vão para a blockchain, de forma permanente: o chassi, “{emCadeia?.modelo}”, o ano-modelo
                    {" "}{emCadeia?.ano}, a quilometragem, a carteira que assina e, se houver, o hash do comprovante.
                    Placa, UF, proprietário e a data da observação ficam só nos registros privados.
                </Aviso>
                {falha && <Aviso tipo="erro">{falha}</Aviso>}

                {etapa === "enviando" ? (
                    <Progresso passo={passo} comDocumento={Boolean(arquivo)} />
                ) : (
                    <div className="acoes acoes-fim">
                        <Botao variante="secundario" onClick={() => setEtapa("formulario")}>Voltar e editar</Botao>
                        <Botao onClick={enviar}>Confirmar e assinar</Botao>
                    </div>
                )}
            </div>
        );
    }

    return (
        <form className="painel formulario" onSubmit={revisar} noValidate>
            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">1</span>Identificação do veículo</legend>
                <div className="grade-2">
                    <Campo rotulo="Chassi" erro={erros.chassi} ajuda={erros.chassi ? undefined : "17 caracteres. É o identificador do veículo no KmChain."}>
                        <input className="mono" value={dados.chassi} maxLength={17} autoComplete="off"
                            autoCapitalize="characters" spellCheck={false}
                            onChange={(e) => alterar("chassi", normalizarChassi(e.target.value))} />
                    </Campo>
                    <Campo rotulo="Placa" erro={erros.placa}>
                        <input className="mono" value={dados.placa} maxLength={8} autoComplete="off" autoCapitalize="characters"
                            onChange={(e) => alterar("placa", e.target.value.toUpperCase())} />
                    </Campo>
                </div>
                <div className="grade-2">
                    <SeletorMarca
                        marcas={marcas}
                        valor={dados.marca}
                        erro={erros.marca}
                        aoEscolher={(m) => alterar("marca", m)}
                        aoNovaMarca={(m) => setMarcas((lista) => [...lista, m])}
                    />
                    <Campo rotulo="Modelo" erro={erros.modelo} ajuda={erros.modelo ? undefined : "Como consta no documento do veículo."}>
                        <input value={dados.modelo} maxLength={60} autoComplete="off"
                            onChange={(e) => alterar("modelo", e.target.value)} />
                    </Campo>
                </div>
                <div className="grade-2">
                    <Campo rotulo="Ano de fabricação" erro={erros.anoFabricacao}>
                        <input inputMode="numeric" maxLength={4} value={dados.anoFabricacao}
                            onChange={(e) => alterar("anoFabricacao", e.target.value.replace(/\D/g, ""))} />
                    </Campo>
                    <Campo rotulo="Ano-modelo" erro={erros.anoModelo}>
                        <input inputMode="numeric" maxLength={4} value={dados.anoModelo}
                            onChange={(e) => alterar("anoModelo", e.target.value.replace(/\D/g, ""))} />
                    </Campo>
                </div>
                <Campo rotulo="UF de registro na data do cadastro" erro={erros.uf} className="campo-curto"
                    ajuda={erros.uf ? undefined : "Conforme o documento do veículo ou consulta autorizada."}>
                    <select value={dados.uf} onChange={(e) => alterar("uf", e.target.value)}>
                        <option value="">Selecione</option>
                        {UFS.map(([sigla, nome]) => <option key={sigla} value={sigla}>{nome} ({sigla})</option>)}
                    </select>
                </Campo>
                <p className="nota-privacidade">
                    <Icone nome="info" tamanho={14} />
                    Placa e UF ficam só nos registros privados, com data: uma mudança futura é registrada como nova informação, sem apagar esta.
                </p>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">2</span>Primeira leitura</legend>
                <div className="grade-2">
                    <Campo rotulo="Quilometragem observada" sufixo="km" erro={erros.kmInicial}>
                        <input className="entrada-km" inputMode="numeric" autoComplete="off" value={dados.kmInicial}
                            onChange={(e) => alterar("kmInicial", e.target.value.replace(/\D/g, ""))} />
                    </Campo>
                    <Campo rotulo="Data e hora da observação" erro={erros.observadaEm}
                        ajuda={erros.observadaEm ? undefined : "Quando o hodômetro foi lido. Até 30 dias atrás."}>
                        <input type="datetime-local" value={dados.observadaEm} max={agoraLocal()}
                            onChange={(e) => alterar("observadaEm", e.target.value)} />
                    </Campo>
                </div>
                <div className="campo">
                    <span className="campo-rotulo">Entidade que realizou a leitura</span>
                    <p className="entidade-leitura">{entidade}</p>
                    <p className="campo-ajuda">A leitura é atribuída à carteira que assina o cadastro.</p>
                </div>
                <CampoArquivo arquivo={arquivo} aoEscolher={setArquivo} ajuda="Documento do veículo ou laudo da leitura. PDF, PNG ou JPEG até 3 MB." />
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">3</span>Informações privadas</legend>
                <p className="campo-rotulo">Proprietário na data do cadastro</p>
                <div className="grade-2">
                    <Campo rotulo="Nome" erro={erros.nomeProprietario}>
                        <input value={dados.nomeProprietario} onChange={(e) => alterar("nomeProprietario", e.target.value)} />
                    </Campo>
                    <Campo rotulo="CPF" erro={erros.cpfProprietario}>
                        <input inputMode="numeric" value={dados.cpfProprietario} placeholder="000.000.000-00"
                            onChange={(e) => alterar("cpfProprietario", e.target.value)} />
                    </Campo>
                </div>
                <p className="nota-privacidade">
                    <Icone nome="info" tamanho={14} />
                    Nome e CPF ficam só nos registros privados do DETRAN, não aparecem na consulta pública e não vão para a blockchain.
                </p>
            </fieldset>

            {falha && <Aviso tipo="erro">{falha}</Aviso>}

            <div className="acoes acoes-fim">
                <Botao type="submit" carregando={verificando}>Revisar cadastro</Botao>
            </div>
        </form>
    );
}
