import { useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { formatarCpf, normalizarChassi, validarChassi } from "../lib/formato";
import { consultarPrivado } from "../lib/privado";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import { Vazio } from "../ui/Pagina";
import Tabela from "../ui/Tabela";

const dataHoraCurta = (valor) => new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// Exclusivo do DETRAN. O que aparece aqui NUNCA passa pela blockchain nem
// pela consulta publica: placa, CPF do proprietario no momento do servico e
// o nome de quem, de fato, realizou cada cadastro/leitura (nao so a carteira).
export default function ConsultaPrivada() {
    const [chassi, setChassi] = useState("");
    const [consultado, setConsultado] = useState("");
    const [registros, setRegistros] = useState(null);
    const [erroCampo, setErroCampo] = useState("");
    const [erro, setErro] = useState("");
    const [carregando, setCarregando] = useState(false);

    async function consultar(e) {
        e.preventDefault();
        setErro("");
        setErroCampo("");
        const problema = validarChassi(chassi);
        if (problema) return setErroCampo(problema);

        setCarregando(true);
        setRegistros(null);
        try {
            setRegistros(await consultarPrivado(chassi));
            setConsultado(chassi);
        } catch (falha) {
            setErro(mensagemDeErro(falha, "Não foi possível consultar os registros privados."));
        } finally {
            setCarregando(false);
        }
    }

    return (
        <div className="empilhado">
            <form className="painel busca-linha" onSubmit={consultar} noValidate>
                <Campo rotulo="Chassi do veículo" erro={erroCampo}
                    ajuda={erroCampo ? undefined : "A consulta pede uma assinatura na carteira para confirmar a credencial DETRAN."}>
                    <input className="mono" value={chassi} maxLength={17} placeholder="Digite o chassi"
                        autoComplete="off" autoCapitalize="characters" spellCheck={false}
                        onChange={(e) => setChassi(normalizarChassi(e.target.value))} />
                </Campo>
                <Botao type="submit" icone="busca" carregando={carregando}>Consultar</Botao>
            </form>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            {registros && registros.length === 0 && (
                <div className="painel">
                    <Vazio titulo="Nenhum registro privado">
                        Ainda não há dados privados para o chassi <span className="mono">{consultado}</span>.
                    </Vazio>
                </div>
            )}

            {registros && registros.length > 0 && (
                <div className="painel painel-tabela">
                    <p className="painel-tabela-titulo">
                        {registros.length} {registros.length === 1 ? "registro" : "registros"} · <span className="mono">{consultado}</span>
                    </p>
                    <Tabela
                        rotulo="Registros privados do veículo"
                        linhas={registros}
                        chave={(r, i) => r.tx_hash ?? i}
                        colunas={[
                            { titulo: "Data", render: (r) => <span className="numero">{dataHoraCurta(r.criado_em)}</span> },
                            { titulo: "Evento", render: (r) => r.tipo_evento },
                            { titulo: "Placa", render: (r) => <span className="mono">{r.placa ?? "—"}</span> },
                            { titulo: "Proprietário", render: (r) => r.nome_proprietario ?? "—" },
                            { titulo: "CPF", render: (r) => <span className="numero">{formatarCpf(r.cpf_proprietario)}</span> },
                            {
                                titulo: "Realizado por",
                                render: (r) => (
                                    <>
                                        {r.usuario_nome}
                                        <span className="celula-secundaria">{r.usuario_email}</span>
                                    </>
                                )
                            }
                        ]}
                        itemMovel={(r) => (
                            <div className="item-movel">
                                <div className="item-movel-topo">
                                    <strong>{r.tipo_evento}</strong>
                                    <span className="numero">{dataHoraCurta(r.criado_em)}</span>
                                </div>
                                <dl className="lista-dados lista-dados-compacta">
                                    <div><dt>Placa</dt><dd className="mono">{r.placa ?? "—"}</dd></div>
                                    <div><dt>Proprietário</dt><dd>{r.nome_proprietario ?? "—"}</dd></div>
                                    <div><dt>CPF</dt><dd>{formatarCpf(r.cpf_proprietario)}</dd></div>
                                    <div><dt>Realizado por</dt><dd>{r.usuario_nome}<span className="celula-secundaria">{r.usuario_email}</span></dd></div>
                                </dl>
                            </div>
                        )}
                    />
                </div>
            )}
        </div>
    );
}
