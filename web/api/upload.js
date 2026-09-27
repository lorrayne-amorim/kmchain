// Recebe o documento em base64, cifra e o guarda no Pinata, indexado pelo
// hash. O JWT e a chave vivem apenas aqui, no servidor, e o CID nunca volta
// ao navegador. O hash continua sendo o do arquivo ORIGINAL (e o que vai para
// a cadeia), entao a prova de conteudo nao depende da criptografia.
import { createHash } from "node:crypto";
import { cifrar } from "./_cripto.js";

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const { tipo, conteudoBase64, chassi, hash } = req.body;
        if (!conteudoBase64 || !hash) return res.status(400).json({ erro: "Requisição incompleta." });

        const bytes = Buffer.from(conteudoBase64, "base64");

        // Confere que o hash enviado corresponde mesmo ao arquivo recebido.
        const conferido = "0x" + createHash("sha256").update(bytes).digest("hex");
        if (conferido !== hash) return res.status(400).json({ erro: "Hash não corresponde ao arquivo." });

        // Nem o nome original do arquivo vai para o IPFS: so o hash e o tipo.
        const formulario = new FormData();
        formulario.append("file", new Blob([cifrar(bytes)], { type: "application/octet-stream" }), `${hash}.bin`);
        formulario.append("network", "public");
        formulario.append("name", hash);
        formulario.append("keyvalues", JSON.stringify({ hash, chassi, tipo, cifrado: "aes-256-gcm" }));

        const resposta = await fetch("https://uploads.pinata.cloud/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
            body: formulario
        });

        const dados = await resposta.json();
        if (!resposta.ok) return res.status(502).json({ erro: "Pinata recusou o envio.", dados });

        res.status(200).json({ ok: true, hash });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}