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

// Le em cadeia quais papeis (DETRAN, vistoria, oficina) a conta possui.
// Define o que aparece no menu: sem carteira credenciada, so a consulta publica.
//
// "admin" e separado de "detran": quem credencia oficinas e vistorias e quem
// tem DEFAULT_ADMIN_ROLE (o dono do contrato), nao qualquer conta DETRAN_ROLE
// - o contrato nunca redefine o admin desses papeis, entao so o deploy tem.
export async function papeisDaConta(endereco) {
    if (!endereco) return { admin: false, detran: false, vistoria: false, oficina: false };

    const contrato = contratoLeitura();
    const [adminRole, detranRole, vistoriaRole, oficinaRole] = await Promise.all([
        contrato.DEFAULT_ADMIN_ROLE(),
        contrato.DETRAN_ROLE(),
        contrato.VISTORIA_ROLE(),
        contrato.OFICINA_ROLE()
    ]);
    const [admin, detran, vistoria, oficina] = await Promise.all([
        contrato.hasRole(adminRole, endereco),
        contrato.hasRole(detranRole, endereco),
        contrato.hasRole(vistoriaRole, endereco),
        contrato.hasRole(oficinaRole, endereco)
    ]);
    return { admin, detran, vistoria, oficina };
}

// Concede ou revoga OFICINA_ROLE/VISTORIA_ROLE/DETRAN_ROLE a um endereco.
// So funciona se quem assina tiver DEFAULT_ADMIN_ROLE.
export async function definirPapel(nomeDoPapel, endereco, conceder) {
    const papel = await contratoLeitura()[nomeDoPapel]();
    const contrato = await contratoEscrita();
    return conceder ? contrato.grantRole(papel, endereco) : contrato.revokeRole(papel, endereco);
}