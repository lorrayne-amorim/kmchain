// Formatacao e constantes compartilhadas pelas telas.

export const HASH_VAZIO = "0x" + "0".repeat(64);
export const temDocumento = (hash) => Boolean(hash) && hash !== HASH_VAZIO;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const numero = (valor) => Number(valor).toLocaleString("pt-BR");
export const km = (valor) => `${numero(valor)} km`;

// Timestamps do contrato estao em segundos.
export const dataDe = (segundos) => new Date(Number(segundos) * 1000);

// "18 set 2026"
export function dataCurta(data) {
    return `${String(data.getDate()).padStart(2, "0")} ${MESES[data.getMonth()]} ${data.getFullYear()}`;
}

// "18/09/2026"
export const dataNumerica = (data) => data.toLocaleDateString("pt-BR");

// "18/09/2026 às 14:32"
export function dataHora(data) {
    const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${dataNumerica(data)} às ${hora}`;
}

export const encurtar = (texto, inicio = 6, fim = 4) =>
    texto.length <= inicio + fim + 1 ? texto : `${texto.slice(0, inicio)}…${texto.slice(-fim)}`;

export function formatarCpf(cpf) {
    if (!cpf) return "—";
    const d = String(cpf).replace(/\D/g, "").padStart(11, "0");
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// Regra unica do chassi (normalizacao, validacao e chave): lib/chassi.js.
export { normalizarChassi, problemaDoChassi as validarChassi } from "./chassi";

export const carteiraValida = (valor) => /^0x[0-9a-fA-F]{40}$/.test(valor);

export function saudacao(agora = new Date()) {
    const hora = agora.getHours();
    if (hora < 12) return "Bom dia";
    if (hora < 18) return "Boa tarde";
    return "Boa noite";
}

// Campo datetime-local: valor "AAAA-MM-DDTHH:MM" no horario local.
export function agoraLocal(data = new Date()) {
    const d = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
}

// Converte o valor do datetime-local (horario local) para ISO (UTC).
export const localParaIso = (valor) => (valor ? new Date(valor).toISOString() : "");

// Valor do datetime-local em segundos (o formato de data gravado em cadeia).
export const localParaSegundos = (valor) => Math.floor(new Date(valor).getTime() / 1000);
