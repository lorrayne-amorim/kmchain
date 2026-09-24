import { useState } from "react";
import { criarConta, entrar } from "../lib/auth";

// Primeira camada do painel profissional: login e senha, guardados no banco.
// Criar a conta aqui NAO credencia ninguem em cadeia nem define o que a
// pessoa representa - so cadastra o login. Quem decide a funcao (oficina,
// vistoria ou DETRAN) e o DETRAN, depois, pela carteira que a pessoa vincular.
export default function Autenticacao({ aoAutenticar }) {
    const [modo, setModo] = useState("entrar"); // entrar | criar
    const [nome, setNome] = useState("");
    const [email, setEmail] = useState("");
    const [senha, setSenha] = useState("");
    const [confirmarSenha, setConfirmarSenha] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState("");

    function trocarModo(novoModo) {
        setModo(novoModo);
        setErro("");
    }

    async function enviar(e) {
        e.preventDefault();
        setErro("");

        if (modo === "criar" && senha !== confirmarSenha) {
            return setErro("As senhas não coincidem.");
        }

        setEnviando(true);
        try {
            const { usuario } =
                modo === "entrar"
                    ? await entrar(email.trim().toLowerCase(), senha)
                    : await criarConta(nome, email.trim().toLowerCase(), senha);
            aoAutenticar(usuario);
        } catch (erro) {
            setErro(erro.message);
        } finally {
            setEnviando(false);
        }
    }

    return (
        <section className="autenticacao">
            <h2>{modo === "entrar" ? "Entrar" : "Criar conta"}</h2>
            <p>
                {modo === "entrar"
                    ? "Login da sua entidade no KmChain."
                    : "Cadastre seu login. Depois, vincule sua carteira: o DETRAN é quem define a função da sua entidade."}
            </p>

            <form onSubmit={enviar}>
                {modo === "criar" && (
                    <input placeholder="Nome completo" value={nome}
                        onChange={(e) => setNome(e.target.value)} required />
                )}
                <input type="email" placeholder="E-mail" value={email}
                    onChange={(e) => setEmail(e.target.value)} required />
                <input type="password" placeholder="Senha" value={senha} minLength={8}
                    onChange={(e) => setSenha(e.target.value)} required />
                {modo === "criar" && (
                    <input type="password" placeholder="Confirmar senha" value={confirmarSenha}
                        onChange={(e) => setConfirmarSenha(e.target.value)} required />
                )}

                {erro && <p className="erro">{erro}</p>}

                <button type="submit" disabled={enviando}>
                    {enviando ? "Enviando..." : modo === "entrar" ? "Entrar" : "Criar conta"}
                </button>
            </form>

            <p className="troca-modo">
                {modo === "entrar" ? (
                    <>Ainda não tem conta? <button className="link" onClick={() => trocarModo("criar")}>Criar conta</button></>
                ) : (
                    <>Já tem conta? <button className="link" onClick={() => trocarModo("entrar")}>Entrar</button></>
                )}
            </p>
        </section>
    );
}
