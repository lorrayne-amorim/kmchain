import { useCallback, useEffect, useState } from "react";
import { mensagemDeErro } from "../../lib/erros";
import { rotuloDaOrganizacao } from "../../lib/eventos";
import { SITUACOES, enderecoEmLinha, formatarCnpj } from "../../lib/organizacao";
import {
    credenciarOrganizacao, definirSituacaoDaOrganizacao, listarOrganizacoesParaGestao, localizarConta, trocarAdministrador
} from "../../lib/organizacoes";
import { avisar } from "../../lib/toast";
import { useMunicipios } from "../../lib/useMunicipios";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo from "../../ui/Campo";
import { Vazio } from "../../ui/Pagina";
import Tabela from "../../ui/Tabela";
import { Progresso } from "../../ui/Transacao";
import Equipe from "./Equipe";
import FormularioOrganizacao from "./FormularioOrganizacao";
import MapaOrganizacoes from "./MapaOrganizacoes";

// Gestao das organizacoes pelo DETRAN: cadastrar, credenciar, suspender,
// reativar, trocar o administrador e consultar a equipe. Credenciamento,
// situacao e administrador sao gravados no contrato; o cadastro, no banco.
export default function Organizacoes({ usuario }) {
    const [modo, setModo] = useState("lista"); // lista | mapa | nova | editar | detalhe
    const [organizacoes, setOrganizacoes] = useState(null);
    const [selecionadaId, setSelecionadaId] = useState(null);
    const [erro, setErro] = useState("");

    const carregar = useCallback(async () => {
        setErro("");
        try {
            setOrganizacoes((await listarOrganizacoesParaGestao()).filter((o) => o.tipo !== "DETRAN"));
        } catch (e) {
            setErro(mensagemDeErro(e, "Não foi possível carregar as organizações."));
        }
    }, []);

    useEffect(() => {
        const espera = setTimeout(carregar);
        return () => clearTimeout(espera);
    }, [carregar]);

    const selecionada = organizacoes?.find((o) => o.id === selecionadaId);
    const abrir = (id) => {
        setSelecionadaId(id);
        setModo("detalhe");
    };

    async function aoCadastrar(r) {
        await carregar();
        avisar("Organização cadastrada. Falta assinar o credenciamento.");
        abrir(r.organizacao.id);
    }

    if (modo === "nova") {
        return <FormularioOrganizacao aoSalvar={aoCadastrar} aoCancelar={() => setModo("lista")} />;
    }
    if (modo === "editar" && selecionada) {
        return (
            <FormularioOrganizacao
                organizacao={selecionada}
                aoCancelar={() => setModo("detalhe")}
                aoSalvar={async () => {
                    await carregar();
                    avisar("Cadastro atualizado.");
                    setModo("detalhe");
                }}
            />
        );
    }
    if (modo === "detalhe" && selecionada) {
        return (
            <DetalheDaOrganizacao organizacao={selecionada} usuario={usuario} aoVoltar={() => setModo("lista")}
                aoEditar={() => setModo("editar")} aoAtualizar={carregar} />
        );
    }

    const situacao = (o) => <span className={`etiqueta-status situacao-${o.situacao}`}>{SITUACOES[o.situacao]}</span>;

    return (
        <div className="empilhado">
            <div className="painel-cabecalho">
                <div className="segmentos" role="group" aria-label="Visualização">
                    <button type="button" aria-pressed={modo === "lista"} onClick={() => setModo("lista")}>Lista</button>
                    <button type="button" aria-pressed={modo === "mapa"} onClick={() => setModo("mapa")}>Mapa</button>
                </div>
                <Botao icone="mais" onClick={() => setModo("nova")}>Nova organização</Botao>
            </div>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            {modo === "mapa" && <MapaOrganizacoes />}

            {modo === "lista" && (
                <div className="painel painel-tabela">
                    {organizacoes?.length === 0 && (
                        <Vazio titulo="Nenhuma organização cadastrada">
                            Cadastre oficinas, empresas de vistoria e seguradoras para que possam registrar eventos.
                        </Vazio>
                    )}
                    {organizacoes?.length > 0 && (
                        <Tabela
                            rotulo="Organizações"
                            linhas={organizacoes}
                            chave={(o) => o.id}
                            colunas={[
                                { titulo: "Organização", render: (o) => <>{o.nome_fantasia}<span className="celula-secundaria">{formatarCnpj(o.cnpj)}</span></> },
                                { titulo: "Tipo", render: (o) => rotuloDaOrganizacao(o.tipo) },
                                { titulo: "Administrador", render: (o) => o.administrador_nome ?? "—" },
                                { titulo: "Funcionários", render: (o) => <span className="numero">{o.funcionarios_ativos}</span> },
                                { titulo: "Situação", render: situacao },
                                { titulo: "Ações", classe: "celula-acoes", render: (o) => <Botao variante="fantasma" tamanho="p" onClick={() => abrir(o.id)}>{o.situacao === "pendente" ? "Credenciar" : "Abrir"}</Botao> }
                            ]}
                            itemMovel={(o) => (
                                <div className="item-movel">
                                    <div className="item-movel-topo">
                                        <span><strong>{o.nome_fantasia}</strong><span className="celula-secundaria">{rotuloDaOrganizacao(o.tipo)}</span></span>
                                        <Botao variante="secundario" tamanho="p" onClick={() => abrir(o.id)}>{o.situacao === "pendente" ? "Credenciar" : "Abrir"}</Botao>
                                    </div>
                                    <p className="item-movel-linha">{situacao(o)} {o.administrador_nome}</p>
                                </div>
                            )}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

function DetalheDaOrganizacao({ organizacao: o, usuario, aoVoltar, aoEditar, aoAtualizar }) {
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [trocando, setTrocando] = useState(false);
    const [email, setEmail] = useState("");
    const [erroEmail, setErroEmail] = useState("");
    const municipios = useMunicipios();

    // Assina no contrato e recarrega o cadastro espelhado pelo servidor.
    async function executar(operacao, mensagem) {
        setFalha("");
        try {
            await operacao();
            avisar(mensagem);
            await aoAtualizar();
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível concluir a operação. Tente novamente."));
        } finally {
            setPasso(null);
        }
    }

    async function trocar(e) {
        e.preventDefault();
        setErroEmail("");
        try {
            const conta = await localizarConta(email.trim().toLowerCase(), o.id);
            await executar(() => trocarAdministrador(o, conta.carteira, setPasso), `${conta.nome} é o novo administrador.`);
            setTrocando(false);
            setEmail("");
        } catch (erro) {
            setErroEmail(mensagemDeErro(erro, "Não foi possível localizar a conta."));
        }
    }

    const local = municipios && o.municipio_ibge ? municipios.rotuloDoMunicipio(o.municipio_ibge) : "";
    const ocupado = Boolean(passo);

    return (
        <div className="empilhado">
            <Botao variante="fantasma" tamanho="p" icone="voltar" className="voltar" onClick={aoVoltar}>Todas as organizações</Botao>

            <section className="painel">
                <div className="painel-cabecalho">
                    <h2 className="painel-titulo">{o.nome_fantasia}</h2>
                    <span className={`etiqueta-status situacao-${o.situacao}`}>{SITUACOES[o.situacao]}</span>
                </div>
                <dl className="lista-dados">
                    <div><dt>Tipo</dt><dd>{rotuloDaOrganizacao(o.tipo)}</dd></div>
                    <div><dt>Razão social</dt><dd>{o.razao_social}</dd></div>
                    <div><dt>CNPJ</dt><dd className="numero">{formatarCnpj(o.cnpj)}</dd></div>
                    <div><dt>Contato</dt><dd>{o.telefone} · {o.email}</dd></div>
                    <div><dt>Endereço</dt><dd>{enderecoEmLinha(o)}<span className="celula-secundaria">{local} · CEP {o.cep}</span></dd></div>
                    <div><dt>Administrador</dt><dd>{o.administrador_nome ?? "—"}<span className="celula-secundaria">{o.administrador_email}</span></dd></div>
                    <div>
                        <dt>Identificador em cadeia</dt>
                        <dd>{o.id_cadeia ?? "Ainda não credenciada"}{o.credenciada_em && <span className="celula-secundaria">credenciada em {new Date(o.credenciada_em).toLocaleDateString("pt-BR")}</span>}</dd>
                    </div>
                </dl>

                {o.situacao === "pendente" && (
                    <Aviso tipo="info" titulo="Credenciamento pendente">
                        {o.credenciamento
                            ? "O cadastro está salvo. Assine o credenciamento para a organização passar a registrar eventos."
                            : "O administrador indicado não tem mais carteira vinculada. Peça para vincular a carteira à conta."}
                    </Aviso>
                )}
                {falha && <Aviso tipo="erro">{falha}</Aviso>}

                {ocupado ? <Progresso passo={passo} /> : (
                    <div className="acoes">
                        {o.situacao === "pendente" && o.credenciamento && (
                            <Botao icone="check" onClick={() => executar(() => credenciarOrganizacao(o, setPasso), "Organização credenciada.")}>
                                Assinar credenciamento
                            </Botao>
                        )}
                        {o.situacao === "ativa" && (
                            <Botao variante="fantasma" className="texto-perigo"
                                onClick={() => executar(() => definirSituacaoDaOrganizacao(o, false, setPasso), "Organização suspensa.")}>
                                Suspender
                            </Botao>
                        )}
                        {o.situacao === "suspensa" && (
                            <Botao onClick={() => executar(() => definirSituacaoDaOrganizacao(o, true, setPasso), "Organização reativada.")}>Reativar</Botao>
                        )}
                        {o.id_cadeia !== null && <Botao variante="secundario" onClick={() => setTrocando((v) => !v)}>Trocar administrador</Botao>}
                        <Botao variante="secundario" onClick={aoEditar}>Editar cadastro</Botao>
                    </div>
                )}
                {o.situacao === "ativa" && (
                    <p className="campo-ajuda">Suspender impede novos registros da organização. Os eventos já registrados continuam no histórico.</p>
                )}

                {trocando && !ocupado && (
                    <form className="busca-linha" onSubmit={trocar} noValidate>
                        <Campo rotulo="E-mail da conta do novo administrador" erro={erroEmail}
                            ajuda={erroEmail ? undefined : "O administrador atual continua na equipe, como funcionário."}>
                            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </Campo>
                        <Botao type="submit">Assinar troca</Botao>
                    </form>
                )}
            </section>

            {o.id_cadeia !== null && <Equipe key={o.administrador_id} organizacaoId={o.id} usuario={usuario} />}
        </div>
    );
}
