// Cadastro e credenciamento de organizacoes pelo DETRAN.
//
// O cadastro (dados e endereco) fica no banco. O credenciamento, a suspensao
// e a troca de administrador sao transacoes assinadas pelo DETRAN no
// contrato; o servidor so ESPELHA o que o contrato mostra, e registra a
// auditoria. Assim o banco nunca diz que uma organizacao pode algo que a
// blockchain nao confirma.
import { contrato, naRede, transacaoConfirmada } from "../nucleo/cadeia.js";
import { ErroHttp } from "../nucleo/http.js";
import * as organizacoes from "../repositorios/organizacoes.js";
import { buscarContaPorCarteira, buscarContaPorEmail, buscarMembro, definirCarteira, salvarMembro } from "../repositorios/membros.js";
import { ACOES, registrarAuditoria } from "./auditoria.js";
import { vinculoDaCarteira } from "./autorizacao.js";
import { organizacaoPorChave } from "../../src/lib/eventos.js";
import { municipioValido } from "../../src/lib/municipios.js";
import { problemasDaOrganizacao } from "../../src/lib/organizacao.js";
import { soDigitos } from "../../src/lib/validar.js";
import { limparNome } from "../../src/lib/veiculo.js";

const temValor = (v) => v !== undefined && v !== null && String(v).trim() !== "";

// Valida e normaliza os dados cadastrais enviados pela tela.
function validarDadosDaOrganizacao(corpo) {
    const d = corpo ?? {};
    const erros = problemasDaOrganizacao(d);
    if (!erros.municipio && !municipioValido(d.municipio)) erros.municipio = "Município não encontrado na lista do IBGE.";
    if (Object.keys(erros).length > 0) {
        throw new ErroHttp(400, "dados_invalidos", "Confira os campos destacados.", { campos: erros });
    }
    const comCoordenadas = temValor(d.latitude) && temValor(d.longitude);
    return {
        tipo: d.tipo,
        razaoSocial: limparNome(d.razaoSocial),
        nomeFantasia: limparNome(d.nomeFantasia),
        cnpj: soDigitos(d.cnpj),
        telefone: soDigitos(d.telefone),
        email: String(d.email).trim().toLowerCase(),
        cep: soDigitos(d.cep),
        logradouro: limparNome(d.logradouro),
        numero: limparNome(d.numero),
        complemento: limparNome(d.complemento) || null,
        bairro: limparNome(d.bairro),
        municipio: Number(d.municipio),
        latitude: comCoordenadas ? Number(d.latitude) : null,
        longitude: comCoordenadas ? Number(d.longitude) : null
    };
}

// O DETRAN informa a carteira de uma conta, quando a pessoa ainda nao a
// vinculou ou quando a carteira mudou. E um atestado do DETRAN: a posse da
// carteira nao e provada por assinatura, como no vinculo feito pela propria
// pessoa, e por isso a acao fica na auditoria. Para valer no contrato, o
// vinculo com a organizacao ainda precisa ser assinado (credenciamento,
// troca de administrador ou vinculo de funcionario).
export async function definirCarteiraDaConta(email, carteira, acesso) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(carteira ?? "")) {
        throw new ErroHttp(400, "carteira_invalida", "Endereço de carteira inválido.", { campos: { carteira: "Informe o endereço com 0x e 40 caracteres." } });
    }
    const conta = await buscarContaPorEmail(String(email ?? "").trim().toLowerCase());
    if (!conta) {
        throw new ErroHttp(404, "conta_nao_encontrada", "Não há conta com este e-mail. A pessoa precisa criar a conta no acesso institucional.", { campos: { email: "Conta não encontrada." } });
    }
    if (conta.id === acesso.usuario.id) {
        throw new ErroHttp(400, "propria_conta", "A carteira da sua própria conta é trocada pelo vínculo de carteira, com assinatura.");
    }
    const emUso = new ErroHttp(409, "carteira_em_uso", "Esta carteira já pertence a outra conta.", { campos: { carteira: "Carteira já vinculada a outra conta." } });
    const dona = await buscarContaPorCarteira(carteira);
    if (dona && dona.id !== conta.id) throw emUso;
    if (dona) return dona;

    try {
        await definirCarteira(conta.id, carteira);
    } catch (erro) {
        if (erro?.code === "23505") throw emUso;
        throw erro;
    }
    await registrarAuditoria(ACOES.CARTEIRA_DEFINIDA, acesso, { tipo: "usuario", id: conta.id }, {
        funcionario: conta.nome, organizacao: conta.carteira ? "carteira trocada" : "carteira informada"
    });
    return { ...conta, carteira: carteira.toLowerCase() };
}

