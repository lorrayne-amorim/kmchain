// Cenario de demonstracao do KMChain: organizacoes, contas, veiculos e
// eventos FICTICIOS, criados por scripts/prepararDemonstracao.mjs.
//
// Nenhum dado aqui e real: nomes, CNPJ, CPF, chassis e placas foram montados
// para passar nas validacoes do sistema e nao se referem a empresa, pessoa
// ou veiculo existente. As coordenadas sao pontos genericos no centro de
// cada cidade.
//
// Datas: o contrato so aceita evento ocorrido nos ultimos 30 dias, entao os
// historicos sao distribuidos nesse intervalo (`diasAtras`), com avanco de
// quilometragem abaixo do limite de 1.000 km por dia.

export const MUNICIPIO = { CACHOEIRO: 3201209, VITORIA: 3205309, VILA_VELHA: 3205200, VARGEM_ALTA: 3205036 };

// Codigos do catalogo (src/lib/eventos.js).
export const TIPO = {
    REVISAO: 10, MANUTENCAO: 11, REPARO: 14, TROCA_COMPONENTES: 15,
    VISTORIA_TRANSFERENCIA: 20, VISTORIA_CAUTELAR: 24, VISTORIA_SEGURADORA: 25, SEGURO_VISTORIA_PREVIA: 30
};

const DOMINIO = "demo.kmchain.test";

// conta (demo/carteiras.mjs) -> pessoa ficticia
export const CONTAS = {
    "detran.admin":           { nome: "Administração DETRAN (demonstração)", email: `detran.admin@${DOMINIO}` },
    "detran.funcionario":     { nome: "Agente DETRAN (demonstração)",        email: `detran.agente@${DOMINIO}` },
    "oficina.admin":          { nome: "Gerente da Oficina KM Teste",         email: `oficina.admin@${DOMINIO}` },
    "oficina.funcionario":    { nome: "Mecânico da Oficina KM Teste",        email: `oficina.mecanico@${DOMINIO}` },
    "vistoria.admin":         { nome: "Gerente da Vistoria KM Teste",        email: `vistoria.admin@${DOMINIO}` },
    "vistoria.funcionario":   { nome: "Vistoriador da Vistoria KM Teste",    email: `vistoria.vistoriador@${DOMINIO}` },
    "seguradora.admin":       { nome: "Gerente da Seguradora KM Teste",      email: `seguradora.admin@${DOMINIO}` },
    "seguradora.funcionario": { nome: "Analista da Seguradora KM Teste",     email: `seguradora.analista@${DOMINIO}` }
};

// O CNPJ leva os digitos verificadores calculados pelo script a partir da
// raiz; as raizes 99.000.00x nao foram tiradas de nenhum cadastro.
export const ORGANIZACOES = {
    oficina: {
        tipo: "OFICINA", nomeFantasia: "Oficina KM Teste", razaoSocial: "Oficina KM Teste Ltda (fictícia)", raizCnpj: "990000010001",
        telefone: "2835550101", email: `contato.oficina@${DOMINIO}`, cep: "29300000", logradouro: "Rua de Demonstração", numero: "100",
        bairro: "Centro", municipio: MUNICIPIO.CACHOEIRO, latitude: -20.8489, longitude: -41.1128,
        administrador: "oficina.admin", funcionarios: ["oficina.funcionario"]
    },
    vistoria: {
        tipo: "VISTORIA", nomeFantasia: "Vistoria KM Teste", razaoSocial: "Vistoria KM Teste Ltda (fictícia)", raizCnpj: "990000020001",
        telefone: "2735550102", email: `contato.vistoria@${DOMINIO}`, cep: "29010000", logradouro: "Avenida de Demonstração", numero: "200",
        bairro: "Centro", municipio: MUNICIPIO.VITORIA, latitude: -20.3194, longitude: -40.3378,
        administrador: "vistoria.admin", funcionarios: ["vistoria.funcionario"]
    },
    seguradora: {
        tipo: "SEGURADORA", nomeFantasia: "Seguradora KM Teste", razaoSocial: "Seguradora KM Teste S.A. (fictícia)", raizCnpj: "990000030001",
        telefone: "2735550103", email: `contato.seguradora@${DOMINIO}`, cep: "29100000", logradouro: "Praça de Demonstração", numero: "300",
        bairro: "Centro", municipio: MUNICIPIO.VILA_VELHA, latitude: -20.3297, longitude: -40.2925,
        administrador: "seguradora.admin", funcionarios: ["seguradora.funcionario"]
    }
};

// Posicao do dispositivo informada pelo script em cada registro. "sede" e o
// endereco da organizacao de quem registra; as demais simulam os casos de
// registro externo e de localizacao nao obtida.
export const POSICAO = {
    EXTERNA: { latitude: -20.6717, longitude: -41.0069 },   // centro de Vargem Alta, a cerca de 22 km da oficina
    NEGADA: { motivo: "negada" }
};

