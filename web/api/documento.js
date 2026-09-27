// Entrega o documento apenas a carteiras credenciadas.
// A permissao e conferida na propria blockchain - nao existe lista paralela.
// O arquivo no IPFS esta cifrado: ele e baixado e decifrado aqui, e so o
// conteudo original volta ao navegador - nunca o link do IPFS nem a chave.
import { createHash } from "node:crypto";
import { verifyMessage, JsonRpcProvider, Contract } from "ethers";
import { decifrar } from "./_cripto.js";
import abi from "../src/lib/KmChainRegistry.abi.json" with { type: "json" };
import enderecoJson from "../src/lib/endereco.json" with { type: "json" };
const { endereco } = enderecoJson;

const JANELA_MS = 2 * 60 * 1000; // a assinatura vale por dois minutos

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ erro: "Use POST." });

    try {
        const { hash, emitidoEm, assinatura } = req.body;

        if (Math.abs(Date.now() - Number(emitidoEm)) > JANELA_MS) {
            return res.status(400).json({ erro: "Assinatura expirada. Tente de novo." });
        }

        let solicitante;
        try {
            solicitante = verifyMessage(`KmChain: acesso ao documento ${hash} em ${emitidoEm}`, assinatura);
        } catch {
            return res.status(400).json({ erro: "Assinatura inválida." });
        }

        const contrato = new Contract(endereco, abi, new JsonRpcProvider(process.env.RPC_URL));
        let autorizado = false;
        for (const nome of ["DETRAN_ROLE", "VISTORIA_ROLE", "OFICINA_ROLE"]) {
            const papel = await contrato[nome]();
            if (await contrato.hasRole(papel, solicitante)) { autorizado = true; break; }
        }
        if (!autorizado) return res.status(403).json({ erro: "Carteira sem credencial." });

        const busca = await fetch(
            `https://api.pinata.cloud/v3/files/public?name=${hash}`,
            { headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` } }
        );
        const { data } = await busca.json();
        const arquivo = data?.files?.[0];
        if (!arquivo) return res.status(404).json({ erro: "Documento não localizado." });

        // Aceita o GATEWAY salvo com ou sem esquema/barra final.
        const gateway = process.env.GATEWAY.replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const download = await fetch(`https://${gateway}/ipfs/${arquivo.cid}`);
        if (!download.ok) return res.status(502).json({ erro: "Não foi possível baixar o documento do IPFS." });

        let conteudo;
        try {
            conteudo = decifrar(Buffer.from(await download.arrayBuffer()));
        } catch {
            return res.status(500).json({ erro: "Não foi possível decifrar o documento." });
        }

        // Prova de integridade: o arquivo decifrado tem que ter exatamente o
        // hash registrado em cadeia.
        const conferido = "0x" + createHash("sha256").update(conteudo).digest("hex");
        if (conferido !== hash) return res.status(409).json({ erro: "O documento não confere com o hash registrado." });

        res.setHeader("Content-Type", arquivo.keyvalues?.tipo || arquivo.mime_type || "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.status(200).send(conteudo);
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}