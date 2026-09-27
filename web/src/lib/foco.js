// Depois de uma validacao com erro, leva o foco (e a rolagem) ao primeiro
// campo invalido - quem usa leitor de tela ouve o erro na hora.
export function focarPrimeiroErro() {
    requestAnimationFrame(() => document.querySelector("[aria-invalid='true']")?.focus());
}
