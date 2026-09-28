// Confere o cadastro ANTES da assinatura: se algum dado privado for
// recusado, a pessoa corrige antes de gravar o veiculo em cadeia. Devolve o
// que deve ir na transacao (modelo e ano), para a tela nao montar por conta.
import { exigirContaComPapel } from "../_chain.js";
import { validarCadastro } from "../_cadastro.js";
import { exigirMetodo, responderErro } from "../_http.js";

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        await exigirContaComPapel(req, ["detran"]);
        const dados = await validarCadastro(req.body);
        res.status(200).json({ ok: true, emCadeia: dados.emCadeia, marca: dados.marca });
    } catch (erro) {
        responderErro(res, erro, "privado/validar-cadastro");
    }
}
