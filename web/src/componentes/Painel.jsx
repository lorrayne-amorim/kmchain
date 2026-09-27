import { useEffect, useRef, useState } from "react";
import { conectarCarteira, contaConectada, papeisDaConta } from "../lib/blockchain";
import { usuarioLogado, sair, vincularCarteira } from "../lib/auth";
import { mensagemDeErro } from "../lib/erros";
import { encurtar, rotulosPapel, saudacao } from "../lib/formato";
import { irPara, linkPara } from "../lib/rota";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Copiar from "../ui/Copiar";
import Icone from "../ui/Icone";
import Pagina from "../ui/Pagina";
import Autenticacao from "./Autenticacao";
import Cabecalho from "./Cabecalho";
import CadastroVeiculo from "./CadastroVeiculo";
import ConsultaPrivada from "./ConsultaPrivada";
import ConsultaVeiculo from "./ConsultaVeiculo";
import CorrigirLeitura from "./CorrigirLeitura";
import CredenciarEntidade from "./CredenciarEntidade";
import RegistroLeitura from "./RegistroLeitura";

const SEM_PAPEIS = { admin: false, detran: false, vistoria: false, oficina: false };

// Area do DETRAN/vistoria/oficina, atras de duas camadas: login/senha
// (conta no banco) e, so depois, a carteira credenciada em cadeia pelo DETRAN.
// As secoes visiveis dependem das funcoes que a carteira tem no contrato.
export default function Painel({ secao }) {
    const [conta, setConta] = useState(null);
    const [papeis, setPapeis] = useState(SEM_PAPEIS);
    const [verificando, setVerificando] = useState(false);
    const [conectando, setConectando] = useState(false);
    const [erroCarteira, setErroCarteira] = useState("");

    const [usuario, setUsuario] = useState(null);
    const [carregandoSessao, setCarregandoSessao] = useState(true);
    const [vinculando, setVinculando] = useState(false);
    const [avisoVinculo, setAvisoVinculo] = useState(null); // { tipo, texto }
    const [chassiConsulta, setChassiConsulta] = useState("");

    async function atualizar(endereco) {
        setConta(endereco);
        if (!endereco) return setPapeis(SEM_PAPEIS);
        setVerificando(true);
        try {
            setPapeis(await papeisDaConta(endereco));
        } finally {
            setVerificando(false);
        }
    }

    // Reconecta sozinho se a carteira ja estava autorizada neste site,
    // e acompanha troca de conta feita direto na extensao.
    useEffect(() => {
        contaConectada().then(atualizar).catch(() => { });
        if (!window.ethereum) return;
        const aoTrocarConta = (contas) => atualizar(contas[0] ?? null).catch(() => { });
        window.ethereum.on("accountsChanged", aoTrocarConta);
        return () => window.ethereum.removeListener("accountsChanged", aoTrocarConta);
    }, []);

    // Sessao de login (primeira camada): quem esta logado ao abrir o site.
    useEffect(() => {
        usuarioLogado()
            .then(setUsuario)
            .catch(() => setUsuario(null))
            .finally(() => setCarregandoSessao(false));
    }, []);

    const credenciada = papeis.detran || papeis.vistoria || papeis.oficina;
    const liberado = Boolean(usuario && conta && !verificando && (credenciada || papeis.admin));

    const secoes = [
        { id: "inicio", rotulo: "Início", pode: true },
        { id: "consulta", rotulo: "Consultar", pode: true,
            titulo: "Consultar veículo", descricao: "Veja o histórico completo de quilometragem de um chassi." },
        { id: "registro", rotulo: "Novo registro", pode: credenciada,
            titulo: "Novo registro", descricao: "Registre a quilometragem de uma vistoria, revisão, transferência ou sinistro." },
        { id: "cadastro", rotulo: "Cadastrar veículo", pode: papeis.detran,
            titulo: "Cadastrar veículo", descricao: "Inclua um veículo com a quilometragem inicial e os dados do proprietário." },
        { id: "correcao", rotulo: "Correções", pode: papeis.detran,
            titulo: "Corrigir leitura", descricao: "Corrija uma leitura equivocada. A leitura original continua no histórico." },
        { id: "privado", rotulo: "Registros privados", pode: papeis.detran,
            titulo: "Registros privados", descricao: "Consulte placa, proprietário e o responsável por cada serviço." },
        { id: "credenciar", rotulo: "Acessos", pode: papeis.admin,
            titulo: "Acessos", descricao: "Conceda ou revogue funções de oficinas, centros de vistoria e DETRAN." }
    ].filter((s) => s.pode);

    // Se a carteira perder a funcao que dava acesso a secao aberta (ex.:
    // trocou de conta na extensao), volta ao inicio em vez de travar a tela.
    useEffect(() => {
        if (liberado && !secoes.some((s) => s.id === secao)) irPara("inicio", { substituir: true });
    });

    async function conectar() {
        setErroCarteira("");
        setConectando(true);
        try {
            await atualizar(await conectarCarteira());
        } catch (e) {
            setErroCarteira(mensagemDeErro(e, "Não foi possível conectar a carteira. Tente novamente."));
        } finally {
            setConectando(false);
        }
    }

    async function sairDaConta() {
        await sair();
        setUsuario(null);
        irPara("inicio", { substituir: true });
    }

    async function vincular() {
        setAvisoVinculo(null);
        setVinculando(true);
        try {
            await vincularCarteira(conta, usuario.email);
            setUsuario((u) => ({ ...u, carteira: conta }));
            setAvisoVinculo({ tipo: "sucesso", texto: "Carteira vinculada à sua conta." });
        } catch (e) {
            setAvisoVinculo({ tipo: "erro", texto: mensagemDeErro(e, "Não foi possível vincular a carteira.") });
        } finally {
            setVinculando(false);
        }
    }

    function verHistorico(chassi) {
        setChassiConsulta(chassi);
        irPara("consulta");
    }

    const vinculada = Boolean(usuario?.carteira && conta && usuario.carteira.toLowerCase() === conta.toLowerCase());
    const infoConta = usuario && (
        <InfoConta usuario={usuario} conta={conta} papeis={papeis} aoSair={sairDaConta} />
    );

    let conteudo;
    if (carregandoSessao) {
        conteudo = <div className="pagina pagina-estreita"><div className="esqueleto-linha esqueleto-titulo" style={{ width: "60%" }} /></div>;
    } else if (!usuario) {
        conteudo = <Autenticacao aoAutenticar={setUsuario} />;
    } else if (!liberado) {
        conteudo = (
            <EtapasAcesso
                usuario={usuario}
                conta={conta}
                verificando={verificando}
                conectando={conectando}
                erroCarteira={erroCarteira}
                aoConectar={conectar}
                vinculada={vinculada}
                vinculando={vinculando}
                aoVincular={vincular}
                avisoVinculo={avisoVinculo}
            />
        );
    } else {
        const atual = secoes.find((s) => s.id === secao);
        conteudo = (
            <>
                {!vinculada && (
                    <div className="conteiner faixa-aviso">
                        <Aviso
                            tipo={avisoVinculo?.tipo === "erro" ? "erro" : "info"}
                            acao={<Botao variante="secundario" tamanho="p" carregando={vinculando} onClick={vincular}>Vincular agora</Botao>}
                        >
                            {avisoVinculo?.tipo === "erro"
                                ? avisoVinculo.texto
                                : "Esta carteira ainda não está vinculada à sua conta. O vínculo identifica quem realizou cada registro."}
                        </Aviso>
                    </div>
                )}
                {avisoVinculo?.tipo === "sucesso" && vinculada && (
                    <div className="conteiner faixa-aviso"><Aviso tipo="sucesso">{avisoVinculo.texto}</Aviso></div>
                )}

                {secao === "inicio" && (
                    <Inicio usuario={usuario} conta={conta} papeis={papeis} vinculada={vinculada}
                        secoes={secoes.filter((s) => s.id !== "inicio")} podeRegistrar={credenciada} />
                )}
                {atual && secao !== "inicio" && (
                    <Pagina
                        titulo={atual.titulo}
                        descricao={atual.descricao}
                        largura={secao === "consulta" || secao === "privado" || secao === "credenciar" ? "ampla" : "media"}
                    >
                        {secao === "consulta" && <ConsultaVeiculo key={chassiConsulta} institucional chassiInicial={chassiConsulta} />}
                        {secao === "registro" && <RegistroLeitura usuario={usuario} conta={conta} aoVerHistorico={verHistorico} />}
                        {secao === "cadastro" && <CadastroVeiculo usuario={usuario} conta={conta} aoVerHistorico={verHistorico} />}
                        {secao === "correcao" && <CorrigirLeitura aoVerHistorico={verHistorico} />}
                        {secao === "privado" && <ConsultaPrivada />}
                        {secao === "credenciar" && <CredenciarEntidade />}
                    </Pagina>
                )}
            </>
        );
    }

    return (
        <>
            <Cabecalho
                inicio={linkPara("inicio")}
                rotulo="Institucional"
                navegacao={liberado ? secoes.map((s) => ({ id: s.id, rotulo: s.rotulo, href: linkPara(s.id), atual: s.id === secao })) : null}
                acoes={usuario
                    ? <MenuConta usuario={usuario}>{infoConta}</MenuConta>
                    : <a className="botao botao-fantasma botao-p" href="#/"><Icone nome="voltar" />Consulta pública</a>}
                menuMovel={infoConta}
            />
            <main id="conteudo" className="institucional" tabIndex={-1}>{conteudo}</main>
        </>
    );
}

