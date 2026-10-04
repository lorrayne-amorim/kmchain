import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import abi from "./KmChainRegistryV2.abi.json";
import enderecos from "./endereco.json";

const CHAIN_ID = BigInt(import.meta.env.VITE_CHAIN_ID);
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16); // 0xaa36a7 para a Sepolia

// O endereco vem do deploy (scripts/deploy.js grava endereco.json); o
// ambiente local de demonstracao informa o do no Hardhat pela variavel.
const ENDERECO = import.meta.env.VITE_KMCHAIN_ENDERECO || enderecos.endereco;
export const contratoImplantado = Boolean(ENDERECO);

let provedorLeitura;
const provedorPublico = () => (provedorLeitura ??= new JsonRpcProvider(import.meta.env.VITE_RPC_URL));

// Consulta publica: funciona sem MetaMask e sem carteira, de graca.
export function contratoLeitura() {
    if (!contratoImplantado) throw new Error("O contrato do KMChain ainda não foi implantado nesta rede.");
    return new Contract(ENDERECO, abi, provedorPublico());
}

// Escrita: exige a carteira de quem registra e a rede Sepolia.
export async function contratoEscrita() {
    if (!window.ethereum) throw new Error("Instale a MetaMask para registrar eventos.");
    if (!contratoImplantado) throw new Error("O contrato do KMChain ainda não foi implantado nesta rede.");

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
    return new Contract(ENDERECO, abi, assinante);
}

export const linkTransacao = (hash) => `${import.meta.env.VITE_EXPLORER}/tx/${hash}`;

// Pede a conexao da carteira (abre o popup da MetaMask).
export async function conectarCarteira() {
    if (!window.ethereum) throw new Error("Instale a MetaMask para conectar sua carteira.");
    const [conta] = await window.ethereum.request({ method: "eth_requestAccounts" });
    return conta;
}

// Verifica se ja existe uma carteira autorizada, sem abrir popup.
export async function contaConectada() {
    if (!window.ethereum) return null;
    const contas = await window.ethereum.request({ method: "eth_accounts" });
    return contas[0] ?? null;
}

export const SEM_VINCULO = { organizacao: 0, tipo: 0, organizacaoAtiva: false, ativo: false, administrador: false };

// Le do contrato a que organizacao a carteira pertence, o tipo dela e se a
// carteira a administra. E o que define as secoes do painel; o servidor
// confere o mesmo vinculo em cada rota.
export async function vinculoDaCarteira(endereco) {
    if (!endereco || !contratoImplantado) return SEM_VINCULO;
    const v = await contratoLeitura().vinculoDe(endereco);
    return {
        organizacao: Number(v.organizacao),
        tipo: Number(v.tipo),
        organizacaoAtiva: v.organizacaoAtiva,
        ativo: v.ativo,
        administrador: v.administrador
    };
}