// Conta indicada para administrar uma organizacao: precisa existir, ter
// carteira vinculada e nao estar ativa em outra organizacao.
export async function localizarContaParaVinculo(email, organizacaoIdCadeia = null) {
    const conta = await buscarContaPorEmail(String(email ?? "").trim().toLowerCase());
    if (!conta) {
        throw new ErroHttp(404, "conta_nao_encontrada", "Não há conta com este e-mail. A pessoa precisa criar a conta no acesso institucional.", { campos: { email: "Conta não encontrada." } });
    }
    if (!conta.carteira) {
        throw new ErroHttp(409, "conta_sem_carteira", "Esta conta ainda não vinculou uma carteira. Peça para a pessoa entrar e vincular a carteira.", { campos: { email: "Conta sem carteira vinculada." } });
    }
    const vinculo = await vinculoDaCarteira(conta.carteira);
    if (vinculo.ativo && vinculo.organizacao !== organizacaoIdCadeia) {
        throw new ErroHttp(409, "conta_em_outra_organizacao", "Esta conta já tem vínculo ativo com outra organização.", { campos: { email: "Já vinculada a outra organização." } });
    }
    return { conta, vinculo };
}

// Cadastra a organizacao como pendente e devolve o que o DETRAN precisa
// assinar no contrato para credencia-la.
export async function cadastrarOrganizacao(corpo, acesso) {
    const dados = validarDadosDaOrganizacao(corpo);
    if (await organizacoes.buscarOrganizacaoPorCnpj(dados.cnpj)) {
        throw new ErroHttp(409, "cnpj_ja_cadastrado", "Já existe uma organização com este CNPJ.", { campos: { cnpj: "CNPJ já cadastrado." } });
    }
    // A carteira do administrador pode vir junto, informada pelo DETRAN.
    if (corpo.administradorCarteira) await definirCarteiraDaConta(corpo.administradorEmail, corpo.administradorCarteira, acesso);
    const { conta } = await localizarContaParaVinculo(corpo.administradorEmail);

    const organizacao = await organizacoes.inserirOrganizacao({ ...dados, administradorId: conta.id }, acesso.usuario.id);
    await registrarAuditoria(ACOES.ORGANIZACAO_CRIADA, acesso, { tipo: "organizacao", id: organizacao.id }, {
        nome: organizacao.nome_fantasia, tipo: organizacao.tipo
    });
    return { organizacao, credenciamento: dadosDoCredenciamento(organizacao, conta) };
}

const dadosDoCredenciamento = (organizacao, administrador) => ({
    tipo: organizacaoPorChave(organizacao.tipo).codigo,
    administrador: administrador.carteira
});

// Confere a transacao de credenciamento e ativa a organizacao no banco com
// o identificador que o contrato atribuiu.
export async function confirmarCredenciamento(id, txHash, acesso) {
    const organizacao = await organizacoes.buscarOrganizacao(Number(id));
    if (!organizacao) throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada.");
    if (organizacao.id_cadeia !== null) return { organizacao, jaCredenciada: true };

    const { eventos, registradoEm, txHash: tx } = await transacaoConfirmada(txHash);
    const credenciamentos = eventos.filter((e) => e.name === "OrganizacaoCredenciada");
    if (credenciamentos.length !== 1) {
        throw new ErroHttp(422, "credenciamento_nao_confere", "A transação não é o credenciamento de uma organização.");
    }
    const idCadeia = Number(credenciamentos[0].args.organizacao);
    if (await organizacoes.buscarOrganizacaoPorIdCadeia(idCadeia)) {
        throw new ErroHttp(409, "transacao_ja_usada", "Esta transação já credenciou outra organização.");
    }

    const emCadeia = await naRede(contrato().getOrganizacao(idCadeia));
    const administrador = await buscarContaPorCarteira(emCadeia.administrador);
    if (Number(emCadeia.tipo) !== organizacaoPorChave(organizacao.tipo).codigo || administrador?.id !== organizacao.administrador_id) {
        throw new ErroHttp(422, "credenciamento_nao_confere", "O tipo ou o administrador gravados em cadeia não conferem com o cadastro.");
    }

    await organizacoes.marcarCredenciada(organizacao.id, idCadeia, tx, registradoEm);
    await salvarMembro({
        organizacaoId: organizacao.id, usuarioId: administrador.id, carteira: administrador.carteira,
        papel: "administrador", ativo: true
    });
    const alvo = { tipo: "organizacao", id: organizacao.id };
    await registrarAuditoria(ACOES.ORGANIZACAO_CREDENCIADA, acesso, alvo, { nome: organizacao.nome_fantasia, idCadeia, tx });
    await registrarAuditoria(ACOES.ADMINISTRADOR_DEFINIDO, acesso, alvo, { administrador: administrador.nome });
    return { organizacao: await organizacoes.buscarOrganizacao(organizacao.id), jaCredenciada: false };
}

