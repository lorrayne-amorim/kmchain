import { useState } from "react";
import { contratoLeitura, contratoEscrita, linkTransacao } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";

const TIPOS = ["Cadastro", "Vistoria", "Revisão", "Transferência", "Sinistro", "Correção"];
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";

export default function RegistroLeitura() {
    const [chassi, setChassi] = useState("");
    const [km, setKm] = useState("");
    const [tipo, setTipo] = useState(1);
    const [arquivo, setArquivo] = useState(null);

    const [etapa, setEtapa] = useState("formulario"); // formulario | revisao | atipica | enviando
    const [revisao, setRevisao] = useState(null);
    const [atipica, setAtipica] = useState(null);
    const [hashDoc, setHashDoc] = useState(null);
    const [status, setStatus] = useState("");
    const [recibo, setRecibo] = useState(null);

    function voltar() {
        setEtapa("formulario");
        setRevisao(null);
        setAtipica(null);
        setStatus("");
    }

    // PRIMEIRA CONFIRMACAO - vale para qualquer valor e acontece antes de
    // qualquer assinatura. Busca a ultima leitura em cadeia e mostra o avanco,
    // para que o operador veja o que esta prestes a gravar de forma definitiva.
    async function revisar() {
        setStatus("");
        setRecibo(null);

        const alvo = chassi.trim().toUpperCase();
        if (alvo.length !== 17) return setStatus("O chassi precisa ter 17 caracteres.");
        if (!/^[0-9]+$/.test(km)) return setStatus("Informe a quilometragem em números inteiros.");

        try {
            const veiculo = await contratoLeitura().getVeiculo(alvo);
            if (!veiculo.cadastrado) return setStatus("Veículo não cadastrado.");

            const ultima = Number(veiculo.ultimaKm);
            setRevisao({
                ultima,
                avanco: Number(km) - ultima,
                data: new Date(Number(veiculo.ultimaData) * 1000).toLocaleDateString("pt-BR"),
                regressiva: Number(km) < ultima
            });
            setEtapa("revisao");
        } catch (e) {
            setStatus("Não foi possível carregar o veículo: " + e.message);
        }
    }

    async function enviar(confirmarAtipica) {
        setEtapa("enviando");
        try {
            let hash = hashDoc ?? ZERO;
            if (arquivo && !hashDoc) {
                setStatus("Guardando o documento...");
                hash = await enviarDocumento(arquivo, chassi);
                setHashDoc(hash); // evita reenviar o arquivo na segunda tentativa
            }

            setStatus("Confirme a assinatura na MetaMask...");
            const contrato = await contratoEscrita();
            const tx = await contrato.registrarLeitura(
                chassi.trim().toUpperCase(),
                BigInt(km),
                Number(tipo),
                hash,
                confirmarAtipica
            );

            setStatus("Aguardando a confirmação do bloco...");
            const r = await tx.wait();
            setRecibo({ hash: tx.hash, gas: r.gasUsed.toString() });
            setStatus(confirmarAtipica ? "Leitura registrada e marcada como atípica." : "Leitura registrada.");
            setEtapa("formulario");
            setRevisao(null);
            setAtipica(null);
            setHashDoc(null);
        } catch (e) {
            // SEGUNDA CONFIRMACAO - so aparece quando o proprio contrato recusa o
            // avanco por estar acima do limite. Os numeros vem do erro do contrato,
            // nao de uma conta feita aqui.
            if (e.revert?.name === "LeituraAtipica") {
                const [avanco, limite, dias] = e.revert.args;
                setAtipica({ avanco: Number(avanco), limite: Number(limite), dias: Number(dias) });
                setEtapa("atipica");
                setStatus("");
                return;
            }
            setStatus("Registro recusado: " + (e.reason ?? e.shortMessage ?? e.message));
            setEtapa("revisao");
        }
    }

    return (
        <section>
            <h2>Registrar leitura</h2>
            <p>Disponível para DETRAN, centros de vistoria e oficinas credenciadas.</p>

            {etapa === "formulario" && (
                <div>
                    <input placeholder="Chassi" maxLength={17} value={chassi}
                        onChange={(e) => setChassi(e.target.value.toUpperCase())} />
                    <input placeholder="Quilometragem" type="number" value={km}
                        onChange={(e) => setKm(e.target.value)} />
                    <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                        {TIPOS.map((t, i) => i > 0 && i < 5 && <option key={i} value={i}>{t}</option>)}
                    </select>
                    <input type="file" accept="application/pdf,image/*"
                        onChange={(e) => { setArquivo(e.target.files[0]); setHashDoc(null); }} />
                    <button onClick={revisar}>Revisar registro</button>
                </div>
            )}

            {etapa === "revisao" && (
                <div className="revisao">
                    <h3>Confira antes de assinar</h3>
                    <dl>
                        <dt>Chassi</dt><dd>{chassi.trim().toUpperCase()}</dd>
                        <dt>Nova leitura</dt><dd>{Number(km).toLocaleString("pt-BR")} km</dd>
                        <dt>Última registrada</dt>
                        <dd>{revisao.ultima.toLocaleString("pt-BR")} km, em {revisao.data}</dd>
                        <dt>Avanço</dt>
                        <dd>
                            {revisao.regressiva
                                ? `${revisao.avanco.toLocaleString("pt-BR")} km — menor que a última leitura`
                                : `+ ${revisao.avanco.toLocaleString("pt-BR")} km`}
                        </dd>
                        <dt>Evento</dt><dd>{TIPOS[tipo]}</dd>
                        <dt>Documento</dt><dd>{arquivo ? arquivo.name : "nenhum anexado"}</dd>
                    </dl>

                    {revisao.regressiva && (
                        <p className="erro">
                            O contrato vai recusar esta leitura: quilometragem menor que a última registrada.
                        </p>
                    )}

                    <p className="aviso">
                        Depois de confirmado, o registro é definitivo e não pode ser alterado nem apagado.
                        Apenas o DETRAN pode anexar uma correção, e a leitura original continuará visível.
                    </p>

                    <button onClick={() => enviar(false)} disabled={revisao.regressiva}>
                        Confirmar e assinar
                    </button>
                    <button onClick={voltar}>Voltar e corrigir</button>
                </div>
            )}

            {etapa === "atipica" && (
                <div className="revisao alerta">
                    <h3>Avanço acima do esperado</h3>
                    <p>
                        Esta leitura representa <b>{atipica.avanco.toLocaleString("pt-BR")} km</b> a mais
                        que a anterior, em {atipica.dias} dia(s) — acima do limite de{" "}
                        {atipica.limite.toLocaleString("pt-BR")} km para este veículo no período.
                    </p>
                    <p>
                        Confirme apenas se a quilometragem estiver correta. Ela será gravada de forma
                        definitiva e ficará marcada como atípica no histórico público do veículo.
                    </p>
                    <button onClick={() => enviar(true)}>Está correta, confirmar</button>
                    <button onClick={voltar}>Cancelar e revisar</button>
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