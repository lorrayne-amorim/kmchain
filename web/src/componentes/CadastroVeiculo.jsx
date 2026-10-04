import { useEffect, useState } from "react";
import { contratoLeitura, contratoEscrita } from "../lib/blockchain";
import { chaveDoChassi } from "../lib/chassi";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import { HASH_VAZIO, agoraLocal, dataHora, encurtar, formatarCpf, km, localParaIso, localParaSegundos, normalizarChassi, validarChassi } from "../lib/formato";
import { LISTA_INICIAL, carregarMarcas } from "../lib/marcas";
import { conferirCadastro, registrarComplemento } from "../lib/registros";
import { avisar } from "../lib/toast";
import { useMunicipios } from "../lib/useMunicipios";
import { UFS, problemasDoCadastro } from "../lib/veiculo";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Icone from "../ui/Icone";
import SeletorMarca from "../ui/SeletorMarca";
import SeletorMunicipio from "../ui/SeletorMunicipio";
import { Concluido, Progresso } from "../ui/Transacao";
import ComplementoPendente from "./ComplementoPendente";

const VAZIO = {
    chassi: "", placa: "", marca: null, modelo: "", anoFabricacao: "", anoModelo: "", uf: "",
    kmInicial: "", dataEvento: "", municipio: "", nomeProprietario: "", cpfProprietario: ""
};

