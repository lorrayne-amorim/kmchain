import { useState } from "react";
import { consultarPrivado } from "../lib/privado";

// Exclusivo do DETRAN. O que aparece aqui NUNCA passa pela blockchain nem
// pela consulta publica: CPF do proprietario no momento do servico e o nome
// de quem, de fato, realizou cada cadastro/leitura (nao so a carteira).
export default function ConsultaPrivada() {
    const [chassi, setChassi] = useState("");
    const [registros, setRegistros] = useState(null);
    const [erro, setErro] = useState("");
    const [carregando, setCarregando] = useState(false);

    function formatarCpf(cpf) {
        if (!cpf) return "—";
        const d = cpf.replace(/\D/g, "").padStart(11, "0");
        return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    }

    async function consultar() {
        const alvo = chassi.trim().toUpperCase();
        setErro("");
        setRegistros(null);
        if (alvo.length !== 17) return setErro("O chassi tem 17 caracteres.");

        setCarregando(true);
        try {
            setRegistros(await consultarPrivado(alvo));
        } catch (e) {
            setErro(e.message);
        } finally {
            setCarregando(false);
        }
    }

    return (
        <section>
            <h2>Registros privados</h2>
            <p>
                Exclusivo do DETRAN. CPF do proprietário e o responsável real por cada
                serviço — dados que nunca ficam na blockchain nem na consulta pública.
            </p>

            <input value={chassi} maxLength={17} placeholder="Chassi"
                onChange={(e) => setChassi(e.target.value.toUpperCase())} />
            <button onClick={consultar} disabled={carregando}>
                {carregando ? "Consultando..." : "Consultar"}
            </button>

            {erro && <p className="erro">{erro}</p>}

            {registros && registros.length === 0 && (
                <p className="aviso">Nenhum registro privado para este chassi ainda.</p>
            )}

            {registros && registros.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Evento</th>
                            <th>Proprietário</th>
                            <th>CPF</th>
                            <th>Realizado por</th>
                        </tr>
                    </thead>
                    <tbody>
                        {registros.map((r, i) => (
                            <tr key={i}>
                                <td>{new Date(r.criado_em).toLocaleString("pt-BR")}</td>
                                <td>{r.tipo_evento}</td>
                                <td>{r.nome_proprietario ?? "—"}</td>
                                <td>{formatarCpf(r.cpf_proprietario)}</td>
                                <td title={r.usuario_email}>{r.usuario_nome}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
