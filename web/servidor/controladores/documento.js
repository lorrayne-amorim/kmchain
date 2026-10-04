// Entrega um comprovante decifrado a quem tem finalidade para ve-lo.
//
// Passo 1 - POST { hash, emitidoEm, assinatura }: exige login, a carteira
// vinculada a conta assinando na hora e a regra de acesso abaixo. Registra o
// pedido na trilha de auditoria e devolve um link de uso unico, valido por
// 60 segundos e preso a esta conta. O link nao carrega o documento, o CID, a
// chave nem dado pessoal: so um identificador aleatorio.
//
// Passo 2 - GET ?t=<token>: confere o token (mesma sessao, nao expirado, nao
// usado), baixa o arquivo cifrado do IPFS, decifra aqui e confere que o
// conteudo tem exatamente o hash registrado em cadeia. Resposta sem cache.
//
// Regra de acesso (a organizacao vem do contrato, o vinculo da conta com a
// carteira vem do banco):
//   - DETRAN: qualquer comprovante indexado (fiscalizacao e analise de
//     correcoes);
//   - oficina, empresa de vistoria e seguradora: so os comprovantes que a
//     propria conta enviou;
//   - comprovantes antigos, sem indice no banco: so DETRAN.
import { createHash, randomBytes } from "node:crypto";
import { bd } from "../nucleo/banco.js";
import { decifrar } from "../nucleo/cripto.js";
import { ErroHttp, indisponivel, parametro, responderErro } from "../nucleo/http.js";
import { ehDetran, exigirConta, exigirMembroComAssinatura } from "../servicos/autorizacao.js";
import { mensagemDocumento } from "../../src/lib/mensagens.js";

const VALIDADE_TOKEN_MS = 60 * 1000;
const LIMITE_PEDIDOS = 30;          // por conta...
const JANELA_LIMITE = "10 minutes"; // ...nesta janela
const TIPOS_ACEITOS = new Set(["application/pdf", "image/png", "image/jpeg"]);

const hashDoToken = (token) => createHash("sha256").update(token).digest("hex");

async function registrarAcesso(hash, usuario, carteira, resultado) {
    await bd(
        "INSERT INTO acessos_documentos (hash_documento, usuario_id, carteira, resultado) VALUES ($1, $2, $3, $4)",
        [hash, usuario.id, carteira, resultado]
    );
}

// Documentos enviados antes do indice no banco: o nome no Pinata era o hash.
async function localizarLegado(hash) {
    const busca = await fetch(`https://api.pinata.cloud/v3/files/public?name=${hash}`, {
        headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }
    });
    if (!busca.ok) throw indisponivel("ipfs_indisponivel");
    const { data } = await busca.json();
    const arquivo = data?.files?.[0];
    if (!arquivo) return null;
    const tipo = arquivo.keyvalues?.tipo;
    return { cid: arquivo.cid, mime: TIPOS_ACEITOS.has(tipo) ? tipo : "application/octet-stream" };
}

export async function pedirAcesso(req, res) {
    const { hash, emitidoEm } = req.body ?? {};
    if (!/^0x[0-9a-f]{64}$/.test(hash ?? "")) throw new ErroHttp(400, "hash_invalido", "Comprovante inválido.");

    const acesso = await exigirMembroComAssinatura(req, {}, (email) => mensagemDocumento(hash, email, emitidoEm));
    const { usuario, carteira } = acesso;

    const recentes = await bd(
        `SELECT count(*)::int AS n FROM acessos_documentos
         WHERE usuario_id = $1 AND criado_em > now() - interval '${JANELA_LIMITE}'`,
        [usuario.id]
    );
    if (recentes.rows[0].n >= LIMITE_PEDIDOS) {
        throw new ErroHttp(429, "limite_excedido", "Muitos pedidos de comprovantes em pouco tempo. Aguarde alguns minutos.");
    }

    const r = await bd("SELECT enviado_por FROM documentos WHERE hash = $1", [hash]);
    const indexado = r.rows[0];
    const permitido = ehDetran(acesso) || (indexado && indexado.enviado_por === usuario.id);
    if (!permitido) {
        await registrarAcesso(hash, usuario, carteira, "negado");
        throw new ErroHttp(403, "sem_acesso_documento", "Sua organização não tem acesso a este comprovante. Ele pode ser aberto por quem o enviou ou pelo DETRAN.");
    }

    const token = randomBytes(32).toString("base64url");
    await bd(
        `INSERT INTO tokens_documento (token_hash, hash_documento, usuario_id, expira_em)
         VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
        [hashDoToken(token), hash, usuario.id, String(VALIDADE_TOKEN_MS)]
    );
    await registrarAcesso(hash, usuario, carteira, "link_emitido");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ url: `/api/documento?t=${token}` });
}

async function entregarDocumento(req, res) {
    const token = parametro(req, "t") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ErroHttp(400, "link_invalido", "Link inválido.");
    const usuario = await exigirConta(req);

    // Marca como usado na mesma instrucao que confere: dois pedidos
    // simultaneos com o mesmo link nao passam os dois.
    const r = await bd(
        `UPDATE tokens_documento SET usado_em = now()
         WHERE token_hash = $1 AND usuario_id = $2 AND usado_em IS NULL AND expira_em > now()
         RETURNING hash_documento`,
        [hashDoToken(token), usuario.id]
    );
    if (r.rowCount === 0) {
        throw new ErroHttp(410, "link_expirado", "Este link expirou ou já foi usado. Abra o comprovante de novo pelo histórico.");
    }
    const hash = r.rows[0].hash_documento;

    const doc = await bd("SELECT cid, mime FROM documentos WHERE hash = $1", [hash]);
    const origem = doc.rows[0] ?? await localizarLegado(hash);
    if (!origem) throw new ErroHttp(404, "documento_nao_localizado", "Comprovante não localizado.");

    if (!process.env.GATEWAY) throw indisponivel("ipfs_nao_configurado");
    const gateway = process.env.GATEWAY.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const download = await fetch(`https://${gateway}/ipfs/${origem.cid}`);
    if (!download.ok) throw indisponivel("ipfs_indisponivel", "Não foi possível baixar o comprovante agora. Tente novamente.");

    let conteudo;
    try {
        conteudo = decifrar(Buffer.from(await download.arrayBuffer()));
    } catch {
        throw new ErroHttp(409, "documento_corrompido", "O comprovante armazenado não pôde ser decifrado.");
    }

    // Prova de integridade: o conteudo tem que ter o hash registrado em cadeia.
    const conferido = "0x" + createHash("sha256").update(conteudo).digest("hex");
    if (conferido !== hash) throw new ErroHttp(409, "documento_nao_confere", "O comprovante armazenado não confere com o hash registrado.");

    const extensao = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" }[origem.mime] ?? "bin";
    res.setHeader("Content-Type", origem.mime);
    res.setHeader("Content-Disposition", `inline; filename="comprovante.${extensao}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.status(200).send(conteudo);
}

// A resposta e aberta direto numa aba: os erros saem como texto, nao JSON.
export async function entregar(req, res) {
    try {
        await entregarDocumento(req, res);
    } catch (erro) {
        responderErro(res, erro, "documento", { texto: true });
    }
}
