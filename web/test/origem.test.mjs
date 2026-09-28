// Regra de exibicao da origem de cada registro na consulta publica.
import { test } from "node:test";
import assert from "node:assert/strict";
import { correcoesVerificaveis, origemDoRegistro } from "../src/lib/origem.js";

const h = (...tipos) => tipos.map((tipo) => ({ tipo }));

test("cadastro original (registro 1) e atribuido ao DETRAN; cadastro posterior nao", () => {
    assert.equal(origemDoRegistro(0, 0, true), "detran");
    assert.equal(origemDoRegistro(0, 3, true), "sem-garantia");
});

test("correcoes: DETRAN so quando a contagem bate com totalCorrecoes", () => {
    // cadastro, revisao, contestada, correcao real
    assert.equal(correcoesVerificaveis(h(0, 2, 2, 5), 1), true);
    // uma credenciada gravou tipo CORRECAO via registrarLeitura (nao soma)
    assert.equal(correcoesVerificaveis(h(0, 2, 5), 0), false);
    assert.equal(origemDoRegistro(5, 2, false), "sem-garantia");
    assert.equal(origemDoRegistro(5, 3, true), "detran");
});

test("leituras comuns so garantem carteira credenciada na epoca", () => {
    for (const tipo of [1, 2, 3, 4]) assert.equal(origemDoRegistro(tipo, 1, true), "credenciada");
});
