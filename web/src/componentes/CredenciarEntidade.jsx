import { useEffect, useId, useRef, useState } from "react";
import { definirPapel, papeisDasContas } from "../lib/blockchain";
import { mensagemDeErro } from "../lib/erros";
import { carteiraValida, encurtar, rotulosPapel } from "../lib/formato";
import { contasPendentes } from "../lib/privado";
import { avisar } from "../lib/toast";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import Dialogo from "../ui/Dialogo";
import Icone from "../ui/Icone";
import { Vazio } from "../ui/Pagina";
import Tabela from "../ui/Tabela";
import { DetalhesTecnicos, Progresso } from "../ui/Transacao";

// O que cada funcao libera no contrato (modificadores apenasCredenciada e
// onlyRole(DETRAN_ROLE)).
const PAPEIS = [
    { valor: "OFICINA_ROLE", chave: "oficina", rotulo: "Oficina", permite: ["Registrar leituras de quilometragem"] },
    { valor: "VISTORIA_ROLE", chave: "vistoria", rotulo: "Centro de vistoria", permite: ["Registrar leituras de quilometragem"] },
    {
        valor: "DETRAN_ROLE", chave: "detran", rotulo: "DETRAN",
        permite: ["Registrar leituras de quilometragem", "Cadastrar veículos", "Corrigir leituras", "Consultar registros privados"]
    }
];