// Exclusivo do DETRAN. Cria o veiculo em cadeia com o seu primeiro evento
// (quilometragem, data e local) e guarda no banco do KMChain a identificacao
// e as informacoes datadas: placa, UF de registro e proprietario.
export default function CadastroVeiculo({ acesso, aoVerHistorico }) {
    const { usuario, conta, organizacao } = acesso;
    const municipioPadrao = organizacao?.municipio_ibge ? String(organizacao.municipio_ibge) : "";
    const novoFormulario = () => ({ ...VAZIO, dataEvento: agoraLocal(), municipio: municipioPadrao });

    const [dados, setDados] = useState(novoFormulario);
    const [marcas, setMarcas] = useState(LISTA_INICIAL);
    const [arquivo, setArquivo] = useState(null);
    const [erros, setErros] = useState({});

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando | concluido
    const [verificando, setVerificando] = useState(false);
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [concluido, setConcluido] = useState(null);
    const municipios = useMunicipios();

    // Marcas propostas (pendentes ou aprovadas) chegam do servidor; ate la,
    // vale a lista-base.
    useEffect(() => {
        carregarMarcas().then(setMarcas).catch(() => { });
    }, []);

    const alterar = (campo, valor) => {
        setDados((d) => ({ ...d, [campo]: valor }));
        setErros((e) => ({ ...e, [campo]: undefined }));
    };

    // O que vai para o servidor (validacao previa e dados complementares).
    const payload = () => ({
        chassi: dados.chassi,
        placa: dados.placa,
        marcaId: dados.marca?.id,
        modelo: dados.modelo,
        anoFabricacao: dados.anoFabricacao,
        anoModelo: dados.anoModelo,
        uf: dados.uf,
        kmInicial: dados.kmInicial,
        dataEvento: localParaIso(dados.dataEvento),
        municipio: dados.municipio,
        nomeProprietario: dados.nomeProprietario,
        cpfProprietario: dados.cpfProprietario
    });

    async function revisar(e) {
        e.preventDefault();
        setFalha("");

        const novos = problemasDoCadastro({ ...dados, dataEvento: localParaIso(dados.dataEvento) });
        const problemaChassi = validarChassi(dados.chassi);
        if (problemaChassi) novos.chassi = problemaChassi;
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        setVerificando(true);
        try {
            const veiculo = await contratoLeitura().getVeiculo(chaveDoChassi(dados.chassi));
            if (veiculo.cadastrado) return setErros({ chassi: "Este chassi já está cadastrado." });
            // O servidor confere tudo antes da assinatura.
            await conferirCadastro(payload());
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
            const tx = await contrato.cadastrarVeiculo(
                chaveDoChassi(dados.chassi), BigInt(dados.kmInicial), localParaSegundos(dados.dataEvento), Number(dados.municipio), hash
            );

            setPasso("confirmacao");
            const recibo = await tx.wait();

            // Identificacao, placa, UF e proprietario: so no banco do KMChain.
            // O servidor confere a transacao antes de gravar.
            const dadosComplementares = { txHash: tx.hash, ...payload() };
            let complementoFalhou = null;
            try {
                await registrarComplemento(dadosComplementares);
            } catch (erroComplemento) {
                complementoFalhou = mensagemDeErro(erroComplemento, "");
            }

            setConcluido({ recibo: { hash: tx.hash, gas: recibo.gasUsed.toString() }, complementoFalhou, dadosComplementares, ...dados });
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
        setDados(novoFormulario());
        setArquivo(null);
        setErros({});
        setConcluido(null);
        setEtapa("formulario");
    }

    const nomeUf = (sigla) => UFS.find(([s]) => s === sigla)?.[1] ?? sigla;
    const local = municipios && dados.municipio ? municipios.rotuloDoMunicipio(dados.municipio) : "";
    const responsavel = (
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
                <p><span className="mono">{concluido.chassi}</span> · {km(concluido.kmInicial)} no primeiro registro</p>
                {concluido.complementoFalhou !== null && (
                    <ComplementoPendente
                        enviar={() => registrarComplemento(concluido.dadosComplementares)}
                        falhaInicial={concluido.complementoFalhou}
                        oQue="A identificação, a placa, a UF e o proprietário na data do cadastro"
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

                <h3 className="evento-detalhes-subtitulo">Primeiro registro</h3>
                <dl className="lista-dados">
                    <div><dt>Quilometragem observada</dt><dd className="destaque-numero">{km(dados.kmInicial)}</dd></div>
                    <div><dt>Data e hora do evento</dt><dd>{dataHora(new Date(dados.dataEvento))}</dd></div>
                    <div><dt>Local do evento</dt><dd>{local}</dd></div>
                    <div><dt>Registrado por</dt><dd>{responsavel}</dd></div>
                    <div><dt>Comprovante</dt><dd>{arquivo ? arquivo.name : "Nenhum anexado"}</dd></div>
                </dl>

                <h3 className="evento-detalhes-subtitulo">Proprietário na data do cadastro</h3>
                <dl className="lista-dados">
                    <div><dt>Nome</dt><dd>{dados.nomeProprietario}</dd></div>
                    <div><dt>CPF</dt><dd>{formatarCpf(dados.cpfProprietario)}</dd></div>
                </dl>

                <Aviso tipo="info" titulo="O que vai para a blockchain">
                    De forma permanente e pública: a chave derivada do chassi, a quilometragem, a data e hora do
                    evento, o município, o identificador do DETRAN como organização, a carteira que assina e, se
                    houver, o hash do comprovante. Placa, UF, marca, modelo, anos e proprietário ficam só no
                    cadastro do KMChain, fora da blockchain.
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
                    <Campo rotulo="Chassi" erro={erros.chassi} ajuda={erros.chassi ? undefined : "17 caracteres. É o identificador do veículo no KMChain."}>
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
                    A identificação fica no cadastro do KMChain, fora da blockchain. Placa e UF são datadas: uma mudança futura entra como nova informação, sem apagar esta.
                </p>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">2</span>Primeiro registro</legend>
                <div className="grade-2">
                    <Campo rotulo="Quilometragem observada" sufixo="km" erro={erros.kmInicial}>
                        <input className="entrada-km" inputMode="numeric" autoComplete="off" value={dados.kmInicial}
                            onChange={(e) => alterar("kmInicial", e.target.value.replace(/\D/g, ""))} />
                    </Campo>
                    <Campo rotulo="Data e hora do evento" erro={erros.dataEvento}
                        ajuda={erros.dataEvento ? undefined : "Quando o hodômetro foi lido. Até 30 dias atrás."}>
                        <input type="datetime-local" value={dados.dataEvento} max={agoraLocal()}
                            onChange={(e) => alterar("dataEvento", e.target.value)} />
                    </Campo>
                </div>
                <SeletorMunicipio valor={dados.municipio} erro={erros.municipio} rotuloCidade="Cidade do evento"
                    ajuda="Onde a quilometragem foi lida." aoEscolher={(codigo) => alterar("municipio", codigo)} />
                <div className="campo">
                    <span className="campo-rotulo">Registrado por</span>
                    <p className="entidade-leitura">{responsavel}</p>
                    <p className="campo-ajuda">O registro é atribuído à carteira que assina o cadastro e ao DETRAN.</p>
                </div>
                <CampoArquivo arquivo={arquivo} aoEscolher={setArquivo} ajuda="Documento do veículo ou laudo da leitura. PDF, PNG ou JPEG até 3 MB." />
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">3</span>Proprietário (acesso restrito)</legend>
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
                    Nome e CPF ficam só no cadastro do KMChain, com acesso restrito ao DETRAN. Não aparecem na consulta pública e não vão para a blockchain.
                </p>
            </fieldset>

            {falha && <Aviso tipo="erro">{falha}</Aviso>}

            <div className="acoes acoes-fim">
                <Botao type="submit" carregando={verificando}>Revisar cadastro</Botao>
            </div>
        </form>
    );
}
