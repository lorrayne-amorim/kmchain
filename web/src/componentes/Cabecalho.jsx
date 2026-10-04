import { useEffect, useState } from "react";
import Icone from "../ui/Icone";

// Cabecalho unico do produto. Na area institucional recebe `navegacao`:
// no desktop vira uma linha de abas; no celular, um menu recolhivel.
export default function Cabecalho({ inicio = "#/", rotulo, acoes, navegacao, menuMovel }) {
    const [menuAberto, setMenuAberto] = useState(false);
    const temNavegacao = navegacao?.length > 0;

    useEffect(() => {
        const fechar = () => setMenuAberto(false);
        window.addEventListener("hashchange", fechar);
        return () => window.removeEventListener("hashchange", fechar);
    }, []);

    useEffect(() => {
        if (!menuAberto) return;
        const aoTeclar = (e) => e.key === "Escape" && setMenuAberto(false);
        window.addEventListener("keydown", aoTeclar);
        return () => window.removeEventListener("keydown", aoTeclar);
    }, [menuAberto]);

    const itens = navegacao?.map((item) => (
        <li key={item.id}>
            <a href={item.href} aria-current={item.atual ? "page" : undefined}>{item.rotulo}</a>
        </li>
    ));

    return (
        <header className="cabecalho">
            <div className="conteiner cabecalho-barra">
                <a className="marca" href={inicio}>
                    <img className="marca-logo" src="/logo.png" alt="" width="55" height="36" />
                    <span className="marca-nome">KMChain</span>
                    {rotulo && <span className="marca-rotulo">{rotulo}</span>}
                </a>

                {acoes && <div className={`cabecalho-acoes ${temNavegacao ? "so-desktop" : ""}`}>{acoes}</div>}

                {temNavegacao && (
                    <button
                        type="button"
                        className="botao botao-fantasma botao-icone so-movel"
                        aria-expanded={menuAberto}
                        aria-controls="menu-movel"
                        aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
                        onClick={() => setMenuAberto((v) => !v)}
                    >
                        <Icone nome={menuAberto ? "fechar" : "menu"} tamanho={22} />
                    </button>
                )}
            </div>

            {temNavegacao && (
                <nav className="navegacao so-desktop" aria-label="Seções">
                    <ul className="conteiner">{itens}</ul>
                </nav>
            )}

            {temNavegacao && menuAberto && (
                <div id="menu-movel" className="menu-movel so-movel">
                    <nav aria-label="Seções"><ul>{itens}</ul></nav>
                    {menuMovel}
                </div>
            )}
        </header>
    );
}

export function Rodape() {
    return (
        <footer className="rodape">
            <div className="conteiner rodape-conteudo">
                <p>KMChain · Histórico de quilometragem veicular · Protótipo acadêmico, sem vínculo com órgãos públicos</p>
                <a href="#/organizacoes">Organizações credenciadas</a>
                <a href="#/institucional">Acesso institucional</a>
            </div>
        </footer>
    );
}
