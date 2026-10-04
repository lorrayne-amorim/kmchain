// Dados do veiculo mantidos FORA da blockchain: identificacao (marca,
// modelo, anos) e as informacoes datadas (placa, UF de registro e
// proprietario). Uma mudanca nunca sobrescreve: entra uma linha nova com a
// data em que passou a valer, e as anteriores continuam consultaveis.
import { bd } from "../nucleo/banco.js";
import { chaveDoChassi, contrato, naRede } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import { transacoesDoVeiculo } from "../repositorios/eventos.js";
import { resolverMarca } from "./marcas.js";
import { normalizarPlaca, placaValida, soDigitos } from "../../src/lib/validar.js";
import { limparNome, problemaDoModelo, problemasDosAnos, problemasDoProprietario, ufValida } from "../../src/lib/veiculo.js";

const TABELAS = { placa: "veiculo_placas", uf: "veiculo_ufs", proprietario: "veiculo_proprietarios" };
export const CAMPOS_ALTERAVEIS = [...Object.keys(TABELAS), "identificacao"];

// Identificacao PUBLICA: marca, modelo, anos, placa e UF vigentes, e a
// transacao de cada evento. Nunca devolve proprietario, CPF nem quem registrou.
export async function identificacaoPublica(chassi) {
    const [veiculo, transacoes] = await Promise.all([
        bd(
            `SELECT v.marca_nome, v.modelo, v.ano_fabricacao, v.ano_modelo,
                    (SELECT placa FROM veiculo_placas WHERE chassi = v.chassi ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS placa,
                    (SELECT uf FROM veiculo_ufs WHERE chassi = v.chassi ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS uf
             FROM veiculos v WHERE v.chassi = $1`,
            [chassi]
        ),
        transacoesDoVeiculo(chassi)
    ]);
    return { veiculo: veiculo.rows[0] ?? null, transacoes };
}

// Do mais recente (vigente) para o mais antigo.
const historico = (tabela, colunas, chassi) => bd(
    `SELECT ${colunas}, vigente_desde, origem, tx_hash, criado_em FROM ${tabela}
     WHERE chassi = $1 ORDER BY vigente_desde DESC, id DESC`,
    [chassi]
);

// Dados complementares de um chassi, para o DETRAN: identificacao, as
// informacoes datadas com historico e quem realizou cada registro.
export async function consultarDadosComplementares(chassi) {
    const [veiculo, placas, ufs, proprietarios, registros] = await Promise.all([
        bd(`SELECT marca_id, marca_nome, modelo, ano_fabricacao, ano_modelo, cadastro_tx, criado_em
            FROM veiculos WHERE chassi = $1`, [chassi]),
        historico("veiculo_placas", "placa", chassi),
        historico("veiculo_ufs", "uf", chassi),
        historico("veiculo_proprietarios", "nome, cpf", chassi),
        bd(`SELECT e.tipo_evento, e.quilometragem, e.observada_em, e.usuario_nome, e.usuario_email, e.carteira,
                   e.tx_hash, e.registrado_em_cadeia, e.criado_em, e.contrato, e.municipio_ibge, e.justificativa,
                   o.nome_fantasia AS organizacao_nome, s.nome_fantasia AS seguradora_nome
            FROM eventos e
            LEFT JOIN organizacoes o ON o.id = e.organizacao_id
            LEFT JOIN organizacoes s ON s.id = e.seguradora_id
            WHERE e.chassi = $1
            ORDER BY coalesce(e.registrado_em_cadeia, e.criado_em) DESC`, [chassi])
    ]);
    return {
        veiculo: veiculo.rows[0] ?? null,
        placas: placas.rows,
        ufs: ufs.rows,
        proprietarios: proprietarios.rows,
        registros: registros.rows
    };
}

// Data da transacao do primeiro evento do veiculo em cadeia, ou null se o
// chassi nao esta cadastrado no contrato.
async function dataDoCadastroEmCadeia(chassi) {
    const historico = await naRede(contrato().getHistorico(chaveDoChassi(chassi)));
    return historico.length > 0 ? Number(historico[0].dataBloco) : null;
}

