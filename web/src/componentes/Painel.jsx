import { useEffect, useRef, useState } from "react";
import { useAcesso } from "../lib/acesso";
import { contratoImplantado } from "../lib/blockchain";
import { rotuloDaOrganizacao } from "../lib/eventos";
import { encurtar, saudacao } from "../lib/formato";
import { irPara, linkPara } from "../lib/rota";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Copiar from "../ui/Copiar";
import Icone from "../ui/Icone";
import Pagina from "../ui/Pagina";
import Auditoria from "./Auditoria";
import Autenticacao from "./Autenticacao";
import Cabecalho from "./Cabecalho";
import CadastroVeiculo from "./CadastroVeiculo";
import ConsultaVeiculo from "./ConsultaVeiculo";
import DadosComplementares from "./DadosComplementares";
import MarcasPropostas from "./MarcasPropostas";
import RegistroEvento from "./RegistroEvento";
import RegistrosDaOrganizacao from "./RegistrosDaOrganizacao";
import Correcoes from "./correcoes/Correcoes";
import Equipe from "./organizacoes/Equipe";
import Organizacoes from "./organizacoes/Organizacoes";

const SECOES_AMPLAS = ["consulta", "correcoes", "registros", "equipe", "organizacoes", "complementares", "auditoria"];

// Secoes do painel conforme o vinculo: o tipo da organizacao define os
// eventos e as acoes; o DETRAN tem as funcoes administrativas. E so o que a
// tela oferece - o servidor e o contrato conferem cada operacao.
function secoesDoPainel({ operante, ehDetran, ehAdministrador, vinculo }) {
    return [
        { id: "inicio", rotulo: "Início", pode: true },
        { id: "consulta", rotulo: "Consultar", pode: true,
            titulo: "Consultar veículo", descricao: "Veja o histórico de quilometragem de um chassi." },
        { id: "registro", rotulo: "Novo registro", pode: operante,
            titulo: "Novo registro", descricao: ehDetran
                ? "Registre um evento institucional do DETRAN com a quilometragem do veículo."
                : `Registre um evento de ${rotuloDaOrganizacao(vinculo.tipo).toLowerCase()} com a quilometragem do veículo.` },
        { id: "cadastro", rotulo: "Cadastrar veículo", pode: operante && ehDetran,
            titulo: "Cadastrar veículo", descricao: "Inclua um veículo com o primeiro registro e os dados do proprietário." },
        { id: "correcoes", rotulo: "Correções", pode: operante,
            titulo: "Correções", descricao: ehDetran
                ? "Analise as solicitações das organizações. O registro original nunca é alterado."
                : "Solicite ao DETRAN a correção de um registro e acompanhe a decisão." },
        { id: "registros", rotulo: "Registros", pode: operante,
            titulo: ehDetran ? "Registros de todas as organizações" : "Registros da organização",
            descricao: "Eventos registrados, com data, local e responsável." },
        { id: "equipe", rotulo: "Equipe", pode: operante && ehAdministrador,
            titulo: "Equipe", descricao: "Vincule, ative e desative os funcionários da sua organização." },
        { id: "organizacoes", rotulo: "Organizações", pode: operante && ehDetran,
            titulo: "Organizações", descricao: "Cadastre, credencie e suspenda oficinas, empresas de vistoria e seguradoras." },
        { id: "complementares", rotulo: "Dados complementares", pode: operante && ehDetran,
            titulo: "Dados complementares", descricao: "Dados do veículo mantidos fora da blockchain: identificação, placa, UF, proprietário e quem realizou cada registro." },
        { id: "auditoria", rotulo: "Auditoria", pode: operante && ehDetran,
            titulo: "Auditoria", descricao: "Ações administrativas registradas no KMChain." }
    ].filter((s) => s.pode);
}

