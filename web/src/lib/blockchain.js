import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import abi from "./KmChainRegistry.abi.json";
import { endereco } from "./endereco.json";

const CHAIN_ID = BigInt(import.meta.env.VITE_CHAIN_ID);
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16); // 0xaa36a7 para a Sepolia

// Consulta publica: funciona sem MetaMask e sem carteira, de graca.
export function contratoLeitura() {
    const provedor = new JsonRpcProvider(import.meta.env.VITE_RPC_URL);
    return new Contract(endereco, abi, provedor);
}

// Escrita: exige carteira credenciada e rede Sepolia.
export async function contratoEscrita() {
    if (!window.ethereum) throw new Error("Instale a MetaMask para registrar leituras.");

    await window.ethereum.request({ method: "eth_requestAccounts" });
    let provedor = new BrowserProvider(window.ethereum);

    const rede = await provedor.getNetwork();
    if (rede.chainId !== CHAIN_ID) {
        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }]
        });
        provedor = new BrowserProvider(window.ethereum);
    }

    const assinante = await provedor.getSigner();
    return new Contract(endereco, abi, assinante);
}

export const linkTransacao = (hash) => `${import.meta.env.VITE_EXPLORER}/tx/${hash}`;