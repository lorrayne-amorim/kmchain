// Criptografia dos documentos antes de irem para o IPFS. O IPFS e publico:
// qualquer um que tenha o CID baixa o arquivo. Por isso o que vai para la e
// so o arquivo cifrado com AES-256-GCM; a chave (DOCS_KEY) vive apenas no
// servidor, e so /api/documento decifra, para quem passar na regra de acesso.
//
// Formato gravado: "KMC1" (4 bytes) | IV (12) | tag de autenticacao (16) | cifrado.
// O GCM tambem autentica: se um unico byte for alterado, a decifragem falha.
//
// Rotacao: DOCS_KEY cifra os arquivos novos; chaves antigas, separadas por
// virgula em DOCS_KEYS_ANTIGAS, continuam decifrando os arquivos ja
// enviados. A tag do GCM diz qual chave serve, sem precisar de identificador.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MAGICO = Buffer.from("KMC1");
const TAM_IV = 12;
const TAM_TAG = 16;

function lerChave(texto) {
    const bytes = Buffer.from(texto.trim(), "base64");
    if (bytes.length !== 32) throw new Error("Chave de documentos precisa ter 32 bytes em base64.");
    return bytes;
}

function chaveAtual() {
    if (!process.env.DOCS_KEY) throw new Error("DOCS_KEY não configurada.");
    return lerChave(process.env.DOCS_KEY);
}

function chavesParaDecifrar() {
    const antigas = (process.env.DOCS_KEYS_ANTIGAS ?? "").split(",").filter((k) => k.trim());
    return [chaveAtual(), ...antigas.map(lerChave)];
}

export function cifrar(conteudo) {
    const iv = randomBytes(TAM_IV);
    const cifra = createCipheriv("aes-256-gcm", chaveAtual(), iv);
    const cifrado = Buffer.concat([cifra.update(conteudo), cifra.final()]);
    return Buffer.concat([MAGICO, iv, cifra.getAuthTag(), cifrado]);
}

// Documentos enviados antes da criptografia nao tem o prefixo "KMC1";
// esses voltam como estao, para nao quebrar o historico antigo.
export function decifrar(dados) {
    if (!dados.subarray(0, MAGICO.length).equals(MAGICO)) return dados;

    const inicio = MAGICO.length;
    const iv = dados.subarray(inicio, inicio + TAM_IV);
    const tag = dados.subarray(inicio + TAM_IV, inicio + TAM_IV + TAM_TAG);
    const cifrado = dados.subarray(inicio + TAM_IV + TAM_TAG);

    let ultimoErro;
    for (const chave of chavesParaDecifrar()) {
        try {
            const decifra = createDecipheriv("aes-256-gcm", chave, iv);
            decifra.setAuthTag(tag);
            return Buffer.concat([decifra.update(cifrado), decifra.final()]);
        } catch (erro) {
            ultimoErro = erro;
        }
    }
    throw ultimoErro;
}
