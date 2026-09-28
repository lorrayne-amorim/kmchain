// O identificador do veiculo no KmChain e o CHASSI (VIN) de 17 caracteres.
// Placa e RENAVAM nao o substituem: mudam ao longo da vida do veiculo.
//
// Esta e a UNICA regra de normalizacao, validacao e derivacao da chave, usada
// pela tela, pelas rotas /api, pelo QR Code e pelos testes. A chave e
//     keccak256(bytes UTF-8 do chassi normalizado)
// - a mesma que o contrato em uso (v1) calcula em chaveDoChassi(). A chave e
// um PSEUDONIMO, nao anonimizacao: quem conhece o chassi calcula a chave e
// localiza o historico publico.
import { keccak256, toUtf8Bytes } from "ethers";

// Espacos e hifens sao comuns ao copiar do documento; minusculas tambem.
export const normalizarChassi = (valor) => String(valor ?? "").replace(/[\s-]/g, "").toUpperCase();

// VIN (ISO 3779): 17 caracteres, letras e numeros, sem I, O e Q (confundem
// com 1 e 0). O digito verificador (posicao 9) nao e conferido: ele so e
// obrigatorio em alguns mercados, e veiculos brasileiros validos podem nao
// segui-lo.
const FORMATO_VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

// Mensagem do problema, ou "" se o chassi (ja normalizado) e valido.
export function problemaDoChassi(chassi) {
    if (!chassi) return "Informe o chassi do veículo.";
    if (chassi.length !== 17) return `O chassi tem 17 caracteres. Você digitou ${chassi.length}.`;
    if (/[IOQ]/.test(chassi)) return "O chassi não usa as letras I, O e Q. Confira se não são os números 1 e 0.";
    if (!FORMATO_VIN.test(chassi)) return "O chassi tem apenas letras e números.";
    return "";
}

export const chassiValido = (valor) => problemaDoChassi(normalizarChassi(valor)) === "";

// Chave deterministica do veiculo. Recusa chassi invalido em vez de gerar
// uma chave que nunca sera encontrada.
export function chaveDoChassi(valor) {
    const chassi = normalizarChassi(valor);
    const problema = problemaDoChassi(chassi);
    if (problema) throw new Error(problema);
    return keccak256(toUtf8Bytes(chassi));
}

// QR Code e link de compartilhamento: levam a consulta publica do chassi.
export const linkConsulta = (origem, chassi) => `${origem}/?chassi=${normalizarChassi(chassi)}`;

// Chassi contido em um link lido do QR Code, ou null se nao for do KmChain.
export function chassiDoLink(texto) {
    try {
        const chassi = normalizarChassi(new URL(texto).searchParams.get("chassi"));
        return problemaDoChassi(chassi) ? null : chassi;
    } catch {
        return null;
    }
}
