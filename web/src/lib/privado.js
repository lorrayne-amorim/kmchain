// Dados que nunca vao para a blockchain: CPF do proprietario atual, placa e
// quem, de fato, realizou cada servico. Ficam no banco SQL, atras de login.
import { assinarComCarteira, chamarApi } from "./api";
import { mensagemAlteracao, mensagemContas, mensagemPrivado } from "./mensagens";

// Chamado depois de uma transacao confirmada (cadastro, leitura ou correcao).
// O servidor confere a transacao na rede; aqui so vai o hash dela e os dados
// pessoais que a tela coletou. Pode ser repetido sem duplicar o registro.
export const registrarPrivado = (dados) =>
    chamarApi("privado/registrar", { corpo: dados, padrao: "Não foi possível salvar o registro privado." });

// Confere o cadastro no servidor ANTES da assinatura. Devolve o modelo e o
// ano que devem ir na transacao; recusa com `dados.campos` por campo.
export const validarCadastro = (dados) =>
    chamarApi("privado/validar-cadastro", { corpo: dados, padrao: "Não foi possível conferir o cadastro." });

// Exclusivo do DETRAN: assina na hora e recebe a identificacao do veiculo,
// placa, UF e proprietario (com historico) e quem realizou cada registro.
export async function consultarPrivado(chassi) {
    const prova = await assinarComCarteira((email, emitidoEm) => mensagemPrivado(chassi, email, emitidoEm));
    return chamarApi("privado/consultar", {
        corpo: { chassi, ...prova },
        padrao: "Não foi possível consultar os registros privados."
    });
}

// Exclusivo do DETRAN: nova placa, UF ou proprietario, com a data em que
// passou a valer. Nada anterior e apagado.
export async function alterarDado(chassi, campo, valores) {
    const prova = await assinarComCarteira((email, emitidoEm) => mensagemAlteracao(chassi, campo, email, emitidoEm));
    return chamarApi("privado/alterar", {
        corpo: { chassi, campo, ...valores, ...prova },
        padrao: "Não foi possível registrar a alteração."
    });
}

// Admin ou DETRAN: contas de login, para achar a carteira de quem pediu acesso.
export async function contasPendentes() {
    const prova = await assinarComCarteira(mensagemContas);
    const { contas } = await chamarApi("auth/pendentes", { corpo: prova, padrao: "Não foi possível carregar as contas." });
    return contas;
}