// Espelha no banco a situacao e o administrador que o contrato mostra agora.
// Chamado depois que o DETRAN suspende, reativa ou troca o administrador.
export async function sincronizarOrganizacaoComContrato(id, acesso) {
    const organizacao = await organizacoes.buscarOrganizacao(Number(id));
    if (!organizacao || organizacao.id_cadeia === null) {
        throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada ou ainda não credenciada.");
    }
    const emCadeia = await naRede(contrato().getOrganizacao(organizacao.id_cadeia));
    const alvo = { tipo: "organizacao", id: organizacao.id };

    const situacao = emCadeia.ativa ? "ativa" : "suspensa";
    if (situacao !== organizacao.situacao) {
        await organizacoes.definirSituacao(organizacao.id, situacao);
        await registrarAuditoria(
            emCadeia.ativa ? ACOES.ORGANIZACAO_REATIVADA : ACOES.ORGANIZACAO_SUSPENSA,
            acesso, alvo, { nome: organizacao.nome_fantasia }
        );
    }

    const administrador = await buscarContaPorCarteira(emCadeia.administrador);
    if (administrador && administrador.id === organizacao.administrador_id) {
        // Mesma pessoa: so a carteira dela pode ter mudado.
        await salvarMembro({
            organizacaoId: organizacao.id, usuarioId: administrador.id, carteira: administrador.carteira,
            papel: "administrador", ativo: true
        });
    }
    if (administrador && administrador.id !== organizacao.administrador_id) {
        // O administrador anterior continua vinculado, como funcionario.
        if (organizacao.administrador_id) {
            const anterior = await buscarMembro(organizacao.id, organizacao.administrador_id);
            if (anterior) {
                await salvarMembro({
                    organizacaoId: organizacao.id, usuarioId: anterior.usuario_id, carteira: anterior.carteira,
                    papel: "funcionario", ativo: anterior.ativo
                });
            }
        }
        await salvarMembro({
            organizacaoId: organizacao.id, usuarioId: administrador.id, carteira: administrador.carteira,
            papel: "administrador", ativo: true
        });
        await organizacoes.definirAdministrador(organizacao.id, administrador.id);
        await registrarAuditoria(ACOES.ADMINISTRADOR_ALTERADO, acesso, alvo, {
            nome: organizacao.nome_fantasia, administrador: administrador.nome
        });
    }
    return organizacoes.buscarOrganizacao(organizacao.id);
}

// Altera dados cadastrais (nome, contato, endereco). Tipo e CNPJ nao mudam:
// o tipo esta gravado em cadeia e define o que a organizacao pode registrar.
export async function atualizarCadastroDaOrganizacao(id, corpo, acesso) {
    const organizacao = await organizacoes.buscarOrganizacao(Number(id));
    if (!organizacao || organizacao.tipo === "DETRAN") {
        throw new ErroHttp(404, "organizacao_nao_encontrada", "Organização não encontrada.");
    }
    const dados = validarDadosDaOrganizacao({ ...corpo, tipo: organizacao.tipo, cnpj: organizacao.cnpj });
    const atualizada = await organizacoes.atualizarCadastro(organizacao.id, dados, acesso.usuario.id);
    await registrarAuditoria(ACOES.ORGANIZACAO_ALTERADA, acesso, { tipo: "organizacao", id: organizacao.id }, {
        nome: atualizada.nome_fantasia, nomeAnterior: atualizada.nomes_novos ? organizacao.nome_fantasia : undefined
    });
    return atualizada;
}

export const listarOrganizacoesPublicas = organizacoes.listarOrganizacoesPublicas;

// Lista para a gestao do DETRAN; as pendentes levam o que falta assinar.
export async function listarOrganizacoesParaGestao() {
    const lista = await organizacoes.listarOrganizacoesCompletas();
    return lista.map((o) => ({
        ...o,
        credenciamento: o.situacao === "pendente" && o.administrador_carteira
            ? dadosDoCredenciamento(o, { carteira: o.administrador_carteira })
            : null
    }));
}
