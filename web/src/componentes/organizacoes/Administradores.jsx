import { useCallback, useEffect, useState } from "react";
import { mensagemDeErro } from "../../lib/erros";
import { carteiraValida, encurtar } from "../../lib/formato";
import { definirAdministrador, definirCarteiraDaConta, listarFuncionarios, localizarConta } from "../../lib/organizacoes";
import { avisar } from "../../lib/toast";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo from "../../ui/Campo";
import { Progresso } from "../../ui/Transacao";

// Administradores de uma organizacao credenciada, definidos pelo DETRAN no
// contrato. Pode haver mais de um. Cada um e indicado pelo e-mail da conta ou
// direto pela carteira: quem ainda nao tem conta assume a administracao ao
// vincular essa carteira a conta que criar.
export default function Administradores({ organizacao, aoAlterar }) {
    const [administradores, setAdministradores] = useState(null);
    const [novo, setNovo] = useState("");
    const [erroNovo, setErroNovo] = useState("");
    const [trocando, setTrocando] = useState(null); // e-mail da conta cuja carteira esta sendo trocada
    const [novaCarteira, setNovaCarteira] = useState("");
    const [erroCarteira, setErroCarteira] = useState("");
    const [passo, setPasso] = useState(null);
    const [falha, setFalha] = useState("");

    const carregar = useCallback(async () => {
        try {
            const equipe = await listarFuncionarios(organizacao.id);
            setAdministradores([
                ...equipe.funcionarios.filter((f) => f.ativo && f.papel === "administrador"),
                ...equipe.aguardando.filter((a) => a.papel === "administrador")
            ]);
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível carregar os administradores."));
        }
    }, [organizacao.id]);

    useEffect(() => {
        const espera = setTimeout(carregar);
        return () => clearTimeout(espera);
    }, [carregar]);

    // Assina no contrato, recarrega a lista e avisa a tela que a equipe mudou.
    async function executar(operacao, mensagem) {
        setFalha("");
        try {
            await operacao();
            avisar(mensagem);
        } catch (e) {
            setFalha(mensagemDeErro(e, "Não foi possível concluir a operação. Tente novamente."));
        } finally {
            setPasso(null);
            await carregar();
            aoAlterar();
        }
    }

    async function adicionar(e) {
        e.preventDefault();
        setErroNovo("");
        const valor = novo.trim();
        if (!valor) return setErroNovo("Informe o e-mail da conta ou a carteira.");
        let carteira = valor;
        if (!carteiraValida(valor)) {
            try {
                carteira = (await localizarConta(valor.toLowerCase(), organizacao.id)).carteira;
            } catch (erro) {
                return setErroNovo(mensagemDeErro(erro, "Não foi possível localizar a conta."));
            }
        }
        await executar(() => definirAdministrador(organizacao, carteira, true, setPasso), "Administrador definido.");
        setNovo("");
    }

    async function trocarCarteira(e, administrador) {
        e.preventDefault();
        setErroCarteira("");
        const nova = novaCarteira.trim();
        if (!carteiraValida(nova)) return setErroCarteira("Informe o endereço com 0x e 40 caracteres.");
        try {
            await definirCarteiraDaConta(administrador.email, nova);
        } catch (erro) {
            return setErroCarteira(mensagemDeErro(erro, "Não foi possível gravar a carteira."));
        }
        setTrocando(null);
        setNovaCarteira("");
        // A carteira nova passa a administrar e a anterior deixa de administrar.
        await executar(async () => {
            await definirAdministrador(organizacao, nova, true, setPasso);
            await definirAdministrador(organizacao, administrador.carteira, false, setPasso);
        }, "Carteira do administrador atualizada no contrato.");
    }

    const unico = administradores?.length === 1;

    return (
        <section className="painel" aria-labelledby="titulo-administradores">
            <h2 id="titulo-administradores" className="painel-titulo">Administradores</h2>
            <p className="painel-texto">
                Vinculam e desativam os funcionários da organização. Quem deixa de administrar continua na equipe, como funcionário.
            </p>

            {administradores && (
                <ul className="datado-lista">
                    {administradores.map((a) => (
                        <li key={a.carteira}>
                            <span>
                                {a.nome ?? "Aguardando criação de conta"}
                                <span className="celula-secundaria">{a.email}</span>
                                <span className="celula-secundaria mono">{encurtar(a.carteira, 8, 6)}</span>
                            </span>
                            {!passo && (
                                <span className="acoes">
                                    {a.email && <Botao variante="fantasma" tamanho="p" onClick={() => { setTrocando(a.email); setNovaCarteira(""); setErroCarteira(""); }}>Trocar carteira</Botao>}
                                    <Botao variante="fantasma" tamanho="p" className="texto-perigo" disabled={unico}
                                        onClick={() => executar(() => definirAdministrador(organizacao, a.carteira, false, setPasso), "Administração retirada.")}>
                                        Retirar administração
                                    </Botao>
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {unico && <p className="campo-ajuda">A organização precisa de pelo menos um administrador: defina outro antes de retirar este.</p>}

            {administradores?.filter((a) => a.email === trocando).map((a) => (
                <form key={a.carteira} className="busca-linha" onSubmit={(e) => trocarCarteira(e, a)} noValidate>
                    <Campo rotulo={`Nova carteira de ${a.nome}`} erro={erroCarteira}
                        ajuda={erroCarteira ? undefined : "Você assina duas transações: a carteira nova passa a administrar e a anterior deixa de administrar."}>
                        <input className="mono" value={novaCarteira} placeholder="0x…" autoComplete="off" spellCheck={false}
                            onChange={(e) => setNovaCarteira(e.target.value)} />
                    </Campo>
                    <Botao type="submit">Gravar e assinar</Botao>
                    <Botao variante="fantasma" onClick={() => setTrocando(null)}>Cancelar</Botao>
                </form>
            ))}

            {falha && <Aviso tipo="erro">{falha}</Aviso>}
            {passo ? <Progresso passo={passo} /> : (
                <form className="busca-linha" onSubmit={adicionar} noValidate>
                    <Campo rotulo="Adicionar administrador" erro={erroNovo}
                        ajuda={erroNovo ? undefined : "E-mail de uma conta com carteira vinculada, ou o endereço da carteira (0x…) de quem ainda vai criar a conta."}>
                        <input value={novo} placeholder="E-mail da conta ou carteira" autoComplete="off" spellCheck={false}
                            onChange={(e) => setNovo(e.target.value)} />
                    </Campo>
                    <Botao type="submit" icone="mais">Definir administrador</Botao>
                </form>
            )}
        </section>
    );
}
