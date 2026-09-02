import { useState } from "react";
import { contratoLeitura, contratoEscrita, linkTransacao } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Exclusivo do DETRAN. Cria o veiculo em cadeia com sua primeira leitura
// (o proprio cadastro conta como o evento inicial do historico).
export default function CadastroVeiculo() {
    const [chassi, setChassi] = useState("");
    const [placa, setPlaca] = useState("");
    const [modelo, setModelo] = useState("");
    const [ano, setAno] = useState("");
    const [kmInicial, setKmInicial] = useState("");
    const [arquivo, setArquivo] = useState(null);

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | enviando
    const [status, setStatus] = useState("");
    const [recibo, setRecibo] = useState(null);

    function voltar() {
        setEtapa("formulario");
        setStatus("");
    }

    async function revisar() {
        setStatus("");
        setRecibo(null);

        const alvo = chassi.trim().toUpperCase();
        if (alvo.length !== 17) return setStatus("O chassi precisa ter 17 caracteres.");
        if (!placa.trim()) return setStatus("Informe a placa.");
        if (!modelo.trim()) return setStatus("Informe o modelo.");
        if (!/^[0-9]{4}$/.test(ano)) return setStatus("Informe o ano com 4 dígitos.");
        if (!/^[0-9]+$/.test(kmInicial)) return setStatus("Informe a quilometragem em números inteiros.");

        try {
            const veiculo = await contratoLeitura().getVeiculo(alvo);
            if (veiculo.cadastrado) return setStatus("Este chassi já está cadastrado.");
            setEtapa("revisao");
        } catch (e) {
            setStatus("Não foi possível verificar o veículo: " + e.message);
        }
    }

    async function enviar() {
        setEtapa("enviando");
        try {
            let hash = ZERO;
            if (arquivo) {
                setStatus("Guardando o documento...");
                hash = await enviarDocumento(arquivo, chassi);
            }

            setStatus("Confirme a assinatura na MetaMask...");
            const contrato = await contratoEscrita();
            const tx = await contrato.cadastrarVeiculo(
                chassi.trim().toUpperCase(),
                placa.trim().toUpperCase(),
                modelo.trim(),
                Number(ano),
                BigInt(kmInicial),
                hash
            );

            setStatus("Aguardando a confirmação do bloco...");
            const r = await tx.wait();
            setRecibo({ hash: tx.hash, gas: r.gasUsed.toString() });
            setStatus("Veículo cadastrado.");
            setEtapa("formulario");
            setChassi("");
            setPlaca("");
            setModelo("");
            setAno("");
            setKmInicial("");
            setArquivo(null);
        } catch (e) {
            if (e.revert?.name === "VeiculoJaCadastrado") {
                setStatus("Este chassi já está cadastrado.");
            } else {
                setStatus("Cadastro recusado: " + (e.reason ?? e.shortMessage ?? e.message));
            }
            setEtapa("revisao");
        }
    }

    return (
        <section>
            <h2>Cadastrar veículo</h2>
            <p>Exclusivo do DETRAN. Cria o veículo em cadeia com a quilometragem inicial.</p>

            {etapa === "formulario" && (
                <div>
                    <input placeholder="Chassi" maxLength={17} value={chassi}
                        onChange={(e) => setChassi(e.target.value.toUpperCase())} />
                    <input placeholder="Placa" value={placa}
                        onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
                    <input placeholder="Modelo" value={modelo}
                        onChange={(e) => setModelo(e.target.value)} />
                    <input placeholder="Ano" type="number" value={ano}
                        onChange={(e) => setAno(e.target.value)} />
                    <input placeholder="Quilometragem inicial" type="number" value={kmInicial}
                        onChange={(e) => setKmInicial(e.target.value)} />
                    <input type="file" accept="application/pdf,image/*"
                        onChange={(e) => setArquivo(e.target.files[0])} />
                    <button onClick={revisar}>Revisar cadastro</button>
                </div>
            )}

            {etapa === "revisao" && (
                <div className="revisao">
                    <h3>Confira antes de assinar</h3>
                    <dl>
                        <dt>Chassi</dt><dd>{chassi.trim().toUpperCase()}</dd>
                        <dt>Placa</dt><dd>{placa.trim().toUpperCase()}</dd>
                        <dt>Modelo</dt><dd>{modelo}</dd>
                        <dt>Ano</dt><dd>{ano}</dd>
                        <dt>Quilometragem inicial</dt>
                        <dd>{Number(kmInicial).toLocaleString("pt-BR")} km</dd>
                        <dt>Documento</dt>
                        <dd>
                            <input type="file" accept="application/pdf,image/*"
                                onChange={(e) => setArquivo(e.target.files[0])} />
                            <span className="nome-arquivo">{arquivo ? arquivo.name : "nenhum anexado"}</span>
                        </dd>
                    </dl>

                    <p className="aviso">
                        Depois de confirmado, o cadastro é definitivo e passa a compor o
                        histórico público do veículo.
                    </p>

                    <button onClick={enviar}>Confirmar e assinar</button>
                    <button onClick={voltar}>Voltar e corrigir</button>
                </div>
            )}

            {etapa === "enviando" && <p>{status}</p>}
            {etapa !== "enviando" && status && <p>{status}</p>}

            {recibo && (
                <p>
                    Gas consumido: {recibo.gas} ·{" "}
                    <a href={linkTransacao(recibo.hash)} target="_blank" rel="noreferrer">
                        ver no Etherscan
                    </a>
                </p>
            )}
        </section>
    );
}
