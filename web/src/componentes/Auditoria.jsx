import { useEffect, useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { dataHora } from "../lib/formato";
import { carregarAuditoria } from "../lib/registros";
import Aviso from "../ui/Aviso";
import Campo from "../ui/Campo";
import { Vazio } from "../ui/Pagina";
import Tabela from "../ui/Tabela";

const ACOES = {
    organizacao_criada: "Organização cadastrada",
    organizacao_credenciada: "Organização credenciada",
    organizacao_suspensa: "Organização suspensa",
    organizacao_reativada: "Organização reativada",
    organizacao_alterada: "Cadastro de organização alterado",
    organizacao_removida: "Organização removida",
    administrador_definido: "Administrador definido",
    administrador_removido: "Administração retirada",
    carteira_definida: "Carteira de conta definida pelo DETRAN",
    funcionario_cadastrado: "Funcionário vinculado",
    funcionario_desativado: "Funcionário desativado",
    funcionario_reativado: "Funcionário reativado",
    funcionario_removido: "Funcionário removido da equipe",
    correcao_solicitada: "Correção solicitada",
    correcao_aprovada: "Correção aprovada",
    correcao_rejeitada: "Correção rejeitada"
};

// O que a acao afetou, a partir dos detalhes gravados com ela.
function alvoDe({ detalhes: d }) {
    if (d.funcionario) return `${d.funcionario} · ${d.organizacao}`;
    if (d.administrador) return `${d.administrador}${d.nome ? ` · ${d.nome}` : ""}`;
    if (d.chassi) return `${d.chassi} · registro ${d.indice + 1}`;
    return d.nome ?? "—";
}

// Exclusivo do DETRAN. Trilha das acoes administrativas, guardada no banco
// do KMChain: a blockchain fica com os eventos de quilometragem.
export default function Auditoria() {
    const [registros, setRegistros] = useState(null);
    const [acao, setAcao] = useState("");
    const [erro, setErro] = useState("");

    useEffect(() => {
        let ativo = true;
        carregarAuditoria(acao)
            .then((lista) => ativo && setRegistros(lista))
            .catch((e) => ativo && setErro(mensagemDeErro(e, "Não foi possível carregar a auditoria.")));
        return () => { ativo = false; };
    }, [acao]);

    return (
        <div className="empilhado">
            <div className="painel">
                <Campo rotulo="Ação" className="campo-curto">
                    <select value={acao} onChange={(e) => setAcao(e.target.value)}>
                        <option value="">Todas</option>
                        {Object.entries(ACOES).map(([chave, rotulo]) => <option key={chave} value={chave}>{rotulo}</option>)}
                    </select>
                </Campo>
            </div>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="painel painel-tabela">
                {registros?.length === 0 && <Vazio titulo="Nenhuma ação registrada" />}
                {registros?.length > 0 && (
                    <Tabela
                        rotulo="Auditoria administrativa"
                        linhas={registros}
                        chave={(r) => r.id}
                        colunas={[
                            { titulo: "Quando", render: (r) => <span className="numero">{dataHora(new Date(r.criado_em))}</span> },
                            { titulo: "Ação", render: (r) => ACOES[r.acao] ?? r.acao },
                            { titulo: "Sobre", render: alvoDe },
                            { titulo: "Feita por", render: (r) => <>{r.usuario_nome}<span className="celula-secundaria">{r.organizacao_nome}</span></> }
                        ]}
                        itemMovel={(r) => (
                            <div className="item-movel">
                                <div className="item-movel-topo">
                                    <strong>{ACOES[r.acao] ?? r.acao}</strong>
                                    <span className="numero">{dataHora(new Date(r.criado_em))}</span>
                                </div>
                                <p className="item-movel-linha">{alvoDe(r)}</p>
                                <p className="item-movel-linha">{r.usuario_nome} · {r.organizacao_nome}</p>
                            </div>
                        )}
                    />
                )}
            </div>
        </div>
    );
}
