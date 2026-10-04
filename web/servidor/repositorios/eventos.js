// Consultas da tabela eventos: o complemento off-chain de cada evento
// registrado em cadeia.
import { bd } from "../nucleo/banco.js";

const INSERIR_EVENTO = `
    INSERT INTO eventos
        (chassi, tipo_evento, tipo_codigo, quilometragem, observada_em, registrado_em_cadeia, municipio_ibge,
         organizacao_id, usuario_id, usuario_nome, usuario_email, carteira, tx_hash, contrato, indice,
         referencia_indice, hash_documento, seguradora_id, justificativa,
         localizacao_situacao, localizacao_latitude, localizacao_longitude, localizacao_precisao,
         localizacao_distancia, localizacao_capturada_em, localizacao_motivo, localizacao_justificativa)
    VALUES ($1, $2, $3, $4, $5, to_timestamp($6), $7, $8, $9, $10, $11, $12, $13, 'v2', $14, $15, $16, $17, $18,
            $19, $20, $21, $22, $23, $24, $25, $26)
    RETURNING id`;

const valoresDoEvento = (e) => [
    e.chassi, e.tipoRotulo, e.tipoCodigo, e.km, e.dataEvento, e.registradoEm, e.municipio,
    e.organizacaoId, e.usuario.id, e.usuario.nome, e.usuario.email, e.carteira, e.txHash, e.indice,
    e.referencia, e.hashDocumento, e.seguradoraId ?? null, e.justificativa ?? null,
    // Verificacao de localizacao: so os eventos de "novo registro" a tem.
    e.localizacao?.situacao ?? null, e.localizacao?.latitude ?? null, e.localizacao?.longitude ?? null,
    e.localizacao?.precisao ?? null, e.localizacao?.distancia ?? null, e.localizacao?.capturadaEm ?? null,
    e.localizacao?.motivo ?? null, e.localizacao?.justificativa ?? null
];

export async function buscarEventoPorTransacao(txHash) {
    const r = await bd("SELECT usuario_id, indice FROM eventos WHERE lower(tx_hash) = lower($1)", [String(txHash ?? "")]);
    return r.rows[0] ?? null;
}

export const inserirEvento = (e) => bd(INSERIR_EVENTO, valoresDoEvento(e));

// Cadastro: evento, identificacao e informacoes datadas numa instrucao so
// (CTEs), para nao sobrar veiculo sem placa ou evento sem veiculo se algo
// falhar no meio. As informacoes datadas valem a partir do registro em cadeia.
export const inserirCadastro = (e, v) => bd(
    `WITH registro AS (${INSERIR_EVENTO}
     ), veiculo AS (
        INSERT INTO veiculos (chassi, chave, marca_id, marca_nome, modelo, ano_fabricacao, ano_modelo, cadastro_tx, cadastrado_por)
        VALUES ($1, $27, $28, $29, $30, $31, $32, $13, $9)
     ), placa AS (
        INSERT INTO veiculo_placas (chassi, placa, vigente_desde, origem, tx_hash, registrado_por)
        VALUES ($1, $33, to_timestamp($6), 'cadastro', $13, $9)
     ), uf AS (
        INSERT INTO veiculo_ufs (chassi, uf, vigente_desde, origem, tx_hash, registrado_por)
        VALUES ($1, $34, to_timestamp($6), 'cadastro', $13, $9)
     ), dono AS (
        INSERT INTO veiculo_proprietarios (chassi, nome, cpf, vigente_desde, origem, tx_hash, registrado_por)
        VALUES ($1, $35, $36, to_timestamp($6), 'cadastro', $13, $9)
     )
     SELECT id FROM registro`,
    [
        ...valoresDoEvento(e),
        v.chave, v.marca.id, v.marca.nome, v.modelo, v.anoFabricacao, v.anoModelo,
        v.placa, v.uf, v.nomeProprietario, v.cpfProprietario
    ]
);