// Cada evento: quem registra, tipo, quilometragem, ha quantos dias ocorreu e
// onde. `confirmarAtipica` assume o avanco acima do limite diario.
export const VEICULOS = [
    {
        cenario: "A - histórico normal",
        chassi: "9KMDEM00000000001", placa: "KMC1A01", marcaId: "fiat", modelo: "Argo Drive 1.0", anoFabricacao: "2021", anoModelo: "2022", uf: "ES",
        proprietario: { nome: "Proprietário Fictício Um", raizCpf: "900000001" },
        cadastro: { km: 45000, diasAtras: 28, municipio: MUNICIPIO.CACHOEIRO },
        eventos: [
            { por: "oficina.funcionario", tipo: TIPO.REVISAO, km: 45820, diasAtras: 21 },
            { por: "oficina.funcionario", tipo: TIPO.MANUTENCAO, km: 46910, diasAtras: 14 },
            { por: "vistoria.funcionario", tipo: TIPO.VISTORIA_TRANSFERENCIA, km: 47640, diasAtras: 7 },
            { por: "seguradora.funcionario", tipo: TIPO.SEGURO_VISTORIA_PREVIA, km: 48215, diasAtras: 2 }
        ]
    },
    {
        cenario: "B - correção aprovada",
        chassi: "9KMDEM00000000002", placa: "KMC1B02", marcaId: "volkswagen", modelo: "Gol 1.6", anoFabricacao: "2018", anoModelo: "2019", uf: "ES",
        proprietario: { nome: "Proprietário Fictício Dois", raizCpf: "900000002" },
        cadastro: { km: 82300, diasAtras: 20, municipio: MUNICIPIO.VITORIA },
        eventos: [
            { por: "vistoria.funcionario", tipo: TIPO.VISTORIA_CAUTELAR, km: 83150, diasAtras: 12 },
            // erro de digitacao: o hodometro marcava 83.890 km
            { por: "oficina.funcionario", tipo: TIPO.REVISAO, km: 838900, diasAtras: 6, confirmarAtipica: true }
        ],
        correcao: {
            indice: 2, kmSolicitada: 83890, vistoriaIndice: 1, solicitante: "oficina.funcionario", decisao: "aprovar",
            justificativa: "Erro de digitação na revisão: o hodômetro marcava 83.890 km, compatível com a vistoria cautelar anterior.",
            motivo: "A vistoria cautelar registrada dias antes e a sequência do histórico confirmam o erro de digitação."
        }
    },
    {
        cenario: "C - registro fora do local da organização",
        chassi: "9KMDEM00000000003", placa: "KMC1C03", marcaId: "chevrolet", modelo: "Onix LT 1.0", anoFabricacao: "2020", anoModelo: "2020", uf: "ES",
        proprietario: { nome: "Proprietária Fictícia Três", raizCpf: "900000003" },
        cadastro: { km: 12400, diasAtras: 10, municipio: MUNICIPIO.CACHOEIRO },
        eventos: [
            {
                por: "oficina.funcionario", tipo: TIPO.REPARO, km: 12950, diasAtras: 3, municipio: MUNICIPIO.VARGEM_ALTA, posicao: POSICAO.EXTERNA,
                justificativaLocalizacao: "Atendimento externo: veículo imobilizado na residência do proprietário, em Vargem Alta."
            },
            {
                por: "oficina.funcionario", tipo: TIPO.TROCA_COMPONENTES, km: 13020, diasAtras: 1, posicao: POSICAO.NEGADA,
                justificativaLocalizacao: "Dispositivo da oficina sem permissão de localização no navegador no momento do registro."
            }
        ]
    },
    {
        cenario: "D - vistoria a pedido de seguradora e solicitação de correção em análise",
        chassi: "9KMDEM00000000004", placa: "KMC1D04", marcaId: "toyota", modelo: "Corolla XEi 2.0", anoFabricacao: "2022", anoModelo: "2023", uf: "ES",
        proprietario: { nome: "Proprietário Fictício Quatro", raizCpf: "900000004" },
        cadastro: { km: 30100, diasAtras: 15, municipio: MUNICIPIO.VITORIA },
        eventos: [
            { por: "vistoria.funcionario", tipo: TIPO.VISTORIA_SEGURADORA, km: 30640, diasAtras: 8, seguradora: "seguradora" },
            { por: "oficina.funcionario", tipo: TIPO.REVISAO, km: 31900, diasAtras: 2 }
        ],
        // fica pendente, para a analise (aprovar ou rejeitar) ser feita ao vivo pelo DETRAN
        correcao: {
            indice: 2, kmSolicitada: 31090, vistoriaIndice: 1, solicitante: "vistoria.funcionario", decisao: null,
            justificativa: "A quilometragem da revisão parece invertida: pela vistoria anterior, o valor esperado é próximo de 31.090 km."
        }
    }
];
