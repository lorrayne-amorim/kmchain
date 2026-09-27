// Cabecalho de pagina da area institucional + largura do conteudo.
// largura: estreita (formularios curtos) | media (formularios) | ampla (tabelas)
export default function Pagina({ titulo, descricao, acoes, largura = "ampla", children }) {
    return (
        <div className={`pagina pagina-${largura}`}>
            <div className="pagina-cabecalho">
                <div>
                    <h1 className="pagina-titulo">{titulo}</h1>
                    {descricao && <p className="pagina-descricao">{descricao}</p>}
                </div>
                {acoes && <div className="pagina-acoes">{acoes}</div>}
            </div>
            {children}
        </div>
    );
}

export function Vazio({ titulo, children, acao }) {
    return (
        <div className="vazio">
            <p className="vazio-titulo">{titulo}</p>
            {children && <p className="vazio-texto">{children}</p>}
            {acao}
        </div>
    );
}
