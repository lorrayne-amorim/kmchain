// Recebe o comprovante em base64, cifra e o guarda no IPFS (Pinata).
//
// So aceita quem tem login e carteira vinculada com funcao de registro em
// cadeia. O tipo do arquivo e detectado pelo conteudo (nao pelo que o
// navegador declara) e so PDF, PNG e JPEG passam. Nada identificavel vai para
// o Pinata: nome aleatorio e nenhum metadado. O CID, o chassi pretendido e
// quem enviou ficam so no banco privado (tabela documentos), que e a base da
// regra de acesso em /api/documento. O CID nunca volta ao navegador.
import { createHash, randomUUID } from "node:crypto";
import { bd } from "./_db.js";
import { CREDENCIADAS, exigirContaComPapel } from "./_chain.js";
import { cifrar } from "./_cripto.js";
import { ErroHttp, exigirMetodo, indisponivel, responderErro } from "./_http.js";
import { chassiValido, normalizarChassi } from "../src/lib/validar.js";

// A Vercel recusa corpos acima de 4,5 MB; em base64 o arquivo cresce 4/3.
export const TAMANHO_MAXIMO = 3 * 1024 * 1024;
export const config = { api: { bodyParser: { sizeLimit: "4.5mb" } } };

export function tipoPeloConteudo(bytes) {
    if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    return null;
}

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const { usuario, carteira } = await exigirContaComPapel(req, CREDENCIADAS);

        const { conteudoBase64, chassi, hash } = req.body ?? {};
        if (typeof conteudoBase64 !== "string" || !/^0x[0-9a-f]{64}$/.test(hash ?? "")) {
            throw new ErroHttp(400, "requisicao_incompleta", "Requisição incompleta.");
        }
        const chassiLimpo = normalizarChassi(chassi);
        if (!chassiValido(chassiLimpo)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

        const bytes = Buffer.from(conteudoBase64, "base64");
        if (bytes.length === 0) throw new ErroHttp(400, "arquivo_vazio", "O arquivo está vazio.");
        if (bytes.length > TAMANHO_MAXIMO) {
            throw new ErroHttp(413, "arquivo_grande", "O arquivo passa de 3 MB. Envie uma versão menor.");
        }
        const mime = tipoPeloConteudo(bytes);
        if (!mime) throw new ErroHttp(415, "tipo_nao_aceito", "Envie o comprovante em PDF, PNG ou JPEG.");

        // O hash enviado precisa ser o do arquivo recebido: e ele que vai para a cadeia.
        const conferido = "0x" + createHash("sha256").update(bytes).digest("hex");
        if (conferido !== hash) throw new ErroHttp(400, "hash_nao_confere", "O arquivo não corresponde ao hash informado.");

        // O mesmo arquivo ja foi guardado: nao cifra nem envia de novo.
        const existente = await bd("SELECT 1 FROM documentos WHERE hash = $1", [hash]);
        if (existente.rowCount > 0) return res.status(200).json({ ok: true, hash });

        if (!process.env.PINATA_JWT) throw indisponivel("ipfs_nao_configurado");
        const formulario = new FormData();
        formulario.append("file", new Blob([cifrar(bytes)], { type: "application/octet-stream" }), `${randomUUID()}.bin`);
        formulario.append("network", "public");

        const resposta = await fetch("https://uploads.pinata.cloud/v3/files", {
            method: "POST",
            headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` },
            body: formulario
        });
        if (!resposta.ok) throw indisponivel("ipfs_recusou", "O armazenamento de documentos recusou o envio. Tente novamente.");
        const { data } = await resposta.json();
        if (!data?.cid) throw indisponivel("ipfs_sem_cid", "O armazenamento de documentos não confirmou o envio.");

        await bd(
            `INSERT INTO documentos (hash, cid, mime, tamanho, chassi, enviado_por, carteira)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (hash) DO NOTHING`,
            [hash, data.cid, mime, bytes.length, chassiLimpo, usuario.id, carteira]
        );
        res.status(201).json({ ok: true, hash });
    } catch (erro) {
        responderErro(res, erro, "upload");
    }
}