function InfoConta({ usuario, conta, papeis, aoSair }) {
    const funcoes = rotulosPapel(papeis);
    return (
        <div className="info-conta">
            <p className="info-conta-nome">{usuario.nome}</p>
            <p className="info-conta-email">{usuario.email}</p>
            {conta && (
                <p className="info-conta-carteira">
                    <Icone nome="carteira" tamanho={15} />
                    <span className="mono">{encurtar(conta)}</span>
                    {funcoes.length > 0 && <span>· {funcoes.join(", ")}</span>}
                </p>
            )}
            <div className="info-conta-acoes">
                <a className="botao botao-fantasma botao-p" href="#/">Consulta pública</a>
                <Botao variante="fantasma" tamanho="p" icone="sair" onClick={aoSair}>Sair</Botao>
            </div>
        </div>
    );
}

function MenuConta({ usuario, children }) {
    const [aberto, setAberto] = useState(false);
    const caixa = useRef(null);

    useEffect(() => {
        if (!aberto) return;
        const aoClicar = (e) => !caixa.current?.contains(e.target) && setAberto(false);
        const aoTeclar = (e) => e.key === "Escape" && setAberto(false);
        document.addEventListener("mousedown", aoClicar);
        document.addEventListener("keydown", aoTeclar);
        return () => {
            document.removeEventListener("mousedown", aoClicar);
            document.removeEventListener("keydown", aoTeclar);
        };
    }, [aberto]);

    return (
        <div className="menu-conta" ref={caixa}>
            <button type="button" className="menu-conta-botao" aria-expanded={aberto} aria-haspopup="true" onClick={() => setAberto((v) => !v)}>
                <span className="menu-conta-inicial" aria-hidden="true">{usuario.nome.trim().charAt(0).toUpperCase()}</span>
                <span className="menu-conta-nome">{usuario.nome}</span>
                <Icone nome="baixo" tamanho={16} />
            </button>
            {aberto && <div className="menu-conta-painel">{children}</div>}
        </div>
    );
}

