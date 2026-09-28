// Registra uma mudanca posterior de placa, UF de registro ou proprietario.
// Nada e sobrescrito: entra uma linha nova com a data em que a mudanca
// passou a valer, e as anteriores continuam consultaveis. Exige login,
// carteira vinculada assinando na hora e papel DETRAN.
//
// Nao ha transacao em cadeia: nenhum desses dados vai para a blockchain.
import { bd } from "../_db.js";
import { exigirCarteiraAssinada } from "../_chain.js";
import { ErroHttp, exigirMetodo, responderErro } from "../_http.js";
import { mensagemAlteracao } from "../../src/lib/mensagens.js";
import { chassiValido, normalizarChassi, normalizarPlaca, placaValida, soDigitos } from "../../src/lib/validar.js";
import { limparNome, problemasDoProprietario, ufValida } from "../../src/lib/veiculo.js";

const TABELAS = { placa: "veiculo_placas", uf: "veiculo_ufs", proprietario: "veiculo_proprietarios" };

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
        if (!TABELAS[campo]) throw new ErroHttp(400, "campo_invalido", "Escolha placa, UF ou proprietário.");
        const chassi = normalizarChassi(corpo.chassi);
        if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

        const { usuario } = await exigirCarteiraAssinada(
            req, ["detran"], (email) => mensagemAlteracao(chassi, campo, email, corpo.emitidoEm)
        );
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
