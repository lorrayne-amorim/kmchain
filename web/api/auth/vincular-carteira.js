// Associa a carteira MetaMask a conta de login. So registra QUEM e o dono da
// carteira; nao concede nenhum papel em cadeia (isso continua sendo do
// Admin, via CredenciarEntidade).
//
// Uma carteira pertence a uma unica conta. Trocar de carteira e permitido:
// a nova assinatura prova o controle da nova carteira e substitui o vinculo
// anterior (a antiga fica livre para outra conta).
import { bd } from "../_db.js";
import { exigirConta, recuperarAssinante } from "../_chain.js";
import { ErroHttp, exigirMetodo, responderErro } from "../_http.js";
import { mensagemVinculo } from "../../src/lib/mensagens.js";

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["POST"]);
        const usuario = await exigirConta(req);

        const { carteira, emitidoEm, assinatura } = req.body ?? {};
        if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
            throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.");
        }
        const assinante = recuperarAssinante(mensagemVinculo(carteira, usuario.email, emitidoEm), emitidoEm, assinatura);
        if (assinante.toLowerCase() !== carteira.toLowerCase()) {
            throw new ErroHttp(400, "assinatura_invalida", "A assinatura não corresponde à carteira informada.");
        }

        const outra = await bd(
            "SELECT 1 FROM usuarios WHERE lower(carteira) = lower($1) AND id <> $2",
            [carteira, usuario.id]
        );
        if (outra.rowCount > 0) {
            throw new ErroHttp(409, "carteira_em_uso", "Esta carteira já está vinculada a outra conta. Fale com o administrador.");
        }

        try {
            await bd(
                "UPDATE usuarios SET carteira = $1, carteira_vinculada_em = now() WHERE id = $2",
                [carteira.toLowerCase(), usuario.id]
            );
        } catch (erro) {
            // Corrida entre duas contas vinculando a mesma carteira.
            if (erro?.code === "23505") {
                throw new ErroHttp(409, "carteira_em_uso", "Esta carteira já está vinculada a outra conta. Fale com o administrador.");
            }
            throw erro;
        }
        res.status(200).json({ ok: true, carteira: carteira.toLowerCase() });
    } catch (erro) {
        responderErro(res, erro, "auth/vincular-carteira");
    }
}
