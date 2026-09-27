import { useState } from "react";
import { contratoLeitura, contratoEscrita } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import { HASH_VAZIO, formatarCpf, km, normalizarChassi, validarChassi } from "../lib/formato";
import { registrarPrivado } from "../lib/privado";
import { avisar } from "../lib/toast";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo, { CampoArquivo } from "../ui/Campo";
import Icone from "../ui/Icone";
import { Concluido, Progresso } from "../ui/Transacao";

const VAZIO = { chassi: "", placa: "", modelo: "", ano: "", kmInicial: "", nomeProprietario: "", cpfProprietario: "" };

// Exclusivo do DETRAN. Cria o veiculo em cadeia com sua primeira leitura
// (o proprio cadastro conta como o evento inicial do historico).
export default function CadastroVeiculo({ usuario, conta, aoVerHistorico }) {
    const [dados, setDados] = useState(VAZIO);
    const [arquivo, setArquivo] = useState(null);
    const [erros, setErros] = useState({});

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando | concluido
    const [verificando, setVerificando] = useState(false);
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [concluido, setConcluido] = useState(null);

    const alterar = (campo, valor) => {
        setDados((d) => ({ ...d, [campo]: valor }));
        setErros((e) => ({ ...e, [campo]: undefined }));
    };

    async function revisar(e) {
        e.preventDefault();
        setFalha("");

        const novos = {};
        const problemaChassi = validarChassi(dados.chassi);
        if (problemaChassi) novos.chassi = problemaChassi;
        if (!dados.placa.trim()) novos.placa = "Informe a placa.";
        if (!dados.modelo.trim()) novos.modelo = "Informe o modelo.";
        if (!/^[0-9]{4}$/.test(dados.ano)) novos.ano = "Informe o ano com 4 dígitos.";
        if (dados.kmInicial === "") novos.kmInicial = "Informe a quilometragem inicial.";
        if (!dados.nomeProprietario.trim()) novos.nomeProprietario = "Informe o nome do proprietário atual.";
        if (dados.cpfProprietario.replace(/\D/g, "").length !== 11) novos.cpfProprietario = "Informe um CPF com 11 dígitos.";
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        setVerificando(true);
        try {
            const veiculo = await contratoLeitura().getVeiculo(dados.chassi);
            if (veiculo.cadastrado) return setErros({ chassi: "Este chassi já está cadastrado." });
            setEtapa("revisao");
            window.scrollTo(0, 0);
        } catch (erro) {
            setFalha(mensagemDeErro(erro, "Não foi possível verificar o veículo. Tente novamente."));
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
                dados.chassi,
                dados.modelo.trim(),
                Number(dados.ano),
                BigInt(dados.kmInicial),
                hash
            );

            setPasso("confirmacao");
            const recibo = await tx.wait();

            // Placa e CPF/nome do proprietario nunca vao para a blockchain -
            // ficam so no banco privado, associados a quem fez o cadastro.
            let privadoFalhou = false;
            try {
                await registrarPrivado({
                    chassi: dados.chassi,
                    placa: dados.placa,
                    modelo: dados.modelo,
                    ano: dados.ano,
                    cpfProprietario: dados.cpfProprietario,
                    nomeProprietario: dados.nomeProprietario,
                    tipoEvento: "Cadastro", carteira: conta, txHash: tx.hash
                });
            } catch {
                privadoFalhou = true;
            }

            setConcluido({ recibo: { hash: tx.hash, gas: recibo.gasUsed.toString() }, privadoFalhou, ...dados });
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
        setDados(VAZIO);
        setArquivo(null);
        setErros({});
        setConcluido(null);
        setEtapa("formulario");
    }

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
                <p className="concluido-destaque">{concluido.modelo} · {concluido.ano}</p>
                <p><span className="mono">{concluido.chassi}</span> · {km(concluido.kmInicial)} iniciais</p>
                {concluido.privadoFalhou && (
                    <Aviso tipo="alerta">
                        A placa e os dados do proprietário não puderam ser salvos nos registros privados.
                        O histórico do veículo não foi afetado.
                    </Aviso>
                )}
            </Concluido>
        );
    }

    if (etapa === "revisao" || etapa === "enviando") {
        return (
            <div className="painel">
                <h2 className="painel-titulo">Confira o cadastro</h2>
                <p className="painel-texto">Verifique os dados antes de assinar.</p>

                <dl className="lista-dados">
                    <div><dt>Chassi</dt><dd className="mono">{dados.chassi}</dd></div>
                    <div><dt>Placa</dt><dd className="mono">{dados.placa.trim().toUpperCase()}</dd></div>
                    <div><dt>Modelo</dt><dd>{dados.modelo}</dd></div>
                    <div><dt>Ano</dt><dd>{dados.ano}</dd></div>
                    <div><dt>Quilometragem inicial</dt><dd className="destaque-numero">{km(dados.kmInicial)}</dd></div>
                    <div><dt>Proprietário</dt><dd>{dados.nomeProprietario}</dd></div>
                    <div><dt>CPF</dt><dd>{formatarCpf(dados.cpfProprietario)}</dd></div>
                    <div><dt>Comprovante</dt><dd>{arquivo ? arquivo.name : "Nenhum anexado"}</dd></div>
                    <div><dt>Registrado por</dt><dd>{usuario?.nome}</dd></div>
                </dl>

                <Aviso tipo="info">
                    Depois de confirmado, o cadastro é definitivo e inicia o histórico público do veículo.
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
                <legend className="grupo-titulo">Identificação</legend>
                <div className="grade-2">
                    <Campo rotulo="Chassi" erro={erros.chassi} ajuda={erros.chassi ? undefined : "17 caracteres."}>
                        <input className="mono" value={dados.chassi} maxLength={17} autoComplete="off"
                            autoCapitalize="characters" spellCheck={false}
                            onChange={(e) => alterar("chassi", normalizarChassi(e.target.value))} />
                    </Campo>
                    <Campo rotulo="Placa" erro={erros.placa}>
                        <input className="mono" value={dados.placa} autoComplete="off" autoCapitalize="characters"
                            onChange={(e) => alterar("placa", e.target.value.toUpperCase())} />
                    </Campo>
                </div>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo">Veículo</legend>
                <div className="grade-2">
                    <Campo rotulo="Modelo" erro={erros.modelo}>
                        <input value={dados.modelo} onChange={(e) => alterar("modelo", e.target.value)} />
                    </Campo>
                    <Campo rotulo="Ano" erro={erros.ano}>
                        <input inputMode="numeric" maxLength={4} value={dados.ano}
                            onChange={(e) => alterar("ano", e.target.value.replace(/\D/g, ""))} />
                    </Campo>
                </div>
                <Campo rotulo="Quilometragem inicial" sufixo="km" erro={erros.kmInicial} className="campo-curto">
                    <input className="entrada-km" inputMode="numeric" autoComplete="off" value={dados.kmInicial}
                        onChange={(e) => alterar("kmInicial", e.target.value.replace(/\D/g, ""))} />
                </Campo>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo">Proprietário atual</legend>
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
                    Placa, nome e CPF ficam só nos registros privados do DETRAN e não aparecem na consulta pública.
                </p>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo">Documento</legend>
                <CampoArquivo arquivo={arquivo} aoEscolher={setArquivo} ajuda="Documento do veículo ou laudo de cadastro. PDF ou imagem." />
            </fieldset>

            {falha && <Aviso tipo="erro">{falha}</Aviso>}

            <div className="acoes acoes-fim">
                <Botao type="submit" carregando={verificando}>Revisar cadastro</Botao>
            </div>
        </form>
    );
}
