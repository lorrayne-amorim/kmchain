import { Suspense, lazy } from "react";
import Cabecalho, { Rodape } from "./componentes/Cabecalho";
import ConsultaVeiculo from "./componentes/ConsultaVeiculo";
import { useRota } from "./lib/rota";
import Pagina from "./ui/Pagina";
import Toasts from "./ui/Toasts";

// A area institucional so e baixada por quem entra nela.
const Painel = lazy(() => import("./componentes/Painel"));
const MapaOrganizacoes = lazy(() => import("./componentes/organizacoes/MapaOrganizacoes"));

// Dois contextos com a mesma identidade: a area publica (consulta e mapa das
// organizacoes, para qualquer pessoa, sem conta) e a area institucional
// (DETRAN, oficinas, empresas de vistoria e seguradoras).
export default function App() {
    const rota = useRota();

    return (
        <>
            {/* O hash guarda a rota, entao o atalho foca o conteudo sem mudar a URL. */}
            <a
                className="pular-conteudo"
                href="#conteudo"
                onClick={(e) => {
                    e.preventDefault();
                    document.getElementById("conteudo")?.focus();
                }}
            >
                Pular para o conteúdo
            </a>

            {rota.area === "institucional" ? (
                <Suspense fallback={null}>
                    <Painel secao={rota.secao} />
                </Suspense>
            ) : (
                <>
                    <Cabecalho
                        acoes={<a className="botao botao-fantasma botao-p" href="#/institucional">Acesso institucional</a>}
                    />
                    <main id="conteudo" className="publico" tabIndex={-1}>
                        {rota.area === "organizacoes" ? (
                            <div className="conteiner">
                                <Suspense fallback={null}>
                                    <Pagina titulo="Organizações credenciadas" descricao="Oficinas, empresas de vistoria e seguradoras que registram eventos no KMChain.">
                                        <a className="botao botao-fantasma botao-p voltar" href="#/">Consultar um veículo</a>
                                        <MapaOrganizacoes />
                                    </Pagina>
                                </Suspense>
                            </div>
                        ) : (
                            <div className="conteiner conteiner-leitura">
                                <ConsultaVeiculo />
                            </div>
                        )}
                    </main>
                    <Rodape />
                </>
            )}

            <Toasts />
        </>
    );
}
