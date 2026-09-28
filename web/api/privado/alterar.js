// Registra uma mudanca posterior de placa, UF de registro ou proprietario.
// Nada e sobrescrito: entra uma linha nova com a data em que a mudanca
// passou a valer, e as anteriores continuam consultaveis. Exige login,
// carteira vinculada assinando na hora e papel DETRAN.
//
// Nao ha transacao em cadeia: nenhum desses dados vai para a blockchain.
import { bd } from "../_db.js";
import { contrato, exigirCarteiraAssinada, naRede } from "../_chain.js";
import { resolverMarca } from "../_marcas.js";
import { ErroHttp, exigirMetodo, responderErro } from "../_http.js";
import { mensagemAlteracao } from "../../src/lib/mensagens.js";
import { chassiValido, normalizarChassi, normalizarPlaca, placaValida, soDigitos } from "../../src/lib/validar.js";
import { chaveDoChassi } from "../../src/lib/chassi.js";
import { limparNome, modeloEmCadeia, problemaDoModelo, problemasDosAnos, problemasDoProprietario, ufValida } from "../../src/lib/veiculo.js";

const TABELAS = { placa: "veiculo_placas", uf: "veiculo_ufs", proprietario: "veiculo_proprietarios" };

// Veiculo que ja esta em cadeia mas nao tem identificacao privada (cadastrado
// antes dela existir, ou cujo registro privado se perdeu). Marca + modelo e
// ano-modelo precisam bater com o que o contrato guardou; placa, UF e (se
// informado) proprietario passam a valer na data do cadastro em cadeia.
async function completarIdentificacao(chassi, corpo, usuario, res) {
    const ja = await bd("SELECT 1 FROM veiculos WHERE chassi = $1", [chassi]);
    if (ja.rowCount > 0) throw new ErroHttp(409, "ja_identificado", "Este veículo já tem identificação privada.");

    const c = contrato();
    const emCadeia = await naRede(c.getVeiculo(chassi));
    if (!emCadeia.cadastrado) throw new ErroHttp(404, "veiculo_nao_cadastrado", "Não há veículo com este chassi na blockchain.");
    const primeira = (await naRede(c.getHistorico(chassi)))[0];

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

    const texto = modeloEmCadeia(marca.nome, corpo.modelo);
    if (texto !== emCadeia.modelo || Number(corpo.anoModelo) !== Number(emCadeia.ano)) {
        const aviso = `Na blockchain está “${emCadeia.modelo}”, ano-modelo ${emCadeia.ano}. A marca, o modelo e o ano-modelo precisam corresponder.`;
        throw new ErroHttp(422, "dados_nao_conferem", aviso, { campos: { modelo: aviso } });
    }

    const desde = Number(primeira.data);
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
    res.status(201).json({ ok: true });
}

function valoresDe(campo, corpo) {
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

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const corpo = req.body ?? {};
        const campo = corpo.campo;
        if (!TABELAS[campo] && campo !== "identificacao") throw new ErroHttp(400, "campo_invalido", "Escolha placa, UF ou proprietário.");
        const chassi = normalizarChassi(corpo.chassi);
        if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

        const { usuario } = await exigirCarteiraAssinada(
            req, ["detran"], (email) => mensagemAlteracao(chassi, campo, email, corpo.emitidoEm)
        );
        if (campo === "identificacao") return await completarIdentificacao(chassi, corpo, usuario, res);
        const { colunas, valores } = valoresDe(campo, corpo);

        const vigenteDesde = new Date(corpo.vigenteDesde);
        if (Number.isNaN(vigenteDesde.getTime()) || vigenteDesde.getTime() > Date.now() + 5 * 60 * 1000) {
            throw new ErroHttp(400, "data_invalida", "Informe a data em que a mudança passou a valer (não futura).", { campos: { vigenteDesde: "Data inválida." } });
        }
        const tabela = TABELAS[campo];
        const atual = await bd(`SELECT max(vigente_desde) AS desde FROM ${tabela} WHERE chassi = $1`, [chassi]);
        const desde = atual.rows[0]?.desde;
        if (!desde) throw new ErroHttp(404, "sem_registro_anterior", "Este veículo não tem cadastro privado para alterar.");
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
        res.status(201).json({ ok: true });
    } catch (erro) {
        responderErro(res, erro, "privado/alterar");
    }
}