// Area institucional, atras de duas camadas: login e senha (conta no banco)
// e a carteira dessa conta com vinculo ativo numa organizacao (no contrato).
export default function Painel({ secao }) {
    const acesso = useAcesso();
    const { usuario, organizacao, conta, vinculo, vinculada, liberado, operante, ehAdministrador } = acesso;
    const [chassiConsulta, setChassiConsulta] = useState("");

    const secoes = secoesDoPainel(acesso);

    // Se o vinculo deixar de dar acesso a secao aberta (ex.: trocou de conta
    // na extensao), volta ao inicio em vez de travar a tela.
    useEffect(() => {
        if (liberado && !secoes.some((s) => s.id === secao)) irPara("inicio", { substituir: true });
    });

    async function sairDaConta() {
        await acesso.encerrar();
        irPara("inicio", { substituir: true });
    }

    function verHistorico(chassi) {
        setChassiConsulta(chassi);
        irPara("consulta");
    }

    const papel = vinculo.ativo ? `${organizacao?.nome_fantasia ?? rotuloDaOrganizacao(vinculo.tipo)} · ${ehAdministrador ? "Administrador" : "Funcionário"}` : "";
    const infoConta = usuario && <InfoConta usuario={usuario} conta={conta} papel={papel} aoSair={sairDaConta} />;

    let conteudo;
    if (acesso.carregandoSessao) {
        conteudo = <div className="pagina pagina-estreita"><div className="esqueleto-linha esqueleto-titulo" style={{ width: "60%" }} /></div>;
    } else if (!usuario) {
        conteudo = <Autenticacao aoAutenticar={acesso.aoAutenticar} />;
    } else if (!liberado) {
        conteudo = <EtapasAcesso acesso={acesso} />;
    } else {
        const atual = secoes.find((s) => s.id === secao);
        conteudo = (
            <>
                {!vinculo.organizacaoAtiva && (
                    <div className="conteiner faixa-aviso">
                        <Aviso tipo="alerta" titulo="Credenciamento suspenso">
                            O DETRAN suspendeu o credenciamento da sua organização. Novos registros estão bloqueados; os
                            eventos já registrados continuam no histórico.
                        </Aviso>
                    </div>
                )}
                {!vinculada && (
                    <div className="conteiner faixa-aviso">
                        <Aviso
                            tipo={acesso.avisoVinculo?.tipo === "erro" ? "erro" : "info"}
                            acao={<Botao variante="secundario" tamanho="p" carregando={acesso.vinculando} onClick={acesso.vincular}>{usuario.carteira ? "Vincular esta carteira" : "Vincular agora"}</Botao>}
                        >
                            {acesso.avisoVinculo?.tipo === "erro"
                                ? acesso.avisoVinculo.texto
                                : usuario.carteira
                                    ? <>A carteira conectada não é a vinculada à sua conta (<span className="mono">{encurtar(usuario.carteira)}</span>). Troque de conta na MetaMask para registrar, ou vincule esta carteira no lugar da anterior.</>
                                    : "Esta carteira ainda não está vinculada à sua conta. Vincule para registrar eventos e enviar comprovantes: o vínculo identifica quem realizou cada registro."}
                        </Aviso>
                    </div>
                )}

                {secao === "inicio" && (
                    <Inicio usuario={usuario} conta={conta} organizacao={organizacao} vinculo={vinculo} papel={papel} vinculada={vinculada}
                        secoes={secoes.filter((s) => s.id !== "inicio")} podeRegistrar={operante} />
                )}
                {atual && secao !== "inicio" && (
                    <Pagina titulo={atual.titulo} descricao={atual.descricao} largura={SECOES_AMPLAS.includes(secao) ? "ampla" : "media"}>
                        {secao === "consulta" && <ConsultaVeiculo key={chassiConsulta} institucional chassiInicial={chassiConsulta} />}
                        {secao === "registro" && <RegistroEvento acesso={acesso} aoVerHistorico={verHistorico} />}
                        {secao === "cadastro" && <CadastroVeiculo acesso={acesso} aoVerHistorico={verHistorico} />}
                        {secao === "correcoes" && <Correcoes acesso={acesso} aoVerHistorico={verHistorico} />}
                        {secao === "registros" && <RegistrosDaOrganizacao acesso={acesso} aoVerHistorico={verHistorico} />}
                        {secao === "equipe" && <Equipe usuario={usuario} />}
                        {secao === "organizacoes" && <Organizacoes usuario={usuario} />}
                        {secao === "complementares" && <DadosComplementares />}
                        {secao === "auditoria" && <div className="empilhado"><Auditoria />{ehAdministrador && <MarcasPropostas />}</div>}
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

function InfoConta({ usuario, conta, papel, aoSair }) {
    return (
        <div className="info-conta">
            <p className="info-conta-nome">{usuario.nome}</p>
            <p className="info-conta-email">{usuario.email}</p>
            {conta && (
                <p className="info-conta-carteira">
                    <Icone nome="carteira" tamanho={15} />
                    <span className="mono">{encurtar(conta)}</span>
                    {papel && <span>· {papel}</span>}
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

function Inicio({ usuario, conta, organizacao, vinculo, papel, vinculada, secoes, podeRegistrar }) {
    const primeiroNome = usuario.nome.trim().split(/\s+/)[0];

    return (
        <Pagina
            titulo={`${saudacao()}, ${primeiroNome}`}
            descricao={papel}
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
                        <div><dt>Organização</dt><dd>{organizacao?.nome_fantasia ?? "—"}<span className="celula-secundaria">{rotuloDaOrganizacao(vinculo.tipo)}</span></dd></div>
                        <div><dt>Papel</dt><dd>{vinculo.administrador ? "Administrador" : "Funcionário"}</dd></div>
                        <div>
                            <dt>Carteira</dt>
                            <dd><span className="mono">{encurtar(conta)}</span><Copiar texto={conta} rotulo="Copiar carteira" /></dd>
                        </div>
                        <div><dt>Vínculo</dt><dd>{vinculada ? "Carteira vinculada à conta" : "Carteira não vinculada"}</dd></div>
                    </dl>
                </section>
            </div>
        </Pagina>
    );
}

// Tela entre o login e o painel: conectar a carteira e aguardar o vinculo
// com uma organizacao.
function EtapasAcesso({ acesso }) {
    const { usuario, conta, verificando, conectando, erroCarteira, vinculada, vinculando, avisoVinculo } = acesso;
    const titulo = !conta
        ? "Conecte a sua carteira"
        : verificando ? "Verificando o vínculo" : "Aguardando vínculo com uma organização";

    return (
        <Pagina titulo={titulo} descricao="O acesso institucional tem três etapas." largura="estreita">
            {!contratoImplantado && (
                <Aviso tipo="alerta" titulo="Contrato ainda não implantado">
                    O contrato do KMChain ainda não foi implantado nesta rede. A consulta e o painel institucional
                    ficam disponíveis depois do deploy.
                </Aviso>
            )}
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
                                <p className="etapa-texto">A carteira assina os registros que você fizer pela sua organização. Usamos a MetaMask.</p>
                                <Botao icone="carteira" carregando={conectando} onClick={acesso.conectar}>
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
                        <p className="etapa-titulo">Vínculo com a organização</p>
                        {!conta && (
                            <p className="etapa-texto">O DETRAN credencia a organização e define o administrador; o administrador vincula os funcionários.</p>
                        )}
                        {conta && verificando && <p className="etapa-texto">Verificando o vínculo desta carteira…</p>}
                        {conta && !verificando && (
                            <>
                                <p className="etapa-texto">
                                    Esta carteira ainda não está vinculada a uma organização. Vincule-a à sua conta e
                                    informe o seu e-mail ao administrador da sua organização. Se você é o
                                    administrador indicado, informe-o ao DETRAN.
                                </p>
                                <p className="carteira-destaque">
                                    <span className="mono quebra">{usuario.email}</span>
                                    <Copiar texto={usuario.email} rotulo="Copiar e-mail da conta" />
                                </p>
                                {!vinculada && (
                                    <Botao variante="secundario" carregando={vinculando} onClick={acesso.vincular}>
                                        Vincular esta carteira à minha conta
                                    </Botao>
                                )}
                                {vinculada && <Botao variante="secundario" onClick={acesso.recarregar}>Verificar de novo</Botao>}
                                {avisoVinculo && <Aviso tipo={avisoVinculo.tipo}>{avisoVinculo.texto}</Aviso>}
                            </>
                        )}
                    </div>
                </li>
            </ol>
        </Pagina>
    );
}
