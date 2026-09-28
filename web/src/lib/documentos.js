import { assinarComCarteira, chamarApi } from "./api";
import { hashDoArquivo } from "./hash";
import { mensagemDocumento } from "./mensagens";

// Mesmo limite do servidor (a Vercel recusa corpos acima de 4,5 MB e o
// arquivo cresce 4/3 em base64).
export const TAMANHO_MAXIMO = 3 * 1024 * 1024;
const TIPOS_ACEITOS = ["application/pdf", "image/png", "image/jpeg"];

// Conferencia antecipada, so para avisar cedo; o servidor confere de novo
// pelo conteudo do arquivo.
export function problemaDoArquivo(arquivo) {
    if (!arquivo) return "";
    if (arquivo.size > TAMANHO_MAXIMO) return "O arquivo passa de 3 MB. Envie uma versão menor.";
    if (arquivo.type && !TIPOS_ACEITOS.includes(arquivo.type)) return "Envie o comprovante em PDF, PNG ou JPEG.";
    return "";
}

function lerComoBase64(arquivo) {
    return new Promise((resolve, rejeitar) => {
        const leitor = new FileReader();
        leitor.onload = () => resolve(leitor.result.split(",")[1]);
        leitor.onerror = () => rejeitar(new Error("Não foi possível ler o arquivo."));
        leitor.readAsDataURL(arquivo);
    });
}

// Envio: o arquivo vai para o servidor, que o cifra e guarda no IPFS.
// O navegador recebe de volta apenas o hash - nunca o CID.
export async function enviarDocumento(arquivo, chassi) {
    const problema = problemaDoArquivo(arquivo);
    if (problema) throw new Error(problema);

    const hash = await hashDoArquivo(arquivo);
    await chamarApi("upload", {
        corpo: { conteudoBase64: await lerComoBase64(arquivo), chassi, hash },
        padrao: "O envio do documento falhou."
    });
    return hash;
}

// Abertura: a carteira vinculada assina o pedido, o servidor aplica a regra
// de acesso e devolve um link de uso unico, valido por 60 segundos, que
// abre o arquivo ja decifrado numa aba nova.
export async function abrirDocumento(hash) {
    // A aba e aberta ja no clique: aberta depois da assinatura, o navegador
    // a trataria como pop-up e bloquearia.
    const aba = window.open("about:blank", "_blank");
    try {
        const prova = await assinarComCarteira((email, emitidoEm) => mensagemDocumento(hash, email, emitidoEm));
        const { url } = await chamarApi("documento", {
            corpo: { hash, ...prova },
            padrao: "Não foi possível abrir o comprovante."
        });
        if (aba) aba.location.href = url;
        else window.location.assign(url);
    } catch (erro) {
        aba?.close();
        throw erro;
    }
}
