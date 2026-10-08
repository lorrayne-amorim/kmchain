// Textos que a carteira assina para provar, ao servidor, quem esta pedindo.
// Usados pelo navegador (para assinar) e pelas rotas /api (para conferir):
// um unico lugar garante que os dois lados montem exatamente o mesmo texto.
//
// Toda mensagem leva o e-mail da conta logada, assim a assinatura so vale
// para aquela sessao, e o horario, que o servidor aceita por dois minutos.
export const JANELA_ASSINATURA_MS = 2 * 60 * 1000;

export const mensagemContas = (email, emitidoEm) =>
    `KmChain: listar contas cadastradas pela conta ${email} em ${emitidoEm}`;

export const mensagemDadosComplementares = (chassi, email, emitidoEm) =>
    `KmChain: consultar dados complementares de ${chassi} pela conta ${email} em ${emitidoEm}`;

export const mensagemDocumento = (hash, email, emitidoEm) =>
    `KmChain: acesso ao documento ${hash} pela conta ${email} em ${emitidoEm}`;

export const mensagemVinculo = (carteira, email, emitidoEm) =>
    `KmChain: vincular a carteira ${carteira} à conta ${email} em ${emitidoEm}`;

export const mensagemAlteracao = (chassi, campo, email, emitidoEm) =>
    `KmChain: registrar alteração de ${campo} do veículo ${chassi} pela conta ${email} em ${emitidoEm}`;

// Sem sessao: quem assina e a carteira vinculada a conta do e-mail informado.
export const mensagemRedefinirSenha = (email, emitidoEm) =>
    `KmChain: redefinir a senha da conta ${email} em ${emitidoEm}`;
