// Conta de login (e-mail e senha) e vinculo da carteira a conta.
//
// Criar a conta nao da acesso a nada: quem define o que a pessoa pode fazer
// e o vinculo da carteira dela com uma organizacao, gravado no contrato pelo
// DETRAN (administradores) ou pelo administrador da organizacao (funcionarios).
import bcrypt from "bcryptjs";
import { bd } from "../nucleo/banco.js";
import { recuperarAssinante } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import { criarToken, definirCookieSessao, limparCookieSessao, sessaoAtual } from "../nucleo/sessao.js";
import { exigirConta, vinculoDaCarteira } from "../servicos/autorizacao.js";
import { espelharVinculoDaConta } from "../servicos/funcionarios.js";
import { mensagemVinculo } from "../../src/lib/mensagens.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const abrirSessao = (res, usuario) =>
    definirCookieSessao(res, criarToken({ id: usuario.id, email: usuario.email, nome: usuario.nome }));

export async function cadastrarConta(req, res) {
    const { nome, email, senha } = req.body ?? {};
    const nomeLimpo = String(nome ?? "").trim();
    const emailLimpo = String(email ?? "").trim().toLowerCase();

    if (nomeLimpo.length < 2) throw new ErroHttp(400, "nome_invalido", "Informe seu nome.");
    if (!EMAIL_RE.test(emailLimpo)) throw new ErroHttp(400, "email_invalido", "E-mail inválido.");
    if (String(senha ?? "").length < 8) {
        throw new ErroHttp(400, "senha_invalida", "A senha precisa ter pelo menos 8 caracteres.");
    }

    const existente = await bd("SELECT id FROM usuarios WHERE email = $1", [emailLimpo]);
    if (existente.rowCount > 0) throw new ErroHttp(409, "email_em_uso", "Já existe uma conta com este e-mail.");

    const senhaHash = await bcrypt.hash(senha, 12);
    const r = await bd(
        `INSERT INTO usuarios (nome, email, senha_hash)
         VALUES ($1, $2, $3)
         RETURNING id, nome, email, carteira`,
        [nomeLimpo, emailLimpo, senhaHash]
    );
    abrirSessao(res, r.rows[0]);
    res.status(201).json({ usuario: r.rows[0] });
}

export async function entrar(req, res) {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const senha = String(req.body?.senha ?? "");

    const r = await bd("SELECT id, nome, email, senha_hash, carteira FROM usuarios WHERE email = $1", [email]);
    const linha = r.rows[0];

    // Mesma mensagem para e-mail inexistente e senha errada, de proposito.
    if (!linha || !(await bcrypt.compare(senha, linha.senha_hash))) {
        throw new ErroHttp(401, "credenciais_invalidas", "E-mail ou senha incorretos.");
    }
    abrirSessao(res, linha);
    delete linha.senha_hash;
    res.status(200).json({ usuario: linha });
}

// Quem esta logado agora, direto do banco (nao so do token), com o vinculo
// que o contrato mostra para a carteira da conta e a organizacao dele.
export async function sessaoDaConta(req, res) {
    const sessao = sessaoAtual(req);
    if (!sessao) return res.status(200).json({ usuario: null });

    const r = await bd("SELECT id, nome, email, carteira FROM usuarios WHERE id = $1", [sessao.id]);
    const usuario = r.rows[0] ?? null;
    let vinculo = null, organizacao = null;
    if (usuario?.carteira) {
        // O login nao depende da rede: sem resposta do contrato, a tela segue
        // sem o vinculo e as rotas protegidas respondem por conta propria.
        try {
            vinculo = await vinculoDaCarteira(usuario.carteira);
            const o = await espelharVinculoDaConta(usuario, vinculo);
            if (o) {
                organizacao = {
                    id: o.id, id_cadeia: o.id_cadeia, tipo: o.tipo, nome_fantasia: o.nome_fantasia,
                    municipio_ibge: o.municipio_ibge, situacao: o.situacao
                };
            }
        } catch (erro) {
            if (!(erro instanceof ErroHttp)) throw erro;
        }
    }
    res.status(200).json({ usuario, vinculo, organizacao });
}

export function sairDaConta(req, res) {
    limparCookieSessao(res);
    res.status(200).json({ ok: true });
}

// Associa a carteira MetaMask a conta de login. So registra QUEM e o dono da
// carteira; nao cria vinculo com organizacao nenhuma.
//
// Uma carteira pertence a uma unica conta. Trocar de carteira e permitido:
// a nova assinatura prova o controle da nova carteira e substitui a anterior.
export async function vincularCarteira(req, res) {
    const usuario = await exigirConta(req);

    const { carteira, emitidoEm, assinatura } = req.body ?? {};
    if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
        throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.");
    }
    const assinante = recuperarAssinante(mensagemVinculo(carteira, usuario.email, emitidoEm), emitidoEm, assinatura);
    if (assinante.toLowerCase() !== carteira.toLowerCase()) {
        throw new ErroHttp(400, "assinatura_invalida", "A assinatura não corresponde à carteira informada.");
    }

    const emUso = new ErroHttp(409, "carteira_em_uso", "Esta carteira já está vinculada a outra conta. Fale com o DETRAN.");
    const outra = await bd("SELECT 1 FROM usuarios WHERE lower(carteira) = lower($1) AND id <> $2", [carteira, usuario.id]);
    if (outra.rowCount > 0) throw emUso;

    try {
        await bd("UPDATE usuarios SET carteira = $1, carteira_vinculada_em = now() WHERE id = $2", [carteira.toLowerCase(), usuario.id]);
    } catch (erro) {
        // Corrida entre duas contas vinculando a mesma carteira.
        if (erro?.code === "23505") throw emUso;
        throw erro;
    }
    res.status(200).json({ ok: true, carteira: carteira.toLowerCase() });
}
