// SHA-256 do documento, calculado no proprio navegador.
// E ESTE valor que vai para a cadeia: ele prova o conteudo do arquivo
// sem revelar onde o arquivo esta guardado.
export async function hashDoArquivo(arquivo) {
    const conteudo = await arquivo.arrayBuffer();
    const resumo = await crypto.subtle.digest("SHA-256", conteudo);
    return (
        "0x" +
        Array.from(new Uint8Array(resumo))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
    );
}