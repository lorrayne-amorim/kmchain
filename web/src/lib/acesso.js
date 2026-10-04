// Estado de acesso da area institucional: sessao de login, carteira
// conectada e o vinculo dessa carteira com uma organizacao, lido do contrato.
// O painel decide o que mostrar a partir daqui; quem decide o que e
// permitido e o servidor (e o contrato), em cada operacao.
import { useCallback, useEffect, useState } from "react";
import { definirContaAtual } from "./api";
import { sair, sessaoAtual, vincularCarteira } from "./auth";
import { SEM_VINCULO, conectarCarteira, contaConectada, vinculoDaCarteira } from "./blockchain";
import { mensagemDeErro } from "./erros";
import { TIPO_ORGANIZACAO } from "./eventos";

export function useAcesso() {
    const [usuario, setUsuario] = useState(null);
    const [organizacao, setOrganizacao] = useState(null);
    const [carregandoSessao, setCarregandoSessao] = useState(true);

    const [conta, setConta] = useState(null);
    const [vinculo, setVinculo] = useState(SEM_VINCULO);
    const [verificando, setVerificando] = useState(false);
    const [conectando, setConectando] = useState(false);
    const [erroCarteira, setErroCarteira] = useState("");

    const [vinculando, setVinculando] = useState(false);
    const [avisoVinculo, setAvisoVinculo] = useState(null); // { tipo, texto }

    const carregarSessao = useCallback(async () => {
        try {
            const sessao = await sessaoAtual();
            setUsuario(sessao.usuario);
            setOrganizacao(sessao.organizacao);
        } catch {
            setUsuario(null);
            setOrganizacao(null);
        } finally {
            setCarregandoSessao(false);
        }
    }, []);

    const atualizarCarteira = useCallback(async (endereco) => {
        setConta(endereco);
        if (!endereco) return setVinculo(SEM_VINCULO);
        setVerificando(true);
        try {
            setVinculo(await vinculoDaCarteira(endereco));
        } catch {
            setVinculo(SEM_VINCULO);
        } finally {
            setVerificando(false);
        }
    }, []);

    // Sessao de login: quem esta logado ao abrir o site.
    useEffect(() => {
        const espera = setTimeout(carregarSessao);
        return () => clearTimeout(espera);
    }, [carregarSessao]);

    // Reconecta sozinho se a carteira ja estava autorizada neste site,
    // e acompanha troca de conta feita direto na extensao.
    useEffect(() => {
        contaConectada().then(atualizarCarteira).catch(() => { });
        if (!window.ethereum) return;
        const aoTrocarConta = (contas) => atualizarCarteira(contas[0] ?? null);
        window.ethereum.on("accountsChanged", aoTrocarConta);
        return () => window.ethereum.removeListener("accountsChanged", aoTrocarConta);
    }, [atualizarCarteira]);

    // As assinaturas pedidas ao servidor levam o e-mail desta conta.
    useEffect(() => definirContaAtual(usuario), [usuario]);

    async function conectar() {
        setErroCarteira("");
        setConectando(true);
        try {
            await atualizarCarteira(await conectarCarteira());
        } catch (e) {
            setErroCarteira(mensagemDeErro(e, "Não foi possível conectar a carteira. Tente novamente."));
        } finally {
            setConectando(false);
        }
    }

    async function vincular() {
        setAvisoVinculo(null);
        setVinculando(true);
        try {
            await vincularCarteira(conta, usuario.email);
            await carregarSessao();
            setAvisoVinculo({ tipo: "sucesso", texto: "Carteira vinculada à sua conta." });
        } catch (e) {
            setAvisoVinculo({ tipo: "erro", texto: mensagemDeErro(e, "Não foi possível vincular a carteira.") });
        } finally {
            setVinculando(false);
        }
    }

    async function encerrar() {
        await sair();
        setUsuario(null);
        setOrganizacao(null);
    }

    // A carteira conectada e a mesma que a conta vinculou: so assim o
    // servidor aceita registros, comprovantes e consultas sensiveis.
    const vinculada = Boolean(usuario?.carteira && conta && usuario.carteira.toLowerCase() === conta.toLowerCase());
    const ativo = vinculo.ativo && vinculo.organizacaoAtiva;

    return {
        usuario, organizacao, carregandoSessao, aoAutenticar: carregarSessao, encerrar,
        conta, vinculo, verificando, conectando, erroCarteira, conectar,
        vinculada, vinculando, avisoVinculo, vincular,
        // Pode operar: carteira da conta, com vinculo ativo em organizacao ativa.
        liberado: Boolean(usuario && conta && !verificando && vinculo.ativo),
        operante: vinculada && ativo,
        ehDetran: vinculo.tipo === TIPO_ORGANIZACAO.DETRAN,
        ehAdministrador: vinculo.administrador,
        recarregar: () => Promise.all([carregarSessao(), atualizarCarteira(conta)])
    };
}