// Veiculo que tem eventos em cadeia mas esta sem identificacao no banco
// (os dados complementares do cadastro nao chegaram a ser salvos).
// Placa, UF e, se informado, proprietario passam a valer na data do cadastro.
export async function completarIdentificacao(chassi, corpo, usuario) {
    const ja = await bd("SELECT 1 FROM veiculos WHERE chassi = $1", [chassi]);
    if (ja.rowCount > 0) throw new ErroHttp(409, "ja_identificado", "Este veículo já tem identificação cadastrada.");

    const desde = await dataDoCadastroEmCadeia(chassi);
    if (desde === null) throw new ErroHttp(404, "veiculo_nao_cadastrado", "Não há veículo com este chassi na blockchain.");

    const erros = {};
    if (!placaValida(corpo.placa)) erros.placa = "Informe a placa no formato ABC1234 ou ABC1D23.";
    const modelo = problemaDoModelo(corpo.modelo);
    if (modelo) erros.modelo = modelo;
    Object.assign(erros, problemasDosAnos(corpo.anoFabricacao, corpo.anoModelo));
    if (!ufValida(corpo.uf)) erros.uf = "Escolha a UF de registro na data do cadastro.";
    const temProprietario = Boolean(corpo.nomeProprietario || corpo.cpfProprietario);
    if (temProprietario) Object.assign(erros, problemasDoProprietario(corpo.nomeProprietario, corpo.cpfProprietario));
    let marca = null;
    try {
        marca = await resolverMarca(corpo.marcaId);
    } catch (erro) {
        if (!(erro instanceof ErroHttp)) throw erro;
        erros.marca = erro.message;
    }
    if (Object.keys(erros).length > 0) throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });

    await bd(
        `WITH veiculo AS (
            INSERT INTO veiculos (chassi, chave, marca_id, marca_nome, modelo, ano_fabricacao, ano_modelo, cadastro_tx, cadastrado_por, origem)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, 'complemento')
         ), placa AS (
            INSERT INTO veiculo_placas (chassi, placa, vigente_desde, origem, registrado_por)
            VALUES ($1, $9, to_timestamp($10), 'complemento', $8)
         ), uf AS (
            INSERT INTO veiculo_ufs (chassi, uf, vigente_desde, origem, registrado_por)
            VALUES ($1, $11, to_timestamp($10), 'complemento', $8)
         )
         INSERT INTO veiculo_proprietarios (chassi, nome, cpf, vigente_desde, origem, registrado_por)
         SELECT $1, $12, $13, to_timestamp($10), 'complemento', $8 WHERE $14::boolean`,
        [
            chassi, chaveDoChassi(chassi), marca.id, marca.nome, limparNome(corpo.modelo),
            Number(corpo.anoFabricacao), Number(corpo.anoModelo), usuario.id,
            normalizarPlaca(corpo.placa), desde, corpo.uf,
            temProprietario ? limparNome(corpo.nomeProprietario) : null,
            temProprietario ? soDigitos(corpo.cpfProprietario) : null,
            temProprietario
        ]
    );
}

function valoresDoCampo(campo, corpo) {
    if (campo === "placa") {
        if (!placaValida(corpo.placa)) throw new ErroHttp(400, "placa_invalida", "Placa inválida.", { campos: { placa: "Informe a placa no formato ABC1234 ou ABC1D23." } });
        return { colunas: ["placa"], valores: [normalizarPlaca(corpo.placa)] };
    }
    if (campo === "uf") {
        if (!ufValida(corpo.uf)) throw new ErroHttp(400, "uf_invalida", "UF inválida.", { campos: { uf: "Escolha a UF de registro." } });
        return { colunas: ["uf"], valores: [corpo.uf] };
    }
    const erros = problemasDoProprietario(corpo.nomeProprietario, corpo.cpfProprietario);
    if (Object.keys(erros).length > 0) throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });
    return { colunas: ["nome", "cpf"], valores: [limparNome(corpo.nomeProprietario), soDigitos(corpo.cpfProprietario)] };
}

// Registra uma mudanca posterior de placa, UF de registro ou proprietario.
// Nao ha transacao em cadeia: nenhum desses dados vai para a blockchain.
export async function registrarAlteracaoDoVeiculo(chassi, campo, corpo, usuario) {
    const { colunas, valores } = valoresDoCampo(campo, corpo);

    const vigenteDesde = new Date(corpo.vigenteDesde);
    if (Number.isNaN(vigenteDesde.getTime()) || vigenteDesde.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new ErroHttp(400, "data_invalida", "Informe a data em que a mudança passou a valer (não futura).", { campos: { vigenteDesde: "Data inválida." } });
    }
    const tabela = TABELAS[campo];
    const atual = await bd(`SELECT max(vigente_desde) AS desde FROM ${tabela} WHERE chassi = $1`, [chassi]);
    const desde = atual.rows[0]?.desde;
    if (!desde) throw new ErroHttp(404, "sem_registro_anterior", "Este veículo não tem cadastro no KMChain para alterar.");
    if (vigenteDesde < new Date(desde)) {
        throw new ErroHttp(400, "data_anterior", "A mudança não pode valer antes da informação vigente.", { campos: { vigenteDesde: "Anterior à informação vigente." } });
    }

    const lista = colunas.join(", ");
    const marcadores = colunas.map((_, i) => `$${i + 4}`).join(", ");
    await bd(
        `INSERT INTO ${tabela} (chassi, vigente_desde, registrado_por, origem, ${lista})
         VALUES ($1, $2, $3, 'alteracao', ${marcadores})`,
        [chassi, vigenteDesde, usuario.id, ...valores]
    );
}
