import { useState } from "react";
import { criarConta, entrar } from "../lib/auth";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Primeira camada do painel institucional: login e senha, guardados no banco.
// Criar a conta aqui NAO da acesso a nada - so cadastra o login. O acesso vem
// do vinculo da carteira da pessoa com uma organizacao: o DETRAN define o
// administrador de cada organizacao, e o administrador vincula os funcionarios.
export default function Autenticacao({ aoAutenticar }) {
    const [modo, setModo] = useState("entrar"); // entrar | criar
    const [nome, setNome] = useState("");
    const [email, setEmail] = useState("");
    const [senha, setSenha] = useState("");
    const [confirmarSenha, setConfirmarSenha] = useState("");
    const [erros, setErros] = useState({});
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState("");
    const criando = modo === "criar";

    function trocarModo(novoModo) {
        setModo(novoModo);
        setErro("");
        setErros({});
    }

    function validar() {
        const novos = {};
        if (criando && nome.trim().length < 2) novos.nome = "Informe seu nome.";
        if (!EMAIL.test(email.trim())) novos.email = "Informe um e-mail válido.";
        if (criando && senha.length < 8) novos.senha = "A senha precisa ter pelo menos 8 caracteres.";
        if (!criando && !senha) novos.senha = "Informe sua senha.";
        if (criando && senha !== confirmarSenha) novos.confirmarSenha = "As senhas não coincidem.";
        setErros(novos);
        if (Object.keys(novos).length > 0) focarPrimeiroErro();
        return Object.keys(novos).length === 0;
    }

    async function enviar(e) {
        e.preventDefault();
        setErro("");
        if (!validar()) return;

        setEnviando(true);
        try {
            const emailLimpo = email.trim().toLowerCase();
            const { usuario } = criando
                ? await criarConta(nome, emailLimpo, senha)
                : await entrar(emailLimpo, senha);
            aoAutenticar(usuario);
        } catch (falha) {
            setErro(mensagemDeErro(falha, "Não foi possível entrar. Tente novamente."));
        } finally {
            setEnviando(false);
        }
    }

    return (
        <div className="acesso">
            <h1 className="pagina-titulo">Acesso institucional</h1>
            <p className="pagina-descricao">Para o DETRAN e as organizações credenciadas: oficinas, empresas de vistoria e seguradoras.</p>

            <div className="painel acesso-painel">
                <div className="segmentos" role="group" aria-label="Tipo de acesso">
                    <button type="button" aria-pressed={!criando} onClick={() => trocarModo("entrar")}>Entrar</button>
                    <button type="button" aria-pressed={criando} onClick={() => trocarModo("criar")}>Criar conta</button>
                </div>

                <form onSubmit={enviar} noValidate className="formulario-empilhado">
                    {criando && (
                        <Campo rotulo="Nome completo" erro={erros.nome}>
                            <input value={nome} autoComplete="name" onChange={(e) => setNome(e.target.value)} />
                        </Campo>
                    )}
                    <Campo rotulo="E-mail" erro={erros.email}>
                        <input type="email" value={email} autoComplete="email" inputMode="email"
                            onChange={(e) => setEmail(e.target.value)} />
                    </Campo>
                    <Campo rotulo="Senha" erro={erros.senha} ajuda={criando && !erros.senha ? "Mínimo de 8 caracteres." : undefined}>
                        <input type="password" value={senha} autoComplete={criando ? "new-password" : "current-password"}
                            onChange={(e) => setSenha(e.target.value)} />
                    </Campo>
                    {criando && (
                        <Campo rotulo="Confirmar senha" erro={erros.confirmarSenha}>
                            <input type="password" value={confirmarSenha} autoComplete="new-password"
                                onChange={(e) => setConfirmarSenha(e.target.value)} />
                        </Campo>
                    )}

                    {erro && <Aviso tipo="erro">{erro}</Aviso>}

                    <Botao type="submit" largo carregando={enviando}>
                        {criando ? "Criar conta" : "Entrar"}
                    </Botao>
                </form>
            </div>

            <p className="acesso-nota">
                {criando
                    ? "Depois de criar a conta, conecte e vincule a sua carteira. O acesso é liberado quando o administrador da sua organização (ou o DETRAN, se você for o administrador) vincular a sua conta."
                    : "O acesso tem duas etapas: login e a carteira vinculada a uma organização credenciada no KMChain. Quem só quer consultar um veículo não precisa de conta."}
            </p>
        </div>
    );
}
