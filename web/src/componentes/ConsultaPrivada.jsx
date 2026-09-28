import { useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { agoraLocal, formatarCpf, km, localParaIso, normalizarChassi, validarChassi } from "../lib/formato";
import { alterarDado, consultarPrivado } from "../lib/privado";
import { avisar } from "../lib/toast";
import { UFS } from "../lib/veiculo";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import { Vazio } from "../ui/Pagina";
import Tabela from "../ui/Tabela";
import CompletarIdentificacao from "./CompletarIdentificacao";

const dataHoraCurta = (valor) => new Date(valor).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const dataCurtaNum = (valor) => new Date(valor).toLocaleDateString("pt-BR");

// Data do bloco da transacao (quando o registro entrou na blockchain).
// Registros antigos nao tem: mostra quando foram salvos no banco, avisando.
const quando = (r) => r.registrado_em_cadeia
    ? dataHoraCurta(r.registrado_em_cadeia)
    : `${dataHoraCurta(r.criado_em)} (salvo no banco)`;

const ORIGENS = { cadastro: "no cadastro", alteracao: "alteração cadastral", transferencia: "transferência" };
const nomeUf = (sigla) => UFS.find(([s]) => s === sigla)?.[1] ?? sigla;

// Exclusivo do DETRAN. O que aparece aqui NUNCA passa pela blockchain nem
// pela consulta publica: identificacao completa, placa, UF de registro e
// proprietario (com historico datado) e quem realizou cada registro.
export default function ConsultaPrivada() {
    const [chassi, setChassi] = useState("");
    const [consultado, setConsultado] = useState("");
    const [dados, setDados] = useState(null);
    const [erroCampo, setErroCampo] = useState("");
    const [erro, setErro] = useState("");
    const [carregando, setCarregando] = useState(false);

    async function carregar(alvo) {
        setErro("");
        setCarregando(true);
        try {
            setDados(await consultarPrivado(alvo));
            setConsultado(alvo);
        } catch (falha) {
            setErro(mensagemDeErro(falha, "Não foi possível consultar os registros privados."));
        } finally {
            setCarregando(false);
        }
    }

    function consultar(e) {
        e.preventDefault();
        setErroCampo("");
        const problema = validarChassi(chassi);
        if (problema) return setErroCampo(problema);
        setDados(null);
        carregar(chassi);
    }

    const registros = dados?.registros ?? [];
    const semNada = dados && !dados.veiculo && registros.length === 0 && dados.placas.length === 0;

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

            {semNada && (
                <div className="painel">
                    <Vazio titulo="Nenhum registro privado">
                        Ainda não há dados privados para o chassi <span className="mono">{consultado}</span>.
                    </Vazio>
                </div>
            )}

            {dados && !dados.veiculo && (
                <CompletarIdentificacao chassi={consultado} aoConcluir={() => carregar(consultado)} />
            )}

            {dados && !semNada && (
                <>
                    <section className="painel" aria-labelledby="titulo-identificacao">
                        <h2 id="titulo-identificacao" className="painel-titulo">Identificação do veículo</h2>
                        {dados.veiculo ? (
                            <dl className="lista-dados">
                                <div><dt>Chassi</dt><dd className="mono">{consultado}</dd></div>
                                <div><dt>Marca</dt><dd>{dados.veiculo.marca_nome}</dd></div>
                                <div><dt>Modelo</dt><dd>{dados.veiculo.modelo}</dd></div>
                                <div><dt>Fabricação / modelo</dt><dd>{dados.veiculo.ano_fabricacao} / {dados.veiculo.ano_modelo}</dd></div>
                                <div><dt>Cadastrado em</dt><dd>{dataHoraCurta(dados.veiculo.criado_em)}</dd></div>
                            </dl>
                        ) : (
                            <p className="painel-texto">
                                Sem identificação no cadastro do KMChain. Complete abaixo.
                            </p>
                        )}
                    </section>

                    <div className="grade-2">
                        <Datado titulo="Placa" campo="placa" linhas={dados.placas} chassi={consultado} aoAlterar={() => carregar(consultado)}
                            valor={(l) => <span className="mono">{l.placa}</span>} />
                        <Datado titulo="UF de registro" campo="uf" linhas={dados.ufs} chassi={consultado} aoAlterar={() => carregar(consultado)}
                            valor={(l) => `${nomeUf(l.uf)} (${l.uf})`} />
                    </div>
                    <Datado titulo="Proprietário" campo="proprietario" linhas={dados.proprietarios} chassi={consultado} aoAlterar={() => carregar(consultado)}
                        valor={(l) => <>{l.nome} · <span className="numero">{formatarCpf(l.cpf)}</span></>} />

                    {registros.length > 0 && (
                        <div className="painel painel-tabela">
                            <p className="painel-tabela-titulo">
                                {registros.length} {registros.length === 1 ? "registro" : "registros"} · <span className="mono">{consultado}</span>
                            </p>
                            <Tabela
                                rotulo="Registros privados do veículo"
                                linhas={registros}
                                chave={(r, i) => r.tx_hash ?? i}
                                colunas={[
                                    { titulo: "Registrado em cadeia", render: (r) => <span className="numero">{quando(r)}</span> },
                                    { titulo: "Observado em", render: (r) => <span className="numero">{r.observada_em ? dataHoraCurta(r.observada_em) : "—"}</span> },
                                    { titulo: "Evento", render: (r) => r.tipo_evento },
                                    { titulo: "Quilometragem", render: (r) => <span className="numero">{r.quilometragem ? km(r.quilometragem) : "—"}</span> },
                                    {
                                        titulo: "Realizado por",
                                        render: (r) => <>{r.usuario_nome}<span className="celula-secundaria">{r.usuario_email}</span></>
                                    }
                                ]}
                                itemMovel={(r) => (
                                    <div className="item-movel">
                                        <div className="item-movel-topo">
                                            <strong>{r.tipo_evento}</strong>
                                            <span className="numero">{quando(r)}</span>
                                        </div>
                                        <dl className="lista-dados lista-dados-compacta">
                                            <div><dt>Observado em</dt><dd>{r.observada_em ? dataHoraCurta(r.observada_em) : "—"}</dd></div>
                                            <div><dt>Quilometragem</dt><dd>{r.quilometragem ? km(r.quilometragem) : "—"}</dd></div>
                                            <div><dt>Realizado por</dt><dd>{r.usuario_nome}<span className="celula-secundaria">{r.usuario_email}</span></dd></div>
                                        </dl>
                                    </div>
                                )}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// Uma informacao datada: a vigente em destaque, as anteriores abaixo, e o
// registro de uma mudanca (linha nova; nada e apagado).
function Datado({ titulo, campo, linhas, chassi, valor, aoAlterar }) {
    const [editando, setEditando] = useState(false);
    const [form, setForm] = useState({});
    const [erros, setErros] = useState({});
    const [falha, setFalha] = useState("");
    const [enviando, setEnviando] = useState(false);

    function abrir() {
        setForm({ vigenteDesde: agoraLocal(), placa: "", uf: "", nomeProprietario: "", cpfProprietario: "" });
        setErros({});
        setFalha("");
        setEditando(true);
    }

    async function salvar(e) {
        e.preventDefault();
        setFalha("");
        setErros({});
        setEnviando(true);
        try {
            await alterarDado(chassi, campo, { ...form, vigenteDesde: localParaIso(form.vigenteDesde) });
            setEditando(false);
            avisar("Alteração registrada. A informação anterior continua no histórico.");
            aoAlterar();
        } catch (erro) {
            if (erro.dados?.campos) setErros(erro.dados.campos);
            setFalha(mensagemDeErro(erro, "Não foi possível registrar a alteração."));
        } finally {
            setEnviando(false);
        }
    }

    const mudar = (chave, v) => setForm((f) => ({ ...f, [chave]: v }));

    return (
        <section className="painel" aria-label={titulo}>
            <div className="painel-cabecalho">
                <h2 className="painel-titulo">{titulo}</h2>
                {linhas.length > 0 && !editando && (
                    <Botao variante="fantasma" tamanho="p" onClick={abrir}>Registrar alteração</Botao>
                )}
            </div>
            {linhas.length === 0 ? (
                <p className="painel-texto">Sem registro privado.</p>
            ) : (
                <ul className="datado-lista">
                    {linhas.map((l, i) => (
                        <li key={`${l.vigente_desde}-${i}`} className={i === 0 ? "datado-vigente" : ""}>
                            <span>{valor(l)}{i === 0 && <span className="celula-secundaria">vigente</span>}</span>
                            <span className="datado-quando">desde {dataCurtaNum(l.vigente_desde)} · {ORIGENS[l.origem] ?? l.origem}</span>
                        </li>
                    ))}
                </ul>
            )}

            {editando && (
                <form className="formulario-empilhado" onSubmit={salvar} noValidate>
                    {campo === "placa" && (
                        <Campo rotulo="Nova placa" erro={erros.placa}>
                            <input className="mono" value={form.placa} maxLength={8} onChange={(e) => mudar("placa", e.target.value.toUpperCase())} />
                        </Campo>
                    )}
                    {campo === "uf" && (
                        <Campo rotulo="Nova UF de registro" erro={erros.uf}>
                            <select value={form.uf} onChange={(e) => mudar("uf", e.target.value)}>
                                <option value="">Selecione</option>
                                {UFS.map(([sigla, nome]) => <option key={sigla} value={sigla}>{nome} ({sigla})</option>)}
                            </select>
                        </Campo>
                    )}
                    {campo === "proprietario" && (
                        <div className="grade-2">
                            <Campo rotulo="Nome do proprietário" erro={erros.nomeProprietario}>
                                <input value={form.nomeProprietario} onChange={(e) => mudar("nomeProprietario", e.target.value)} />
                            </Campo>
                            <Campo rotulo="CPF" erro={erros.cpfProprietario}>
                                <input inputMode="numeric" value={form.cpfProprietario} onChange={(e) => mudar("cpfProprietario", e.target.value)} />
                            </Campo>
                        </div>
                    )}
                    <Campo rotulo="Vale desde" erro={erros.vigenteDesde} ajuda="Data em que a mudança passou a valer, conforme o documento.">
                        <input type="datetime-local" value={form.vigenteDesde} max={agoraLocal()} onChange={(e) => mudar("vigenteDesde", e.target.value)} />
                    </Campo>
                    {falha && <Aviso tipo="erro">{falha}</Aviso>}
                    <div className="acoes">
                        <Botao type="submit" carregando={enviando}>Assinar e registrar</Botao>
                        <Botao variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Botao>
                    </div>
                </form>
            )}
        </section>
    );
}
