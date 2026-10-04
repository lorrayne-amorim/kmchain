// GET   /api/marcas  lista de marcas (publica: nao ha dado pessoal).
// POST  /api/marcas  propoe uma marca que nao esta na lista. Exige vinculo
//                    ativo com o DETRAN (quem cadastra veiculos). A marca
//                    nasce PENDENTE.
// PATCH /api/marcas  o administrador do DETRAN aprova ou recusa uma proposta.
//                    Veiculos ja cadastrados com ela mantem o nome da epoca.
//
// Controle contra erro de digitacao: nome igual a uma marca existente e
// recusado; nome parecido (ex.: "Volksvagen") volta com a sugestao e so e
// aceito se a pessoa confirmar que e outra marca.
import { bd } from "../nucleo/banco.js";
import { ErroHttp } from "../nucleo/http.js";
import { SO_DETRAN, exigirMembro } from "../servicos/autorizacao.js";
import { listarMarcas } from "../servicos/marcas.js";
import { limparNome, marcasParecidas, normalizarNomeMarca } from "../../src/lib/veiculo.js";

const NOME = /^[\p{L}\p{N}][\p{L}\p{N} .\-&']*$/u;

export async function listar(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ marcas: await listarMarcas() });
}

export async function propor(req, res) {
    const { usuario } = await exigirMembro(req, { tipos: SO_DETRAN });
    const nome = limparNome(req.body?.nome);
    if (nome.length < 2 || nome.length > 40 || !NOME.test(nome)) {
        throw new ErroHttp(400, "nome_invalido", "Informe o nome da marca (2 a 40 caracteres).");
    }
    const normalizado = normalizarNomeMarca(nome);

    const todas = await listarMarcas();
    const igual = todas.find((m) => normalizarNomeMarca(m.nome) === normalizado);
    if (igual) {
        return res.status(409).json({ erro: `A marca ${igual.nome} já está na lista.`, codigo: "marca_existente", marca: igual });
    }
    const rejeitada = await bd("SELECT 1 FROM marcas_adicionais WHERE nome_normalizado = $1", [normalizado]);
    if (rejeitada.rowCount > 0) {
        throw new ErroHttp(409, "marca_rejeitada", "Esta marca já foi proposta e recusada pelo administrador do DETRAN.");
    }
    const parecidas = marcasParecidas(nome, todas);
    if (parecidas.length > 0 && req.body?.confirmarDiferente !== true) {
        return res.status(409).json({
            erro: `Parece com ${parecidas.map((m) => m.nome).join(", ")}. Confira antes de propor uma marca nova.`,
            codigo: "marca_parecida",
            sugestoes: parecidas
        });
    }

    const r = await bd(
        `INSERT INTO marcas_adicionais (id, nome, nome_normalizado, proposta_por)
         VALUES ($1, $2, $3, $4) RETURNING id, nome, situacao`,
        [`ad-${normalizado}`, nome, normalizado, usuario.id]
    );
    res.status(201).json({ marca: r.rows[0] });
}

export async function revisar(req, res) {
    const { usuario } = await exigirMembro(req, { tipos: SO_DETRAN, administrador: true });
    const { id, decisao } = req.body ?? {};
    if (!["aprovar", "rejeitar"].includes(decisao)) {
        throw new ErroHttp(400, "decisao_invalida", "Escolha aprovar ou rejeitar.");
    }
    const r = await bd(
        `UPDATE marcas_adicionais
         SET situacao = $2, revisada_por = $3, revisado_em = now()
         WHERE id = $1 AND situacao = 'pendente'
         RETURNING id, nome, situacao`,
        [String(id ?? ""), decisao === "aprovar" ? "aprovada" : "rejeitada", usuario.id]
    );
    if (r.rowCount === 0) throw new ErroHttp(404, "marca_nao_pendente", "Não há proposta pendente com este identificador.");
    res.status(200).json({ marca: r.rows[0] });
}
