// Traduz erros de carteira, rede e contrato para mensagens que a pessoa
// consegue entender e agir. Nunca devolve texto tecnico cru (revert data,
// codigos do ethers etc.).
import { ErroApi } from "./api";

const REVERTS = {
    VeiculoJaCadastrado: "Este chassi já está cadastrado.",
    VeiculoNaoCadastrado: "Não encontramos um veículo com esse chassi.",
    QuilometragemRegressiva: "A quilometragem informada é menor que a última registrada.",
    DataDoEventoInvalida: "A data do evento não pode estar no futuro, ter mais de 30 dias nem ser anterior ao último evento do veículo.",
    MunicipioInvalido: "Escolha o município em que o evento ocorreu.",
    SemVinculoAtivo: "Esta carteira não tem vínculo ativo com uma organização credenciada.",
    OrganizacaoInativa: "O credenciamento da sua organização está suspenso.",
    OrganizacaoInexistente: "Organização não encontrada no contrato.",
    ApenasDetran: "Apenas o DETRAN pode realizar esta ação.",
    ApenasAdministrador: "Apenas o administrador da organização pode realizar esta ação.",
    TipoNaoPermitido: "Sua organização não registra este tipo de evento.",
    TipoDeOrganizacaoInvalido: "Tipo de organização inválido.",
    CarteiraInvalida: "Endereço de carteira inválido.",
    CarteiraDeOutraOrganizacao: "Esta carteira pertence a outra organização.",
    AdministradorNaoPodeSerDesativado: "O administrador não pode ser desativado. Peça ao DETRAN para definir outro administrador.",
    DetranNaoPodeSerSuspenso: "O DETRAN não pode ser suspenso.",
    ChaveInvalida: "Confira o chassi informado. Ele deve ter 17 caracteres.",
    IndiceInvalido: "O registro selecionado não existe no histórico.",
    LeituraJaCorrigida: "Este registro já foi corrigido."
};

const TECNICO = /0x[0-9a-f]{8}|revert|execution|call exception|missing|json|rpc|undefined|null|fetch|ECONN|ENOTFOUND|relation|column|syntax|\(/i;

export function mensagemDeErro(erro, padrao = "Não foi possível concluir a operação. Tente novamente.") {
    if (!erro) return padrao;
    // As rotas /api ja devolvem uma frase para a pessoa (ver lib/api.js).
    if (erro instanceof ErroApi) return erro.message;

    const codigo = erro.code ?? erro.info?.error?.code;
    if (codigo === "ACTION_REJECTED" || codigo === 4001) return "A assinatura foi cancelada na carteira.";
    if (codigo === "INSUFFICIENT_FUNDS") return "A carteira não tem saldo suficiente para pagar a taxa da rede.";
    if (codigo === "NETWORK_ERROR" || codigo === "TIMEOUT" || codigo === "SERVER_ERROR") {
        return "Não foi possível conectar à rede. Verifique sua conexão e tente novamente.";
    }

    const revert = erro.revert?.name;
    if (revert && REVERTS[revert]) return REVERTS[revert];

    // Erros lancados pelo proprio front/API ja vem em portugues e sem codigo.
    if (!codigo && typeof erro.message === "string" && !TECNICO.test(erro.message)) return erro.message;

    return padrao;
}