function Inicio({ usuario, conta, papeis, vinculada, secoes, podeRegistrar }) {
    const primeiroNome = usuario.nome.trim().split(/\s+/)[0];
    const funcoes = rotulosPapel(papeis);

    return (
        <Pagina
            titulo={`${saudacao()}, ${primeiroNome}`}
            descricao={funcoes.join(" · ")}
            acoes={podeRegistrar && (
                <a className="botao botao-primario" href={linkPara("registro")}><Icone nome="mais" />Novo registro</a>
            )}
        >
            <div className="inicio-grade">
                <section aria-labelledby="titulo-tarefas">
                    <h2 id="titulo-tarefas" className="secao-rotulo">O que você precisa fazer?</h2>
                    <ul className="lista-tarefas">
                        {secoes.map((s) => (
                            <li key={s.id}>
                                <a href={linkPara(s.id)}>
                                    <span>
                                        <span className="tarefa-titulo">{s.titulo}</span>
                                        <span className="tarefa-descricao">{s.descricao}</span>
                                    </span>
                                    <Icone nome="direita" />
                                </a>
                            </li>
                        ))}
                    </ul>
                </section>

                <section aria-labelledby="titulo-conta" className="inicio-conta">
                    <h2 id="titulo-conta" className="secao-rotulo">Sua conta</h2>
                    <dl className="lista-dados">
                        <div><dt>Nome</dt><dd>{usuario.nome}</dd></div>
                        <div><dt>E-mail</dt><dd className="quebra">{usuario.email}</dd></div>
                        <div>
                            <dt>Carteira</dt>
                            <dd><span className="mono">{encurtar(conta)}</span><Copiar texto={conta} rotulo="Copiar carteira" /></dd>
                        </div>
                        <div><dt>Funções</dt><dd>{funcoes.join(", ")}</dd></div>
                        <div><dt>Vínculo</dt><dd>{vinculada ? "Carteira vinculada à conta" : "Carteira não vinculada"}</dd></div>
                    </dl>
                </section>
            </div>
        </Pagina>
    );
}

