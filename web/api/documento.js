// Entrega o link do documento apenas a carteiras credenciadas.
// A permissao e conferida na propria blockchain - nao existe lista paralela.
import { verifyMessage, JsonRpcProvider, Contract } from "ethers";
import abi from "../src/lib/KmChainRegistry.abi.json";
import { endereco } from "../src/lib/endereco.json";

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

        res.status(200).json({ url: `${process.env.GATEWAY}/ipfs/${arquivo.cid}` });
    } catch (erro) {
        res.status(500).json({ erro: erro.message });
    }
}