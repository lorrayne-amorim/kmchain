// O que o contrato implantado GARANTE sobre a origem de cada registro.
//
// - Cadastro original: sempre o registro 1, feito por cadastrarVeiculo, que
//   exige DETRAN_ROLE.
// - Correcao real: feita por corrigirLeitura (exige DETRAN_ROLE), a unica que
//   soma em totalCorrecoes. O contrato tambem aceita o tipo CORRECAO (e
//   CADASTRO) em registrarLeitura, de qualquer carteira credenciada; esses
//   registros nao somam em totalCorrecoes. Quando a contagem de registros do
//   tipo correcao bate com totalCorrecoes, todos sao reais; quando nao bate,
//   nao ha como saber quais sao, e nenhum e atribuido ao DETRAN.
// - Demais leituras: a carteira era credenciada no momento (o contrato
//   recusaria), mas a funcao que ela tinha NAO fica registrada.
const CADASTRO = 0;
const CORRECAO = 5;

export function correcoesVerificaveis(historico, totalCorrecoes) {
    const registros = historico.filter((l, i) => i > 0 && Number(l.tipo) === CORRECAO).length;
    return registros === Number(totalCorrecoes);
}

// "detran": a funcao DETRAN na epoca e garantida pelo contrato.
// "sem-garantia": tipo cadastro/correcao que nao veio da funcao propria.
// "credenciada": leitura comum de carteira credenciada na epoca.
export function origemDoRegistro(tipo, indice, verificaveis) {
    if (tipo === CADASTRO) return indice === 0 ? "detran" : "sem-garantia";
    if (tipo === CORRECAO) return verificaveis ? "detran" : "sem-garantia";
    return "credenciada";
}
