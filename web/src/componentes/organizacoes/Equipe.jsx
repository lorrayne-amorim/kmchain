import { useCallback, useEffect, useState } from "react";
import { mensagemDeErro } from "../../lib/erros";
import { carteiraValida, encurtar } from "../../lib/formato";
import { definirFuncionario, listarFuncionarios, localizarConta } from "../../lib/organizacoes";
import { avisar } from "../../lib/toast";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo from "../../ui/Campo";
import { Vazio } from "../../ui/Pagina";
import Tabela from "../../ui/Tabela";
import { Progresso } from "../../ui/Transacao";

// Funcionarios de uma organizacao. O administrador vincula uma pessoa pelo
// e-mail da conta ou direto pela carteira (quem ainda nao tem conta entra na
// equipe ao vincular essa carteira) e ativa ou desativa cada um, assinando
// no contrato.
// Com `organizacaoId`, e a consulta do DETRAN a equipe de outra organizacao,
// sem acoes.
export default function Equipe({ organizacaoId, usuario }) {
    const somenteLeitura = Boolean(organizacaoId);
    const [equipe, setEquipe] = useState(null);
    const [erro, setErro] = useState("");
    const [email, setEmail] = useState("");
    const [erroEmail, setErroEmail] = useState("");
    const [passo, setPasso] = useState(null);
    const [alvo, setAlvo] = useState(null); // carteira em alteracao
    const [falha, setFalha] = useState("");

    const carregar = useCallback(async () => {
        setErro("");
        try {
            setEquipe(await listarFuncionarios(organizacaoId));
        } catch (e) {
            setErro(mensagemDeErro(e, "Não foi possível carregar a equipe."));
        }
    }, [organizacaoId]);

    useEffect(() => {
        const espera = setTimeout(carregar);
        return () => clearTimeout(espera);
    }, [carregar]);

    async function alterarVinculo(carteira, ativo, mensagem) {
        setFalha("");
        setAlvo(carteira);
        try {
            await definirFuncionario(carteira, ativo, setPasso);
            avisar(mensagem);
            await carregar();
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível atualizar o vínculo. Tente novamente."));
        } finally {
            setPasso(null);
            setAlvo(null);
        }
    }

    async function vincular(e) {
        e.preventDefault();
        setErroEmail("");
        setFalha("");
        const valor = email.trim();
        if (!valor) return setErroEmail("Informe o e-mail da conta ou a carteira do funcionário.");
        try {
            if (carteiraValida(valor)) {
                await alterarVinculo(valor, true, "Carteira vinculada à equipe.");
            } else {
                setPasso("localizando");
                const conta = await localizarConta(valor.toLowerCase());
                await alterarVinculo(conta.carteira, true, `${conta.nome} agora faz parte da equipe.`);
            }
            setEmail("");
        } catch (erroConta) {
            setErroEmail(mensagemDeErro(erroConta, "Não foi possível localizar a conta."));
            setPasso(null);
        }
    }

    const situacao = (f) => <span className={`etiqueta-status ${f.ativo ? "situacao-ativa" : "situacao-suspensa"}`}>{f.ativo ? "Ativo" : "Desativado"}</span>;
    const acoes = (f) => {
        if (somenteLeitura || f.papel === "administrador") return null;
        return f.ativo
            ? <Botao variante="fantasma" tamanho="p" className="texto-perigo" carregando={alvo === f.carteira} onClick={() => alterarVinculo(f.carteira, false, `${f.nome} foi desativado.`)}>Desativar</Botao>
            : <Botao variante="fantasma" tamanho="p" carregando={alvo === f.carteira} onClick={() => alterarVinculo(f.carteira, true, `${f.nome} foi reativado.`)}>Reativar</Botao>;
    };
    const papel = (f) => (f.papel === "administrador" ? "Administrador" : "Funcionário");
    // Quem tem conta e, depois, as carteiras vinculadas que ainda aguardam conta.
    const funcionarios = [
        ...(equipe?.funcionarios ?? []),
        ...(equipe?.aguardando ?? []).map((a) => ({ ...a, id: a.carteira, nome: "Aguardando criação de conta", email: "", ativo: true }))
    ];

    return (
        <div className="empilhado">
            {!somenteLeitura && (
                <form className="painel busca-linha" onSubmit={vincular} noValidate>
                    <Campo rotulo="Vincular funcionário" erro={erroEmail}
                        ajuda={erroEmail ? undefined : "E-mail de uma conta com carteira vinculada, ou o endereço da carteira (0x…) de quem ainda vai criar a conta. O vínculo é assinado por você no contrato."}>
                        <input value={email} placeholder="E-mail da conta ou carteira" autoComplete="off" spellCheck={false} onChange={(e) => setEmail(e.target.value)} />
                    </Campo>
                    <Botao type="submit" icone="mais" carregando={passo === "localizando"} disabled={Boolean(passo)}>Vincular</Botao>
                </form>
            )}
            {passo && passo !== "localizando" && <div className="painel"><Progresso passo={passo} /></div>}
            {falha && <Aviso tipo="erro">{falha}</Aviso>}
            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            <div className="painel painel-tabela">
                {equipe && <p className="painel-tabela-titulo">Equipe de {equipe.organizacao.nome_fantasia} · {funcionarios.filter((f) => f.ativo).length} ativos</p>}
                {equipe && funcionarios.length === 0 && <Vazio titulo="Nenhum funcionário vinculado" />}
                {funcionarios.length > 0 && (
                    <Tabela
                        rotulo="Equipe da organização"
                        linhas={funcionarios}
                        chave={(f) => f.id}
                        colunas={[
                            { titulo: "Nome", render: (f) => <>{f.nome}{f.email === usuario?.email && " (você)"}<span className="celula-secundaria">{f.email}</span></> },
                            { titulo: "Papel", render: papel },
                            { titulo: "Carteira", render: (f) => <span className="mono">{encurtar(f.carteira)}</span> },
                            { titulo: "Situação", render: situacao },
                            { titulo: "Ações", classe: "celula-acoes", render: acoes }
                        ]}
                        itemMovel={(f) => (
                            <div className="item-movel">
                                <div className="item-movel-topo">
                                    <span><strong>{f.nome}</strong><span className="celula-secundaria">{f.email}</span></span>
                                    {acoes(f)}
                                </div>
                                <p className="item-movel-linha">{situacao(f)} {papel(f)} · <span className="mono">{encurtar(f.carteira)}</span></p>
                            </div>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
