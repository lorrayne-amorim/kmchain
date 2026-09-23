import { useState } from "react";
import { definirPapel, linkTransacao } from "../lib/blockchain";
import { contasPendentes } from "../lib/privado";

const PAPEIS = [
    { valor: "OFICINA_ROLE", rotulo: "Oficina" },
    { valor: "VISTORIA_ROLE", rotulo: "Centro de vistoria" },
    { valor: "DETRAN_ROLE", rotulo: "DETRAN" }
];

const ROTULO_PAPEL_SOLICITADO = { oficina: "Oficina", vistoria: "Centro de vistoria", detran: "DETRAN" };

// Exclusivo de quem tem DEFAULT_ADMIN_ROLE (o dono do contrato) - e nao de
// qualquer conta DETRAN_ROLE, ja que o contrato nunca redefine o admin
// desses papeis. Concede ou revoga acesso de outras carteiras.
export default function CredenciarEntidade() {
    const [carteira, setCarteira] = useState("");
    const [papel, setPapel] = useState(PAPEIS[0].valor);
    const [processando, setProcessando] = useState(false);
    const [status, setStatus] = useState("");
    const [recibo, setRecibo] = useState(null);

    const [contas, setContas] = useState(null);
    const [erroContas, setErroContas] = useState("");
    const [carregandoContas, setCarregandoContas] = useState(false);

    // Contas com login (email/senha) ainda sem carteira credenciada em cadeia
    // - ajuda a achar rapido a carteira de quem ja pediu acesso. So carrega
    // sob demanda, ja que exige assinar uma mensagem na MetaMask.
    async function carregarContas() {
        setErroContas("");
        setCarregandoContas(true);
        try {
            setContas(await contasPendentes());
        } catch (e) {
            setErroContas(e.message);
        } finally {
            setCarregandoContas(false);
        }
    }

    async function aplicar(conceder) {
        setStatus("");
        setRecibo(null);

        const alvo = carteira.trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(alvo)) {
            return setStatus("Informe um endereço de carteira válido (0x...).");
        }

        setProcessando(true);
        try {
            setStatus("Confirme a assinatura na MetaMask...");
            const tx = await definirPapel(papel, alvo, conceder);

            setStatus("Aguardando a confirmação do bloco...");
            const r = await tx.wait();
            setRecibo({ hash: tx.hash, gas: r.gasUsed.toString() });
            setStatus(
                conceder
                    ? `Papel concedido a ${alvo}.`
                    : `Papel revogado de ${alvo}.`
            );
        } catch (e) {
            setStatus("Operação recusada: " + (e.reason ?? e.shortMessage ?? e.message));
        } finally {
            setProcessando(false);
        }
    }

    return (
        <section>
            <h2>Credenciar entidade</h2>
            <p>Concede ou revoga o acesso de oficinas, centros de vistoria e outras contas do DETRAN.</p>

            <input placeholder="Endereço da carteira (0x...)" value={carteira}
                onChange={(e) => setCarteira(e.target.value)} />
            <select value={papel} onChange={(e) => setPapel(e.target.value)}>
                {PAPEIS.map((p) => (
                    <option key={p.valor} value={p.valor}>{p.rotulo}</option>
                ))}
            </select>

            <button onClick={() => aplicar(true)} disabled={processando}>
                Conceder
            </button>
            <button className="secundario" onClick={() => aplicar(false)} disabled={processando}>
                Revogar
            </button>

            {status && <p>{status}</p>}

            {recibo && (
                <p>
                    Gas consumido: {recibo.gas} ·{" "}
                    <a href={linkTransacao(recibo.hash)} target="_blank" rel="noreferrer">
                        ver no Etherscan
                    </a>
                </p>
            )}

            <h3 className="separador">Contas cadastradas</h3>
            <p>Login (e-mail/senha) de quem já pediu acesso, aguardando a carteira ser credenciada acima.</p>

            {contas === null && (
                <button className="secundario" onClick={carregarContas} disabled={carregandoContas}>
                    {carregandoContas ? "Carregando..." : "Carregar contas cadastradas"}
                </button>
            )}
            {erroContas && <p className="erro">{erroContas}</p>}

            {contas && contas.length === 0 && <p className="aviso">Nenhuma conta cadastrada ainda.</p>}

            {contas && contas.length > 0 && (
                <table>
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>E-mail</th>
                            <th>Função pretendida</th>
                            <th>Carteira vinculada</th>
                        </tr>
                    </thead>
                    <tbody>
                        {contas.map((c) => (
                            <tr key={c.email}>
                                <td>{c.nome}</td>
                                <td>{c.email}</td>
                                <td>{ROTULO_PAPEL_SOLICITADO[c.papel_solicitado] ?? c.papel_solicitado}</td>
                                <td>
                                    {c.carteira
                                        ? <button className="ancorado" onClick={() => setCarteira(c.carteira)}>
                                            {c.carteira.slice(0, 6)}...{c.carteira.slice(-4)}
                                          </button>
                                        : "ainda não vinculada"}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </section>
    );
}
