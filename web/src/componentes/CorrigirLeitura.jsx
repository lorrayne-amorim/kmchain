import { useState } from "react";
import { contratoLeitura, contratoEscrita, linkTransacao } from "../lib/blockchain";
import { enviarDocumento } from "../lib/documentos";

const TIPOS = ["Cadastro", "Vistoria", "Revisão", "Transferência", "Sinistro", "Correção"];

// Exclusivo do DETRAN. Nao apaga nada: marca a leitura equivocada como
// contestada e anexa uma correcao com o documento que a justifica.
export default function CorrigirLeitura() {
    const [chassi, setChassi] = useState("");
    const [historico, setHistorico] = useState(null);
    const [indice, setIndice] = useState(null);
    const [kmCorreta, setKmCorreta] = useState("");
    const [arquivo, setArquivo] = useState(null);
    const [status, setStatus] = useState("");
    const [recibo, setRecibo] = useState(null);

    async function carregar() {
        setStatus("");
        setRecibo(null);
        setIndice(null);
        try {
            const contrato = contratoLeitura();
            const h = await contrato.getHistorico(chassi.trim().toUpperCase());
            if (h.length === 0) return setStatus("Nenhum registro para este chassi.");
            setHistorico(h);
        } catch (e) {
            setStatus("Falha ao carregar: " + e.message);
        }
    }

    async function corrigir() {
        try {
            let hash = "0x0000000000000000000000000000000000000000000000000000000000000000";
            if (arquivo) {
                setStatus("Guardando a justificativa...");
                hash = await enviarDocumento(arquivo, chassi);
            }

            setStatus("Confirme a assinatura na MetaMask...");
            const contrato = await contratoEscrita();
            const tx = await contrato.corrigirLeitura(
                chassi.trim().toUpperCase(),
                BigInt(indice),
                BigInt(kmCorreta),
                hash
            );

            setStatus("Aguardando a confirmação do bloco...");
            const r = await tx.wait();
            setRecibo({ hash: tx.hash, gas: r.gasUsed.toString() });
            setStatus("Leitura corrigida.");
            carregar();
        } catch (e) {
            setStatus("Correção recusada: " + (e.reason ?? e.shortMessage ?? e.message));
        }
    }

    return (
        <section>
            <h2>Corrigir leitura</h2>
            <p>Exclusivo do DETRAN. A leitura equivocada permanece visível no histórico, marcada como contestada.</p>

            <input placeholder="Chassi" maxLength={17} value={chassi}
                onChange={(e) => setChassi(e.target.value.toUpperCase())} />
            <button onClick={carregar}>Carregar histórico</button>

            {historico && (
                <table>
                    <tbody>
                        {historico.map((leitura, i) => (
                            <tr key={i} className={leitura.contestada ? "contestada" : ""}>
                                <td>
                                    <input type="radio" name="leitura" disabled={leitura.contestada}
                                        checked={indice === i} onChange={() => setIndice(i)} />
                                </td>
                                <td>{i}</td>
                                <td>{new Date(Number(leitura.data) * 1000).toLocaleDateString("pt-BR")}</td>
                                <td>{Number(leitura.quilometragem).toLocaleString("pt-BR")} km</td>
                                <td>{TIPOS[Number(leitura.tipo)]}</td>
                                <td>{leitura.contestada ? "já corrigida" : ""}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {indice !== null && (
                <div>
                    <input placeholder="Quilometragem correta" type="number" value={kmCorreta}
                        onChange={(e) => setKmCorreta(e.target.value)} />
                    <input type="file" accept="application/pdf,image/*"
                        onChange={(e) => setArquivo(e.target.files[0])} />
                    <button onClick={corrigir}>Corrigir leitura {indice}</button>
                </div>
            )}

            {status && <p>{status}</p>}
            {recibo && (
                <p>
                    Gas: {recibo.gas} ·{" "}
                    <a href={linkTransacao(recibo.hash)} target="_blank" rel="noreferrer">ver no Etherscan</a>
                </p>
            )}
        </section>
    );
}