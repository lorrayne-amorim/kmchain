// Lista as contas cadastradas (login) para o DETRAN localizar quem ja pediu
// acesso e ainda precisa ser credenciado em cadeia. Exige login, carteira
// vinculada a essa conta assinando na hora e papel Admin ou DETRAN.
import { bd } from "../_db.js";
import { exigirCarteiraAssinada } from "../_chain.js";
import { exigirMetodo, responderErro } from "../_http.js";
import { mensagemContas } from "../../src/lib/mensagens.js";

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const { emitidoEm } = req.body ?? {};
        await exigirCarteiraAssinada(req, ["admin", "detran"], (email) => mensagemContas(email, emitidoEm));

        const r = await bd(
            `SELECT nome, email, carteira, criado_em
             FROM usuarios ORDER BY criado_em DESC LIMIT 200`
        );
        res.status(200).json({ contas: r.rows });
    } catch (erro) {
        responderErro(res, erro, "auth/pendentes");
    }
}
