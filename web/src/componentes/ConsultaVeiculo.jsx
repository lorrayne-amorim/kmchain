import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { contratoLeitura, papeisDasContas } from "../lib/blockchain";
import { normalizarChassi, validarChassi } from "../lib/formato";
import { carregarIdentificacao } from "../lib/identificacao";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import Dialogo from "../ui/Dialogo";
import Icone from "../ui/Icone";
import Historico, { EsqueletoHistorico } from "./Historico";

// A camera so e carregada quando alguem abre o leitor.
const LeitorQr = lazy(() => import("./LeitorQr"));

const lerChassiDaUrl = () => normalizarChassi(new URLSearchParams(window.location.search).get("chassi"));

// Consulta por chassi ou QR Code. Na home publica, o chassi consultado vai
// para a URL (?chassi=), o mesmo formato do QR - da para compartilhar o link
// e o botao voltar do celular retorna a busca. Na area institucional a mesma
// tela aparece compacta e permite abrir os comprovantes.
export default function ConsultaVeiculo({ institucional = false, chassiInicial = "" }) {
    const [inicial] = useState(() => (institucional ? normalizarChassi(chassiInicial) : lerChassiDaUrl()));
    const [chassi, setChassi] = useState(inicial);
    const [erroCampo, setErroCampo] = useState("");
    const [falha, setFalha] = useState(null); // { tipo: "nao-encontrado" | "rede", chassi }
    const [carregando, setCarregando] = useState(Boolean(inicial));
    const [resultado, setResultado] = useState(null);
    const [entidades, setEntidades] = useState({});
    const [identificacao, setIdentificacao] = useState(null);
    const [lendoQr, setLendoQr] = useState(false);
    const busca = useRef(0);
    const entrada = useRef(null);

    const buscar = useCallback(async (valor) => {
        const alvo = normalizarChassi(valor);
        const numeroBusca = ++busca.current;
        setFalha(null);
        setErroCampo("");
        setResultado(null);
        setEntidades({});
        setIdentificacao(null);

        const problema = validarChassi(alvo);
        if (problema) {
            setErroCampo(problema);
            setCarregando(false);
            return;
        }

        setCarregando(true);
        try {
            const contrato = contratoLeitura();
            const veiculo = await contrato.getVeiculo(alvo);
            if (numeroBusca !== busca.current) return;
            if (!veiculo.cadastrado) {
                setFalha({ tipo: "nao-encontrado", chassi: alvo });
                return;
            }
            const [historico, conformidade] = await Promise.all([
                contrato.getHistorico(alvo),
                contrato.conformidade(alvo)
            ]);
            if (numeroBusca !== busca.current) return;
            setResultado({
                chassi: alvo,
                veiculo,
                historico: [...historico],
                conforme: conformidade[0],
                possuiAtipicas: conformidade[5]
            });
            window.scrollTo(0, 0);

            // Funcao de cada entidade (DETRAN, vistoria, oficina): chega depois,
            // sem atrasar a exibicao do historico.
            // Placa, UF, marca e anos vem do banco (nao da blockchain) e chegam
            // depois; sem eles, o historico em cadeia aparece do mesmo jeito.
            carregarIdentificacao(alvo)
                .then((id) => numeroBusca === busca.current && setIdentificacao(id))
                .catch(() => { });

            papeisDasContas(historico.map((l) => l.entidade))
                .then((papeis) => numeroBusca === busca.current && setEntidades(papeis))
                .catch(() => { });
        } catch {
            if (numeroBusca === busca.current) setFalha({ tipo: "rede", chassi: alvo });
        } finally {
            if (numeroBusca === busca.current) setCarregando(false);
        }
    }, []);

    function consultar(valor) {
        const alvo = normalizarChassi(valor);
        if (!institucional && !validarChassi(alvo) && lerChassiDaUrl() !== alvo) {
            window.history.pushState(null, "", `?chassi=${alvo}`);
        }
        buscar(alvo);
    }

    function novaConsulta() {
        if (!institucional && lerChassiDaUrl()) window.history.pushState(null, "", window.location.pathname);
        busca.current++;
        setResultado(null);
        setFalha(null);
        setErroCampo("");
        setChassi("");
        setCarregando(false);
        window.scrollTo(0, 0);
    }

    // Abre direto pelo QR Code (/?chassi=XXXX) ou pelo "Ver historico" do painel.
    useEffect(() => {
        if (!inicial) return;
        const espera = setTimeout(() => buscar(inicial));
        return () => clearTimeout(espera);
    }, [inicial, buscar]);

    // Botao voltar/avancar do navegador na home publica.
    useEffect(() => {
        if (institucional) return;
        const aoNavegar = () => {
            const daUrl = lerChassiDaUrl();
            setChassi(daUrl);
            if (daUrl) {
                buscar(daUrl);
            } else {
                busca.current++;
                setResultado(null);
                setFalha(null);
                setErroCampo("");
                setCarregando(false);
            }
        };
        window.addEventListener("popstate", aoNavegar);
        return () => window.removeEventListener("popstate", aoNavegar);
    }, [institucional, buscar]);

    function lido(chassiLido) {
        setLendoQr(false);
        setChassi(chassiLido);
        consultar(chassiLido);
    }

    if (carregando) return <EsqueletoHistorico />;

    if (resultado) {
        return (
            <div className="consulta-resultado">
                <Botao variante="fantasma" tamanho="p" icone="voltar" className="voltar" onClick={novaConsulta}>
                    Nova consulta
                </Botao>
                <Historico {...resultado} identificacao={identificacao} entidades={entidades} institucional={institucional} />
            </div>
        );
    }

    const formulario = (
        <form
            className="busca-form"
            noValidate
            onSubmit={(e) => {
                e.preventDefault();
                consultar(chassi);
            }}
        >
            <Campo
                rotulo="Chassi do veículo"
                erro={erroCampo}
                ajuda={erroCampo ? undefined : "17 caracteres, como consta no documento do veículo."}
                contador={`${chassi.length}/17`}
            >
                <input
                    ref={entrada}
                    className="entrada-chassi mono"
                    value={chassi}
                    maxLength={17}
                    placeholder="Digite o chassi"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(e) => {
                        setChassi(normalizarChassi(e.target.value));
                        setErroCampo("");
                    }}
                />
            </Campo>
            <Botao type="submit" tamanho="g" largo={!institucional} icone="busca">
                Consultar histórico
            </Botao>
        </form>
    );

    const botaoQr = (
        <Botao variante="secundario" tamanho={institucional ? "normal" : "g"} largo={!institucional} icone="qr" onClick={() => setLendoQr(true)}>
            Escanear QR Code
        </Botao>
    );

    const falhaNaBusca = falha && (
        falha.tipo === "nao-encontrado" ? (
            <Aviso tipo="info" titulo="Nenhum veículo encontrado">
                Não encontramos um veículo com o chassi <span className="mono">{falha.chassi}</span>.
                Confira os caracteres e tente novamente.
            </Aviso>
        ) : (
            <Aviso
                tipo="erro"
                titulo="Não foi possível consultar agora"
                acao={<Botao variante="secundario" tamanho="p" onClick={() => buscar(falha.chassi)}>Tentar novamente</Botao>}
            >
                Verifique sua conexão e tente novamente.
            </Aviso>
        )
    );

    const dialogoQr = (
        <Dialogo aberto={lendoQr} aoFechar={() => setLendoQr(false)} titulo="Escanear QR Code" variante="camera">
            {lendoQr && (
                <Suspense fallback={<div className="leitor-camera" />}>
                    <LeitorQr
                        aoLer={lido}
                        aoDigitar={() => {
                            setLendoQr(false);
                            setTimeout(() => entrada.current?.focus(), 0);
                        }}
                    />
                </Suspense>
            )}
        </Dialogo>
    );

    if (institucional) {
        return (
            <div className="busca-compacta">
                <div className="painel">
                    {formulario}
                    <div className="busca-compacta-alternativa">
                        <span>ou</span>
                        {botaoQr}
                    </div>
                </div>
                {falhaNaBusca}
                {dialogoQr}
            </div>
        );
    }

    return (
        <section className="busca" aria-labelledby="titulo-busca">
            <h1 id="titulo-busca" className="busca-titulo">Consulte o histórico de um veículo</h1>
            <p className="busca-descricao">
                Veja a quilometragem registrada ao longo do tempo pelas entidades credenciadas no KmChain.
            </p>

            {formulario}

            <div className="separador-ou" aria-hidden="true"><span>ou</span></div>

            {botaoQr}
            <p className="busca-nota">
                <Icone nome="info" tamanho={14} />
                O QR Code fica na etiqueta do veículo ou no laudo de vistoria.
            </p>

            {falhaNaBusca}
            {dialogoQr}
        </section>
    );
}
