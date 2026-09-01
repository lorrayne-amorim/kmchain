// Recebe o documento em base64 e o guarda no Pinata, indexado pelo hash.
// O JWT vive apenas aqui, no servidor, e o CID nunca volta ao navegador.
export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const { nomeArquivo, tipo, conteudoBase64, chassi, hash } = req.body;
        if (!conteudoBase64 || !hash) return res.status(400).json({ erro: "Requisição incompleta." });

        const bytes = Buffer.from(conteudoBase64, "base64");

        // Confere que o hash enviado corresponde mesmo ao arquivo recebido.
        const { createHash } = await import("node:crypto");
        const conferido = "0x" + createHash("sha256").update(bytes).digest("hex");
        if (conferido !== hash) return res.status(400).json({ erro: "Hash não corresponde ao arquivo." });

        const formulario = new FormData();
        formulario.append("file", new Blob([bytes], { type: tipo }), nomeArquivo);
        formulario.append("network", "public");
        formulario.append("name", hash);
        formulario.append("keyvalues", JSON.stringify({ hash, chassi }));

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