// Tela entre o login e o painel: conectar a carteira e aguardar a funcao.
function EtapasAcesso({
    usuario, conta, verificando, conectando, erroCarteira, aoConectar,
    vinculada, vinculando, aoVincular, avisoVinculo
}) {
    const titulo = !conta
        ? "Conecte a carteira da entidade"
        : verificando ? "Verificando credenciais" : "Aguardando credenciamento";

    return (
        <Pagina titulo={titulo} descricao="O acesso institucional tem três etapas." largura="estreita">
            <ol className="etapas painel">
                <li className="etapa-feita">
                    <span className="etapa-marcador" aria-hidden="true"><Icone nome="check" tamanho={12} /></span>
                    <div>
                        <p className="etapa-titulo">Conta</p>
                        <p className="etapa-texto">Conectado como {usuario.email}.</p>
                    </div>
                </li>

                <li className={conta ? "etapa-feita" : "etapa-atual"}>
                    <span className="etapa-marcador" aria-hidden="true">{conta && <Icone nome="check" tamanho={12} />}</span>
                    <div>
                        <p className="etapa-titulo">Carteira</p>
                        {conta ? (
                            <p className="etapa-texto">
                                Carteira <span className="mono">{encurtar(conta)}</span> conectada.
                            </p>
                        ) : (
                            <>
                                <p className="etapa-texto">A carteira identifica sua entidade ao registrar leituras. Usamos a MetaMask.</p>
                                <Botao icone="carteira" carregando={conectando} onClick={aoConectar}>
                                    {conectando ? "Conectando…" : "Conectar carteira"}
                                </Botao>
                                {erroCarteira && <Aviso tipo="erro">{erroCarteira}</Aviso>}
                            </>
                        )}
                    </div>
                </li>

                <li className={conta ? "etapa-atual" : ""}>
                    <span className="etapa-marcador" aria-hidden="true">
                        {conta && verificando && <Icone nome="carregando" tamanho={12} className="girando" />}
                    </span>
                    <div>
                        <p className="etapa-titulo">Credenciamento</p>
                        {!conta && (
                            <p className="etapa-texto">O DETRAN define a função da entidade: oficina, centro de vistoria ou DETRAN.</p>
                        )}
                        {conta && verificando && <p className="etapa-texto">Verificando as funções desta carteira…</p>}
                        {conta && !verificando && (
                            <>
                                <p className="etapa-texto">
                                    Esta carteira ainda não tem uma função atribuída. Informe o endereço abaixo ao
                                    DETRAN, que define se a entidade é oficina, centro de vistoria ou DETRAN.
                                </p>
                                <p className="carteira-destaque">
                                    <span className="mono quebra">{conta}</span>
                                    <Copiar texto={conta} rotulo="Copiar endereço da carteira" />
                                </p>
                                {!vinculada && (
                                    <Botao variante="secundario" carregando={vinculando} onClick={aoVincular}>
                                        Vincular esta carteira à minha conta
                                    </Botao>
                                )}
                                {avisoVinculo && <Aviso tipo={avisoVinculo.tipo}>{avisoVinculo.texto}</Aviso>}
                            </>
                        )}
                    </div>
                </li>
            </ol>
        </Pagina>
    );
}
