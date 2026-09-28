// Validacao do cadastro inicial no servidor. Usada duas vezes:
//   1. ANTES da transacao (privado/validar-cadastro), para a pessoa nao
//      gravar em cadeia um veiculo cujos dados privados seriam recusados;
//   2. DEPOIS da transacao (privado/registrar), que e a regra que vale.
import { bd } from "./_db.js";
import { ErroHttp } from "./_http.js";
import { resolverMarca } from "./_marcas.js";
import { chaveDoChassi, normalizarChassi } from "../src/lib/chassi.js";
import { normalizarPlaca, soDigitos } from "../src/lib/validar.js";
import { limparNome, modeloEmCadeia, problemasDoCadastro } from "../src/lib/veiculo.js";

export async function validarCadastro(corpo, agora = new Date()) {
    const d = corpo ?? {};
    const erros = problemasDoCadastro({ ...d, marca: d.marcaId ? true : null }, agora);
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

    const modelo = limparNome(d.modelo);
    return {
        chassi,
        chave: chaveDoChassi(chassi),
        placa: normalizarPlaca(d.placa),
        marca,
        modelo,
        anoFabricacao: Number(d.anoFabricacao),
        anoModelo: Number(d.anoModelo),
        uf: d.uf,
        kmInicial: String(d.kmInicial),
        observadaEm: new Date(d.observadaEm),
        nomeProprietario: limparNome(d.nomeProprietario),
        cpfProprietario: soDigitos(d.cpfProprietario),
        // O que o contrato em uso (v1) recebe: marca + modelo num texto so
        // e o ano-modelo. A tela usa exatamente estes valores na transacao.
        emCadeia: { modelo: modeloEmCadeia(marca.nome, modelo), ano: Number(d.anoModelo) }
    };
}
