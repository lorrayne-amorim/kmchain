// Validacoes compartilhadas pela tela (aviso imediato) e pelas rotas /api
// (a regra que vale).

export const soDigitos = (valor) => String(valor ?? "").replace(/\D/g, "");

// CPF com digitos verificadores validos (rejeita tambem 000.000.000-00 etc.).
export function cpfValido(valor) {
    const cpf = soDigitos(valor);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    const digito = (base) => {
        let soma = 0;
        for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
        const resto = (soma * 10) % 11;
        return resto === 10 ? 0 : resto;
    };
    return digito(cpf.slice(0, 9)) === Number(cpf[9]) && digito(cpf.slice(0, 10)) === Number(cpf[10]);
}

// Placa no padrao antigo (ABC1234) ou Mercosul (ABC1D23).
export const normalizarPlaca = (valor) => String(valor ?? "").replace(/[\s-]/g, "").toUpperCase();
export const placaValida = (valor) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizarPlaca(valor));

// Chassi: regra unica em chassi.js.
export { normalizarChassi, chassiValido } from "./chassi.js";
