// Validacao do cadastro inicial no servidor. Usada duas vezes:
//   1. ANTES da transacao (POST /api/veiculo), para a pessoa nao gravar em
//      cadeia um veiculo cuja identificacao seria recusada;
//   2. DEPOIS da transacao (servicos/eventos.js), que e a regra que vale.
// A identificacao (placa, marca, modelo, anos, UF, proprietario) fica so no
// banco; em cadeia vao a chave do veiculo, a quilometragem, a data e o
// municipio do evento.
import { bd } from "../nucleo/banco.js";
import { ErroHttp } from "../nucleo/http.js";
import { resolverMarca } from "./marcas.js";
import { chaveDoChassi, normalizarChassi } from "../../src/lib/chassi.js";
import { municipioValido } from "../../src/lib/municipios.js";
import { normalizarPlaca, soDigitos } from "../../src/lib/validar.js";
import { limparNome, problemasDoCadastro } from "../../src/lib/veiculo.js";

export async function validarCadastro(corpo, agora = new Date()) {
    const d = corpo ?? {};
    const erros = problemasDoCadastro({ ...d, marca: d.marcaId ? true : null }, agora);
    if (!erros.municipio && !municipioValido(d.municipio)) erros.municipio = "Município não encontrado na lista do IBGE.";
    let marca = null;
    if (!erros.marca) {
        try {
            marca = await resolverMarca(d.marcaId);
        } catch (erro) {
            if (!(erro instanceof ErroHttp)) throw erro;
            erros.marca = erro.message;
        }
    }
    if (Object.keys(erros).length > 0) {
        throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });
    }

    const chassi = normalizarChassi(d.chassi);
    const existente = await bd("SELECT 1 FROM veiculos WHERE chassi = $1", [chassi]);
    if (existente.rowCount > 0) {
        throw new ErroHttp(409, "veiculo_ja_cadastrado", "Este chassi já está cadastrado.", { campos: { chassi: "Este chassi já está cadastrado." } });
    }

    return {
        chassi,
        chave: chaveDoChassi(chassi),
        placa: normalizarPlaca(d.placa),
        marca,
        modelo: limparNome(d.modelo),
        anoFabricacao: Number(d.anoFabricacao),
        anoModelo: Number(d.anoModelo),
        uf: d.uf,
        nomeProprietario: limparNome(d.nomeProprietario),
        cpfProprietario: soDigitos(d.cpfProprietario)
    };
}
