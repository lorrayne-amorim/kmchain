import { useId, useMemo, useRef, useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { proporMarca } from "../lib/marcas";
import { buscarMarcas } from "../lib/veiculo";
import Aviso from "./Aviso";
import Botao from "./Botao";
import Icone from "./Icone";

const LIMITE_OPCOES = 8;

// Seletor de marca com busca (padrao combobox da WAI-ARIA). So aceita marcas
// da lista; uma marca legitima ausente entra por proposta controlada, que o
// servidor recusa se ja existir ou se parecer erro de digitacao.
export default function SeletorMarca({ marcas, valor, aoEscolher, aoNovaMarca, erro }) {
    const id = useId();
    const [termo, setTermo] = useState(valor?.nome ?? "");
    const [aberto, setAberto] = useState(false);
    const [ativo, setAtivo] = useState(0);
    const [propondo, setPropondo] = useState(false);
    const entrada = useRef(null);

    const opcoes = useMemo(() => buscarMarcas(termo, marcas).slice(0, LIMITE_OPCOES), [termo, marcas]);
    const idLista = `${id}-lista`;
    const idErro = `${id}-erro`;

    function escolher(marca) {
        aoEscolher(marca);
        setTermo(marca.nome);
        setAberto(false);
        setPropondo(false);
    }

    function teclar(e) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setAberto(true);
            setAtivo((a) => Math.min(a + 1, opcoes.length));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAtivo((a) => Math.max(a - 1, 0));
        } else if (e.key === "Enter" && aberto) {
            e.preventDefault();
            if (ativo < opcoes.length) escolher(opcoes[ativo]);
            else abrirProposta();
        } else if (e.key === "Escape") {
            setAberto(false);
        }
    }

    function abrirProposta() {
        setAberto(false);
        setPropondo(true);
    }

    const idOpcao = (i) => `${id}-opcao-${i}`;
    const pendente = valor && valor.situacao === "pendente";

    return (
        <div className={`campo ${erro ? "campo-com-erro" : ""}`}>
            <div className="campo-topo">
                <label htmlFor={id} className="campo-rotulo">Marca</label>
            </div>
            <div className="seletor">
                <input
                    ref={entrada}
                    id={id}
                    role="combobox"
                    aria-expanded={aberto}
                    aria-controls={idLista}
                    aria-autocomplete="list"
                    aria-activedescendant={aberto ? idOpcao(ativo) : undefined}
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? idErro : undefined}
                    autoComplete="off"
                    value={termo}
                    placeholder="Busque pela marca"
                    onChange={(e) => {
                        setTermo(e.target.value);
                        setAtivo(0);
                        setAberto(true);
                        if (valor) aoEscolher(null); // texto mudou: a marca escolhida deixa de valer
                    }}
                    onFocus={() => setAberto(true)}
                    onBlur={() => setTimeout(() => setAberto(false), 150)}
                    onKeyDown={teclar}
                />
                <Icone nome="busca" tamanho={16} className="seletor-icone" />
                {aberto && (
                    <ul id={idLista} role="listbox" className="seletor-lista" aria-label="Marcas">
                        {opcoes.map((m, i) => (
                            <li
                                key={m.id}
                                id={idOpcao(i)}
                                role="option"
                                aria-selected={i === ativo}
                                className={`seletor-opcao ${i === ativo ? "seletor-opcao-ativa" : ""}`}
                                onMouseDown={(e) => { e.preventDefault(); escolher(m); }}
                            >
                                {m.nome}
                                {m.situacao === "pendente" && <span className="seletor-meta">aguardando aprovação</span>}
                            </li>
                        ))}
                        {opcoes.length === 0 && <li className="seletor-vazio" aria-disabled="true">Nenhuma marca encontrada.</li>}
                        <li
                            id={idOpcao(opcoes.length)}
                            role="option"
                            aria-selected={ativo === opcoes.length}
                            className={`seletor-opcao seletor-opcao-nova ${ativo === opcoes.length ? "seletor-opcao-ativa" : ""}`}
                            onMouseDown={(e) => { e.preventDefault(); abrirProposta(); }}
                        >
                            <Icone nome="mais" tamanho={15} />A marca não está na lista
                        </li>
                    </ul>
                )}
            </div>
            {erro && (
                <p id={idErro} className="campo-erro"><Icone nome="alerta" tamanho={14} />{erro}</p>
            )}
            {pendente && !erro && (
                <p className="campo-ajuda">Marca proposta, aguardando aprovação do administrador. O cadastro pode seguir.</p>
            )}
            {propondo && (
                <PropostaMarca
                    nomeInicial={valor ? "" : termo}
                    aoUsar={escolher}
                    aoCriar={(marca) => { aoNovaMarca(marca); escolher(marca); }}
                    aoCancelar={() => { setPropondo(false); entrada.current?.focus(); }}
                />
            )}
        </div>
    );
}

function PropostaMarca({ nomeInicial, aoUsar, aoCriar, aoCancelar }) {
    const [nome, setNome] = useState(nomeInicial);
    const [enviando, setEnviando] = useState(false);
    const [resposta, setResposta] = useState(null); // { tipo, texto, marcas }

    async function propor(confirmarDiferente) {
        setEnviando(true);
        setResposta(null);
        try {
            aoCriar(await proporMarca(nome, confirmarDiferente));
        } catch (e) {
            const dados = e.dados ?? {};
            if (e.codigo === "marca_existente") setResposta({ tipo: "existente", texto: e.message, marcas: [dados.marca] });
            else if (e.codigo === "marca_parecida") setResposta({ tipo: "parecida", texto: e.message, marcas: dados.sugestoes ?? [] });
            else setResposta({ tipo: "erro", texto: mensagemDeErro(e, "Não foi possível propor a marca.") });
        } finally {
            setEnviando(false);
        }
    }

    return (
        <div className="proposta-marca">
            <p className="proposta-marca-texto">
                Informe o nome como consta no documento do veículo. A marca fica pendente até o
                administrador aprovar, e o cadastro pode seguir com ela.
            </p>
            <div className="busca-linha">
                <div className="campo">
                    <label className="visualmente-oculto" htmlFor="proposta-marca-nome">Nome da marca</label>
                    <input id="proposta-marca-nome" value={nome} maxLength={40} autoComplete="off"
                        onChange={(e) => { setNome(e.target.value); setResposta(null); }} />
                </div>
                <Botao variante="secundario" carregando={enviando} disabled={nome.trim().length < 2} onClick={() => propor(false)}>
                    Propor marca
                </Botao>
                <Botao variante="fantasma" onClick={aoCancelar}>Cancelar</Botao>
            </div>
            {resposta && (
                <Aviso tipo={resposta.tipo === "erro" ? "erro" : "alerta"}>
                    <p>{resposta.texto}</p>
                    {resposta.marcas?.length > 0 && (
                        <div className="acoes">
                            {resposta.marcas.map((m) => (
                                <Botao key={m.id} variante="secundario" tamanho="p" onClick={() => aoUsar(m)}>Usar {m.nome}</Botao>
                            ))}
                            {resposta.tipo === "parecida" && (
                                <Botao variante="fantasma" tamanho="p" onClick={() => propor(true)}>É outra marca, propor mesmo assim</Botao>
                            )}
                        </div>
                    )}
                </Aviso>
            )}
        </div>
    );
}
