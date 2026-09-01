import { BrowserProvider } from "ethers";
import { hashDoArquivo } from "./hash";

function lerComoBase64(arquivo) {
    return new Promise((resolve, rejeitar) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result.split(",")[1]);
        leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
        leitor.readAsDataURL(arquivo);
    });
}

// Envio: o arquivo vai para o servidor, que o guarda no Pinata.
// O navegador recebe de volta apenas o hash - nunca o CID.
export async function enviarDocumento(arquivo, chassi) {
    const hash = await hashDoArquivo(arquivo);
    const conteudoBase64 = await lerComoBase64(arquivo);

    const resposta = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            nomeArquivo: arquivo.name,
            tipo: arquivo.type,
            conteudoBase64,
            chassi,
            hash
        })
    });

    if (!resposta.ok) throw new Error("O envio do documento falhou.");
    return hash;
}

// Abertura: quem pede assina uma mensagem com a carteira; o servidor confere
// na propria blockchain se aquele endereco tem papel credenciado.
export async function abrirDocumento(hash) {
    if (!window.ethereum) throw new Error("Abrir o comprovante exige uma carteira credenciada.");

    const provedor = new BrowserProvider(window.ethereum);
    await provedor.send("eth_requestAccounts", []);
    const assinante = await provedor.getSigner();

    const emitidoEm = Date.now();
    const mensagem = `KmChain: acesso ao documento ${hash} em ${emitidoEm}`;
    const assinatura = await assinante.signMessage(mensagem);

    const resposta = await fetch("/api/documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, emitidoEm, assinatura })
    });

    if (resposta.status === 403) throw new Error("Esta carteira não tem permissão para abrir o documento.");
    if (!resposta.ok) throw new Error("Não foi possível abrir o documento.");

    const { url } = await resposta.json();
    window.open(url, "_blank");
}