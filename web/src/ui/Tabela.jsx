// Tabela no desktop, lista no celular - a mesma informacao reorganizada,
// em vez de uma tabela larga espremida em 375px.
// colunas: [{ titulo, render(linha), classe? }]
export default function Tabela({ rotulo, colunas, linhas, chave, itemMovel }) {
    return (
        <>
            <div className="tabela-envoltorio">
                <table className="tabela">
                    <caption className="visualmente-oculto">{rotulo}</caption>
                    <thead>
                        <tr>
                            {colunas.map((c) => (
                                <th key={c.titulo} scope="col" className={c.classe}>{c.titulo}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {linhas.map((linha, i) => (
                            <tr key={chave(linha, i)}>
                                {colunas.map((c) => (
                                    <td key={c.titulo} className={c.classe}>{c.render(linha, i)}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <ul className="lista-movel" aria-label={rotulo}>
                {linhas.map((linha, i) => (
                    <li key={chave(linha, i)}>{itemMovel(linha, i)}</li>
                ))}
            </ul>
        </>
    );
}