// Transferencia de propriedade: o novo proprietario passa a valer na data do
// evento; o anterior continua na tabela.
export const inserirEventoComProprietario = (e, proprietario) => bd(
    `WITH registro AS (${INSERIR_EVENTO}
     ), dono AS (
        INSERT INTO veiculo_proprietarios (chassi, nome, cpf, vigente_desde, origem, tx_hash, registrado_por)
        VALUES ($1, $27, $28, $5, 'transferencia', $13, $9)
     )
     SELECT id FROM registro`,
    [...valoresDoEvento(e), proprietario.nome, proprietario.cpf]
);

// Complemento de um evento do contrato atual, com a organizacao e quem registrou.
export async function buscarEvento(chassi, indice) {
    const r = await bd(
        `SELECT e.indice, e.tipo_codigo, e.tipo_evento, e.quilometragem, e.observada_em, e.registrado_em_cadeia,
                e.municipio_ibge, e.tx_hash, e.hash_documento, e.usuario_nome, e.usuario_email,
                o.nome_fantasia AS organizacao_nome, o.tipo AS organizacao_tipo
         FROM eventos e LEFT JOIN organizacoes o ON o.id = e.organizacao_id
         WHERE e.chassi = $1 AND e.indice = $2 AND e.contrato = 'v2'`,
        [chassi, indice]
    );
    return r.rows[0] ?? null;
}

// O que a consulta publica recebe de cada evento alem da blockchain: a
// transacao (para o explorador de blocos) e se a localizacao do dispositivo
// foi verificada. Coordenadas, distancia e justificativa nunca saem daqui.
export async function transacoesDoVeiculo(chassi) {
    const r = await bd(
        `SELECT indice, tx_hash, coalesce(localizacao_situacao = 'VERIFICADA', false) AS localizacao_verificada
         FROM eventos WHERE chassi = $1 AND contrato = 'v2' AND indice IS NOT NULL ORDER BY indice`,
        [chassi]
    );
    return r.rows;
}

// Grupos do filtro de localizacao usado pelo DETRAN.
const FILTROS_DE_LOCALIZACAO = {
    divergente: ["FORA_DA_AREA"],
    nao_verificada: ["INDISPONIVEL", "BAIXA_PRECISAO"]
};

// Detalhes da verificacao de localizacao e o endereco cadastrado da
// organizacao: coordenadas do dispositivo sao sensiveis e so vao ao DETRAN.
const DETALHES_DA_LOCALIZACAO = `,
    e.localizacao_latitude, e.localizacao_longitude, e.localizacao_precisao, e.localizacao_distancia,
    e.localizacao_capturada_em, e.localizacao_motivo, e.localizacao_justificativa,
    o.logradouro AS organizacao_logradouro, o.numero AS organizacao_numero, o.bairro AS organizacao_bairro,
    o.municipio_ibge AS organizacao_municipio, o.latitude AS organizacao_latitude, o.longitude AS organizacao_longitude`;

// Eventos registrados por uma organizacao (ou por todas, se `organizacaoId`
// for null). `comLocalizacao` inclui os detalhes da verificacao de
// localizacao; `filtro` restringe a "divergente" ou "nao_verificada".
export async function listarEventos(organizacaoId, { comLocalizacao = false, filtro = null, limite = 200 } = {}) {
    const r = await bd(
        `SELECT e.chassi, e.indice, e.tipo_codigo, e.tipo_evento, e.quilometragem, e.observada_em,
                e.registrado_em_cadeia, e.municipio_ibge, e.tx_hash, e.usuario_nome, e.localizacao_situacao,
                o.nome_fantasia AS organizacao_nome, o.tipo AS organizacao_tipo${comLocalizacao ? DETALHES_DA_LOCALIZACAO : ""}
         FROM eventos e LEFT JOIN organizacoes o ON o.id = e.organizacao_id
         WHERE e.contrato = 'v2' AND ($1::int IS NULL OR e.organizacao_id = $1)
           AND ($2::text[] IS NULL OR e.localizacao_situacao = ANY($2))
         ORDER BY e.registrado_em_cadeia DESC, e.id DESC LIMIT $3`,
        [organizacaoId, FILTROS_DE_LOCALIZACAO[filtro] ?? null, limite]
    );
    return r.rows;
}
