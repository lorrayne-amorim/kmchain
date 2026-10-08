import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { mensagemDeErro } from "../../lib/erros";
import { ORGANIZACOES_CREDENCIAVEIS, rotuloDaOrganizacao } from "../../lib/eventos";
import { COR_DO_TIPO, SITUACOES, enderecoEmLinha } from "../../lib/organizacao";
import { listarOrganizacoes } from "../../lib/organizacoes";
import { useMunicipios } from "../../lib/useMunicipios";
import { UFS } from "../../lib/veiculo";
import Aviso from "../../ui/Aviso";
import Campo from "../../ui/Campo";
import { Vazio } from "../../ui/Pagina";

// O mapa (Leaflet) so e baixado por quem abre esta tela.
const Mapa = lazy(() => import("../../ui/Mapa"));

const semAcento = (texto) => String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Organizacoes credenciadas no mapa, pelo endereco cadastrado. Mostra onde
// cada organizacao fica; nao diz nada sobre onde um veiculo esteve.
export default function MapaOrganizacoes() {
    const [organizacoes, setOrganizacoes] = useState(null);
    const [erro, setErro] = useState("");
    const [tipo, setTipo] = useState("");
    const [uf, setUf] = useState("");
    const [cidade, setCidade] = useState("");
    const [selecionada, setSelecionada] = useState(null);
    const municipios = useMunicipios();

    useEffect(() => {
        let ativo = true;
        listarOrganizacoes()
            .then((lista) => ativo && setOrganizacoes(lista.filter((o) => o.tipo !== "DETRAN" && !o.removida)))
            .catch((e) => ativo && setErro(mensagemDeErro(e, "Não foi possível carregar as organizações.")));
        return () => { ativo = false; };
    }, []);

    const filtradas = useMemo(() => {
        if (!organizacoes) return [];
        const termo = semAcento(cidade.trim());
        return organizacoes.filter((o) => {
            const municipio = municipios?.municipioPorCodigo(o.municipio_ibge);
            return (!tipo || o.tipo === tipo)
                && (!uf || municipio?.uf === uf)
                && (!termo || semAcento(municipio?.nome).includes(termo));
        });
    }, [organizacoes, tipo, uf, cidade, municipios]);

    const pontos = useMemo(() => filtradas.map((o) => ({
        id: o.id, latitude: o.latitude, longitude: o.longitude, cor: COR_DO_TIPO[o.tipo], rotulo: o.nome_fantasia
    })), [filtradas]);

    const local = (o) => (municipios ? municipios.rotuloDoMunicipio(o.municipio_ibge) : "");
    const escolhida = filtradas.find((o) => o.id === selecionada);

    return (
        <div className="empilhado">
            <div className="painel mapa-filtros">
                <Campo rotulo="Tipo">
                    <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                        <option value="">Todos</option>
                        {ORGANIZACOES_CREDENCIAVEIS.map((o) => <option key={o.chave} value={o.chave}>{o.rotulo}</option>)}
                    </select>
                </Campo>
                <Campo rotulo="UF">
                    <select value={uf} onChange={(e) => setUf(e.target.value)}>
                        <option value="">Todas</option>
                        {UFS.map(([sigla, nome]) => <option key={sigla} value={sigla}>{nome} ({sigla})</option>)}
                    </select>
                </Campo>
                <Campo rotulo="Cidade">
                    <input type="search" value={cidade} placeholder="Buscar cidade" onChange={(e) => setCidade(e.target.value)} />
                </Campo>
            </div>

            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            <div className="mapa-grade">
                <Suspense fallback={<div className="mapa" />}>
                    <Mapa pontos={pontos} selecionado={selecionada} aoSelecionar={setSelecionada} rotulo="Mapa das organizações credenciadas" />
                </Suspense>

                <div className="painel mapa-lista">
                    {escolhida && (
                        <div className="mapa-detalhe" role="status">
                            <p className="painel-titulo">{escolhida.nome_fantasia}</p>
                            <dl className="lista-dados lista-dados-compacta">
                                <div><dt>Tipo</dt><dd>{rotuloDaOrganizacao(escolhida.tipo)}</dd></div>
                                <div><dt>Endereço</dt><dd>{enderecoEmLinha(escolhida)}<span className="celula-secundaria">{local(escolhida)}</span></dd></div>
                                <div><dt>Credenciamento</dt><dd>{SITUACOES[escolhida.situacao]}</dd></div>
                            </dl>
                        </div>
                    )}
                    {organizacoes && filtradas.length === 0 && (
                        <Vazio titulo="Nenhuma organização encontrada">Ajuste os filtros e tente novamente.</Vazio>
                    )}
                    <ul className="mapa-itens">
                        {filtradas.map((o) => (
                            <li key={o.id}>
                                <button type="button" aria-pressed={o.id === selecionada} onClick={() => setSelecionada(o.id)}>
                                    <span className="mapa-ponto" style={{ background: COR_DO_TIPO[o.tipo] }} aria-hidden="true" />
                                    <span>
                                        <span className="tarefa-titulo">{o.nome_fantasia}</span>
                                        <span className="tarefa-descricao">
                                            {rotuloDaOrganizacao(o.tipo)} · {local(o)}
                                            {o.situacao !== "ativa" && ` · ${SITUACOES[o.situacao]}`}
                                            {!Number.isFinite(o.latitude) && " · sem posição no mapa"}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <p className="dossie-nota">
                O mapa mostra o endereço cadastrado de cada organização credenciada no KMChain, sobre a base do
                OpenStreetMap. O credenciamento no KMChain faz parte de um protótipo acadêmico e não equivale a
                credenciamento oficial.
            </p>
        </div>
    );
}
