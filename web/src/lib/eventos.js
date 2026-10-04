// Catalogo dos tipos de organizacao e de evento, usado pela tela, pelas rotas
// /api e pelos testes. Os codigos sao os valores gravados em cadeia pelo
// KmChainRegistryV2; a matriz inicial do contrato segue as mesmas faixas.
// Um tipo novo entra aqui e e liberado em cadeia por definirTiposPermitidos.

// Ordem do enum TipoOrganizacao do contrato.
export const TIPO_ORGANIZACAO = { DETRAN: 1, OFICINA: 2, VISTORIA: 3, SEGURADORA: 4 };

export const ORGANIZACOES = [
    { codigo: TIPO_ORGANIZACAO.DETRAN, chave: "DETRAN", rotulo: "DETRAN" },
    { codigo: TIPO_ORGANIZACAO.OFICINA, chave: "OFICINA", rotulo: "Oficina" },
    { codigo: TIPO_ORGANIZACAO.VISTORIA, chave: "VISTORIA", rotulo: "Empresa de vistoria" },
    { codigo: TIPO_ORGANIZACAO.SEGURADORA, chave: "SEGURADORA", rotulo: "Seguradora" }
];

// Tipos que o DETRAN credencia (ele proprio nasce com o contrato).
export const ORGANIZACOES_CREDENCIAVEIS = ORGANIZACOES.filter((o) => o.codigo !== TIPO_ORGANIZACAO.DETRAN);

export const organizacaoPorCodigo = (codigo) => ORGANIZACOES.find((o) => o.codigo === Number(codigo)) ?? null;
export const organizacaoPorChave = (chave) => ORGANIZACOES.find((o) => o.chave === chave) ?? null;
export const rotuloDaOrganizacao = (tipo) =>
    (typeof tipo === "string" ? organizacaoPorChave(tipo) : organizacaoPorCodigo(tipo))?.rotulo ?? "Organização";

export const TIPO_EVENTO = {
    CADASTRO_INICIAL: 0,
    CORRECAO: 1,
    VISTORIA_DETRAN: 2,
    TRANSFERENCIA_PROPRIEDADE: 3,
    VISTORIA_SEGURADORA: 25
};

const { DETRAN, OFICINA, VISTORIA, SEGURADORA } = TIPO_ORGANIZACAO;

// `proprio`: so entra pela funcao propria do contrato (cadastro e correcao),
// nunca pelo formulario de novo registro.
// `vistoria`: pode ser indicado como evidencia numa solicitacao de correcao.
export const EVENTOS = [
    { codigo: 0, rotulo: "Cadastro inicial", organizacao: DETRAN, proprio: true },
    { codigo: 1, rotulo: "Correção de leitura", organizacao: DETRAN, proprio: true },
    { codigo: 2, rotulo: "Vistoria do DETRAN", organizacao: DETRAN, vistoria: true },
    { codigo: 3, rotulo: "Transferência de propriedade", organizacao: DETRAN },

    { codigo: 10, rotulo: "Revisão", organizacao: OFICINA },
    { codigo: 11, rotulo: "Manutenção", organizacao: OFICINA },
    { codigo: 12, rotulo: "Orçamento", organizacao: OFICINA },
    { codigo: 13, rotulo: "Inspeção mecânica", organizacao: OFICINA },
    { codigo: 14, rotulo: "Reparo", organizacao: OFICINA },
    { codigo: 15, rotulo: "Troca de componentes", organizacao: OFICINA },

    { codigo: 20, rotulo: "Vistoria de transferência", organizacao: VISTORIA, vistoria: true },
    { codigo: 21, rotulo: "Vistoria de sinistro", organizacao: VISTORIA, vistoria: true },
    { codigo: 22, rotulo: "Vistoria de GNV", organizacao: VISTORIA, vistoria: true },
    { codigo: 23, rotulo: "Vistoria de alteração de característica", organizacao: VISTORIA, vistoria: true },
    { codigo: 24, rotulo: "Vistoria cautelar", organizacao: VISTORIA, vistoria: true },
    { codigo: 25, rotulo: "Vistoria a pedido de seguradora", organizacao: VISTORIA, vistoria: true },

    { codigo: 30, rotulo: "Vistoria prévia de seguro", organizacao: SEGURADORA, vistoria: true },
    { codigo: 31, rotulo: "Vistoria de renovação de seguro", organizacao: SEGURADORA, vistoria: true },
    { codigo: 32, rotulo: "Inspeção de sinistro (seguro)", organizacao: SEGURADORA, vistoria: true }
];

export const eventoPorCodigo = (codigo) => EVENTOS.find((e) => e.codigo === Number(codigo)) ?? null;
export const rotuloDoEvento = (codigo) => eventoPorCodigo(codigo)?.rotulo ?? `Evento ${Number(codigo)}`;

// Tipos que uma organizacao registra pelo formulario de novo registro.
export const eventosRegistraveis = (tipoOrganizacao) =>
    EVENTOS.filter((e) => e.organizacao === Number(tipoOrganizacao) && !e.proprio);

export function organizacaoPodeRegistrar(tipoOrganizacao, codigoEvento) {
    return eventosRegistraveis(tipoOrganizacao).some((e) => e.codigo === Number(codigoEvento));
}

// Mascara de bits da matriz do contrato (bit n = tipo n) para um tipo de organizacao.
export const mascaraDeTipos = (tipoOrganizacao) =>
    eventosRegistraveis(tipoOrganizacao).reduce((mascara, e) => mascara | (1n << BigInt(e.codigo)), 0n);

// Valor de `referencia` quando o evento nao aponta para outro.
export const SEM_REFERENCIA = 2 ** 32 - 1;
