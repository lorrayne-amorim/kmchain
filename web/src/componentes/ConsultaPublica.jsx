import { useEffect, useState } from "react";
import { contratoLeitura } from "../lib/blockchain";
import { abrirDocumento } from "../lib/documentos";
import EtiquetaQr from "./EtiquetaQr";

const TIPOS = ["Cadastro", "Vistoria", "Revisão", "Transferência", "Sinistro", "Correção"];

export default function ConsultaPublica() {
    const [chassi, setChassi] = useState("");
    const [resultado, setResultado] = useState(null);
    const [erro, setErro] = useState("");
    const [carregando, setCarregando] = useState(false);

    // Permite abrir a consulta direto pelo QR Code: /?chassi=XXXX
    useEffect(() => {
        const daUrl = new URLSearchParams(window.location.search).get("chassi");
        if (daUrl) {
            setChassi(daUrl.toUpperCase());
            consultar(daUrl);
        }
    }, []);

    async function consultar(valor) {
        const alvo = String(valor ?? chassi).trim().toUpperCase();
        setErro("");
        setResultado(null);

        if (alvo.length !== 17) {
            setErro("O chassi tem 17 caracteres. Confira o documento do veículo.");
            return;
        }

        setCarregando(true);
        try {
            const contrato = contratoLeitura();
            const veiculo = await contrato.getVeiculo(alvo);
            if (!veiculo.cadastrado) {
                setErro("Nenhum registro encontrado para este chassi.");
                return;
            }
            const historico = await contrato.getHistorico(alvo);
            const conforme = await contrato.conformidade(alvo);
            setResultado({ chassi: alvo, veiculo, historico, conforme: conforme[0] });
        } catch (e) {
            setErro("A consulta falhou: " + e.message);
        } finally {
            setCarregando(false);
        }
    }

    return (
        <section>
            <h2>Consultar histórico</h2>
            <p>Digite o chassi que consta no documento do veículo.</p>

            <input
                value={chassi}
                maxLength={17}
                placeholder="9BWZZZ377VT004251"
                onChange={(e) => setChassi(e.target.value.toUpperCase())}
            />
            <button onClick={() => consultar()} disabled={carregando}>
                {carregando ? "Consultando..." : "Consultar"}
            </button>

            {erro && <p className="erro">{erro}</p>}

            {resultado && (
                <div>
                    <h3>
                        {resultado.veiculo.modelo} · {resultado.veiculo.ano} ·{" "}
                        {resultado.veiculo.placa}
                    </h3>
                    <p className={resultado.conforme ? "selo ok" : "selo alerta"}>
                        {resultado.conforme
                            ? "Histórico íntegro e documentado"
                            : "Histórico íntegro, com leituras sem comprovante anexado"}
                    </p>
                    <p>
                        Última leitura: {resultado.veiculo.ultimaKm.toString()} km ·{" "}
                        {resultado.veiculo.totalLeituras.toString()} registros
                        {Number(resultado.veiculo.totalCorrecoes) > 0 &&
                            ` · ${resultado.veiculo.totalCorrecoes} correção(ões) do DETRAN`}
                    </p>

                    <table>
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Quilometragem</th>
                                <th>Evento</th>
                                <th>Entidade</th>
                                <th>Documento</th>
                            </tr>
                        </thead>
                        <tbody>
                            {resultado.historico.map((leitura, i) => {
                                const temDoc = !/^0x0+$/.test(leitura.hashDocumento);
                                return (
                                    <tr key={i} className={leitura.contestada ? "contestada" : ""}>
                                        <td>
                                            {new Date(Number(leitura.data) * 1000).toLocaleDateString("pt-BR")}
                                        </td>
                                        <td>
                                            {Number(leitura.quilometragem).toLocaleString("pt-BR")} km
                                            {leitura.atipica && <span className="marca">atípica</span>}
                                            {leitura.contestada && <span className="marca">corrigida</span>}
                                        </td>
                                        <td>{TIPOS[Number(leitura.tipo)]}</td>
                                        <td title={leitura.entidade}>
                                            {leitura.entidade.slice(0, 6)}...{leitura.entidade.slice(-4)}
                                        </td>
                                        <td>
                                            {temDoc ? (
                                                // O hash e publico; o documento so abre para carteira credenciada.
                                                <button
                                                    className="ancorado"
                                                    title={leitura.hashDocumento}
                                                    onClick={() =>
                                                        abrirDocumento(leitura.hashDocumento).catch((e) => alert(e.message))
                                                    }
                                                >
                                                    comprovante ancorado
                                                </button>
                                            ) : (
                                                "—"
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    <EtiquetaQr chassi={resultado.chassi} />
                </div>
            )}
        </section>
    );
}