// Exclusivo de quem tem DEFAULT_ADMIN_ROLE (o dono do contrato) - e nao de
// qualquer conta DETRAN_ROLE, ja que o contrato nunca redefine o admin
// desses papeis. Concede ou revoga acesso de outras carteiras.
export default function CredenciarEntidade() {
    const [carteira, setCarteira] = useState("");
    const [erroCarteira, setErroCarteira] = useState("");
    const [papel, setPapel] = useState(PAPEIS[0].valor);
    const [funcoes, setFuncoes] = useState({}); // { enderecoMinusculo: papeis } ja consultados
    const [operacao, setOperacao] = useState(null); // { conceder } enquanto o dialogo esta aberto
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");
    const [resultado, setResultado] = useState(null);

    const [contas, setContas] = useState(null);
    const [papeisContas, setPapeisContas] = useState({});
    const [filtro, setFiltro] = useState("");
    const [erroContas, setErroContas] = useState("");
    const [carregandoContas, setCarregandoContas] = useState(false);

    const idPapel = useId();
    const formulario = useRef(null);
    const alvo = carteira.trim();
    const valida = carteiraValida(alvo);
    const escolhido = PAPEIS.find((p) => p.valor === papel);
    const atuais = valida ? funcoes[alvo.toLowerCase()] ?? null : null;
    const jaTem = atuais ? atuais[escolhido.chave] : null;
    const conta = contas?.find((c) => c.carteira?.toLowerCase() === alvo.toLowerCase());

    // Mostra as funcoes que a carteira ja tem assim que o endereco fica valido.
    useEffect(() => {
        if (!valida) return;
        let ativo = true;
        papeisDasContas([alvo])
            .then((r) => ativo && setFuncoes((f) => ({ ...f, ...r })))
            .catch(() => { });
        return () => { ativo = false; };
    }, [alvo, valida]);

    function pedir(conceder) {
        setResultado(null);
        setFalha("");
        if (!valida) return setErroCarteira("Informe um endereço de carteira válido (0x seguido de 40 caracteres).");
        setOperacao({ conceder });
    }

    async function aplicar() {
        const { conceder } = operacao;
        setFalha("");
        try {
            setPasso("assinatura");
            const tx = await definirPapel(papel, alvo, conceder);
            setPasso("confirmacao");
            const r = await tx.wait();

            setResultado({ conceder, rotulo: escolhido.rotulo, carteira: alvo, recibo: { hash: tx.hash, gas: r.gasUsed.toString() } });
            setOperacao(null);
            avisar(conceder ? "Função concedida." : "Função revogada.");

            const novos = await papeisDasContas([alvo]).catch(() => null);
            if (novos) {
                setFuncoes((f) => ({ ...f, ...novos }));
                setPapeisContas((p) => ({ ...p, ...novos }));
            }
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível concluir a operação. Tente novamente."));
        } finally {
            setPasso(null);
        }
    }

    // Contas com login (e-mail/senha): ajuda a achar rapido a carteira de quem
    // ja pediu acesso. So carrega sob demanda, ja que exige assinar na MetaMask.
    async function carregarContas() {
        setErroContas("");
        setCarregandoContas(true);
        try {
            const lista = await contasPendentes();
            setContas(lista);
            papeisDasContas(lista.map((c) => c.carteira)).then(setPapeisContas).catch(() => { });
        } catch (e) {
            setErroContas(mensagemDeErro(e, "Não foi possível carregar as contas."));
        } finally {
            setCarregandoContas(false);
        }
    }

    function selecionar(c) {
        setCarteira(c.carteira);
        setErroCarteira("");
        setResultado(null);
        formulario.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const termo = filtro.trim().toLowerCase();
    const contasFiltradas = contas?.filter((c) =>
        !termo || c.nome.toLowerCase().includes(termo) || c.email.toLowerCase().includes(termo)
    );

    const funcoesDe = (c) => {
        if (!c.carteira) return <span className="texto-3">Carteira não vinculada</span>;
        const p = papeisContas[c.carteira.toLowerCase()];
        if (!p) return <span className="texto-3">…</span>;
        const r = rotulosPapel(p);
        return r.length ? r.map((x) => <span key={x} className="etiqueta-status">{x}</span>) : <span className="texto-3">Sem função</span>;
    };

    const processando = Boolean(passo);

    return (
        <div className="acessos-grade">
            <section className="painel" ref={formulario} aria-labelledby="titulo-funcao">
                <h2 id="titulo-funcao" className="painel-titulo">Alterar função de uma carteira</h2>
                <p className="painel-texto">Selecione uma conta na lista ou informe o endereço da carteira.</p>

                <div className="formulario-empilhado">
                    <Campo rotulo="Carteira da entidade" erro={erroCarteira}
                        ajuda={conta ? `${conta.nome} · ${conta.email}` : undefined}>
                        <input className="mono" value={carteira} placeholder="0x…" autoComplete="off" spellCheck={false}
                            onChange={(e) => {
                                setCarteira(e.target.value);
                                setErroCarteira("");
                                setResultado(null);
                            }} />
                    </Campo>

                    {valida && (
                        <p className="funcoes-atuais">
                            <span className="texto-3">Funções atuais:</span>{" "}
                            {atuais === null ? "verificando…" : rotulosPapel(atuais).join(", ") || "nenhuma"}
                        </p>
                    )}

                    <div className="campo">
                        <span className="campo-rotulo" id={idPapel}>Função</span>
                        <div className="opcoes-lista" role="radiogroup" aria-labelledby={idPapel}>
                            {PAPEIS.map((p) => (
                                <label key={p.valor} className="opcao-linha">
                                    <input type="radio" name="papel" checked={papel === p.valor} onChange={() => setPapel(p.valor)} />
                                    <span>
                                        <span className="opcao-titulo">{p.rotulo}</span>
                                        <span className="opcao-descricao">{p.permite.join(", ")}.</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="acoes">
                        <Botao icone="check" disabled={jaTem === true} onClick={() => pedir(true)}>Conceder função</Botao>
                        <Botao variante="fantasma" className="texto-perigo" disabled={jaTem === false} onClick={() => pedir(false)}>
                            Revogar função
                        </Botao>
                    </div>
                </div>

                {resultado && (
                    <Aviso tipo="sucesso" titulo={resultado.conceder ? "Função concedida" : "Função revogada"}>
                        <p>
                            {resultado.rotulo} {resultado.conceder ? "concedida a" : "revogada de"}{" "}
                            <span className="mono">{encurtar(resultado.carteira)}</span>.
                        </p>
                        <DetalhesTecnicos recibo={resultado.recibo} />
                    </Aviso>
                )}
            </section>

            <section className="painel painel-tabela" aria-labelledby="titulo-contas">
                <div className="painel-cabecalho">
                    <div>
                        <h2 id="titulo-contas" className="painel-titulo">Contas cadastradas</h2>
                        <p className="painel-texto">Pessoas que criaram login para pedir acesso.</p>
                    </div>
                    {contas && (
                        <div className="campo campo-filtro">
                            <label className="visualmente-oculto" htmlFor="filtro-contas">Buscar por nome ou e-mail</label>
                            <Icone nome="busca" tamanho={16} />
                            <input id="filtro-contas" type="search" value={filtro} placeholder="Buscar por nome ou e-mail"
                                onChange={(e) => setFiltro(e.target.value)} />
                        </div>
                    )}
                </div>

                {contas === null && (
                    <div className="vazio">
                        <p className="vazio-texto">Carregar a lista pede uma assinatura na carteira para confirmar sua credencial.</p>
                        <Botao variante="secundario" carregando={carregandoContas} onClick={carregarContas}>Carregar contas</Botao>
                        {erroContas && <Aviso tipo="erro">{erroContas}</Aviso>}
                    </div>
                )}

                {contasFiltradas && contasFiltradas.length === 0 && (
                    <Vazio titulo={contas.length === 0 ? "Nenhuma conta cadastrada" : "Nenhuma conta encontrada"}>
                        {contas.length === 0 ? "Ainda não há logins criados." : "Ajuste a busca e tente novamente."}
                    </Vazio>
                )}

                {contasFiltradas && contasFiltradas.length > 0 && (
                    <Tabela
                        rotulo="Contas cadastradas"
                        linhas={contasFiltradas}
                        chave={(c) => c.email}
                        colunas={[
                            { titulo: "Nome", render: (c) => <>{c.nome}<span className="celula-secundaria">{c.email}</span></> },
                            { titulo: "Carteira", render: (c) => (c.carteira ? <span className="mono">{encurtar(c.carteira)}</span> : <span className="texto-3">—</span>) },
                            { titulo: "Funções", render: funcoesDe },
                            {
                                titulo: "Ações",
                                classe: "celula-acoes",
                                render: (c) => c.carteira && (
                                    <Botao variante="fantasma" tamanho="p" onClick={() => selecionar(c)}>Selecionar</Botao>
                                )
                            }
                        ]}
                        itemMovel={(c) => (
                            <div className="item-movel">
                                <div className="item-movel-topo">
                                    <span>
                                        <strong>{c.nome}</strong>
                                        <span className="celula-secundaria">{c.email}</span>
                                    </span>
                                    {c.carteira && <Botao variante="secundario" tamanho="p" onClick={() => selecionar(c)}>Selecionar</Botao>}
                                </div>
                                <p className="item-movel-linha">
                                    {c.carteira && <span className="mono">{encurtar(c.carteira)}</span>}
                                    {funcoesDe(c)}
                                </p>
                            </div>
                        )}
                    />
                )}
            </section>

            <Dialogo
                aberto={Boolean(operacao)}
                aoFechar={() => setOperacao(null)}
                bloqueado={processando}
                titulo={operacao?.conceder ? "Conceder função" : "Revogar função"}
                acoes={!processando && (
                    <>
                        <Botao variante="secundario" onClick={() => setOperacao(null)}>Cancelar</Botao>
                        {operacao?.conceder
                            ? <Botao onClick={aplicar}>Conceder função</Botao>
                            : <Botao variante="perigo" onClick={aplicar}>Revogar função</Botao>}
                    </>
                )}
            >
                {operacao && (
                    <>
                        <p>
                            {operacao.conceder ? "Você está concedendo a função " : "Você está revogando a função "}
                            <strong>{escolhido.rotulo}</strong> {operacao.conceder ? "para:" : "de:"}
                        </p>
                        <p className="carteira-destaque">
                            {conta && <span className="carteira-destaque-nome">{conta.nome} · {conta.email}</span>}
                            <span className="mono quebra">{alvo}</span>
                        </p>
                        <p className="texto-2">
                            {operacao.conceder ? "Com ela, a carteira poderá:" : "A carteira deixará de poder:"}
                        </p>
                        <ul className="lista-permissoes">
                            {escolhido.permite.map((p) => (
                                <li key={p}><Icone nome={operacao.conceder ? "check" : "fechar"} tamanho={15} />{p}</li>
                            ))}
                        </ul>
                        {falha && <Aviso tipo="erro">{falha}</Aviso>}
                        {processando && <Progresso passo={passo} />}
                    </>
                )}
            </Dialogo>
        </div>
    );
}
