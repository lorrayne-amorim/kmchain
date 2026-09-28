// GET  /api/veiculo?chassi=...  identificacao PUBLICA do veiculo: marca,
//      modelo, anos, placa e UF de registro vigentes. Vem do banco, nao da
//      blockchain (o contrato so guarda o necessario para provar a
//      quilometragem). NUNCA devolve proprietario, CPF, quem registrou nem
//      historico de placas/UF: isso fica so para o DETRAN.
//
// POST /api/veiculo  confere um cadastro novo ANTES da assinatura (DETRAN):
//      se algum dado for recusado, a pessoa corrige antes de gravar o veiculo
//      em cadeia. Devolve o que deve ir na transacao (modelo e ano).
//
// As duas acoes ficam numa function so por causa do limite de functions por
// deploy do plano da Vercel.
import { bd } from "./_db.js";
import { exigirContaComPapel } from "./_chain.js";
import { validarCadastro } from "./_cadastro.js";
import { ErroHttp, exigirMetodo, responderErro } from "./_http.js";
import { chassiValido, normalizarChassi } from "../src/lib/chassi.js";

async function identificacaoPublica(req, res) {
    const chassi = normalizarChassi(new URL(req.url, "http://local").searchParams.get("chassi"));
    if (!chassiValido(chassi)) throw new ErroHttp(400, "chassi_invalido", "Chassi inválido.");

    const r = await bd(
        `SELECT v.marca_nome, v.modelo, v.ano_fabricacao, v.ano_modelo,
                (SELECT placa FROM veiculo_placas WHERE chassi = v.chassi ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS placa,
                (SELECT uf FROM veiculo_ufs WHERE chassi = v.chassi ORDER BY vigente_desde DESC, id DESC LIMIT 1) AS uf
         FROM veiculos v WHERE v.chassi = $1`,
        [chassi]
    );
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ veiculo: r.rows[0] ?? null });
}

async function conferirCadastro(req, res) {
    await exigirContaComPapel(req, ["detran"]);
    const dados = await validarCadastro(req.body);
    res.status(200).json({ ok: true, emCadeia: dados.emCadeia, marca: dados.marca });
}

export default async function handler(req, res) {
    try {
        exigirMetodo(req, ["GET", "POST"]);
        if (req.method === "GET") await identificacaoPublica(req, res);
        else await conferirCadastro(req, res);
    } catch (erro) {
        responderErro(res, erro, "veiculo");
    }
}
