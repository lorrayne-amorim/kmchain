// Devolve os dados privados de um chassi: identificacao do veiculo, as
// informacoes datadas (placa, UF de registro, proprietario, cada uma com seu
// historico) e quem realizou cada registro. Exige login, carteira vinculada
// assinando na hora e papel DETRAN (ou Admin) em cadeia.
import { bd } from "../_db.js";
import { exigirCarteiraAssinada } from "../_chain.js";
import { ErroHttp, exigirMetodo, responderErro } from "../_http.js";
import { mensagemPrivado } from "../../src/lib/mensagens.js";
import { chassiValido, normalizarChassi } from "../../src/lib/validar.js";

// Do mais recente (vigente) para o mais antigo.
const historico = (tabela, colunas, chassi) => bd(
    `SELECT ${colunas}, vigente_desde, origem, tx_hash, criado_em FROM ${tabela}
     WHERE chassi = $1 ORDER BY vigente_desde DESC, id DESC`,
    [chassi]
);

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const { emitidoEm } = req.body ?? {};
        const chassi = normalizarChassi(req.body?.chassi);
        if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

        await exigirCarteiraAssinada(req, ["admin", "detran"], (email) => mensagemPrivado(chassi, email, emitidoEm));

        const [veiculo, placas, ufs, proprietarios, registros] = await Promise.all([
            bd(`SELECT marca_id, marca_nome, modelo, ano_fabricacao, ano_modelo, cadastro_tx, criado_em
                FROM veiculos WHERE chassi = $1`, [chassi]),
            historico("veiculo_placas", "placa", chassi),
            historico("veiculo_ufs", "uf", chassi),
            historico("veiculo_proprietarios", "nome, cpf", chassi),
            // placa/cpf/nome aqui so existem em registros anteriores as
            // tabelas datadas; os novos ficam nelas.
            bd(`SELECT placa, modelo, ano, cpf_proprietario, nome_proprietario, tipo_evento,
                       quilometragem, observada_em, usuario_nome, usuario_email, carteira, tx_hash,
                       registrado_em_cadeia, criado_em
                FROM registros_privados
                WHERE chassi = $1
                ORDER BY coalesce(registrado_em_cadeia, criado_em) DESC`, [chassi])
        ]);
        res.status(200).json({
            veiculo: veiculo.rows[0] ?? null,
            placas: placas.rows,
            ufs: ufs.rows,
            proprietarios: proprietarios.rows,
            registros: registros.rows
        });
    } catch (erro) {
        responderErro(res, erro, "privado/consultar");
    }
}
