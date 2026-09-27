import { linkTransacao } from "../lib/blockchain";
import { encurtar, numero } from "../lib/formato";
import Copiar from "./Copiar";
import Icone from "./Icone";

const PASSOS = {
    documento: "Enviando o comprovante",
    assinatura: "Aguardando sua assinatura na carteira",
    confirmacao: "Confirmando o registro"
};

// Etapas de uma operacao que grava no historico.
export function Progresso({ passo, comDocumento = false }) {
    const ordem = [comDocumento && "documento", "assinatura", "confirmacao"].filter(Boolean);
    const atual = ordem.indexOf(passo);

    return (
        <ol className="progresso" aria-live="polite">
            {ordem.map((p, i) => {
                const estado = i < atual ? "feito" : i === atual ? "atual" : "pendente";
                return (
                    <li key={p} className={`progresso-${estado}`}>
                        <span className="progresso-marcador" aria-hidden="true">
                            {estado === "feito" && <Icone nome="check" tamanho={12} />}
                            {estado === "atual" && <Icone nome="carregando" tamanho={14} className="girando" />}
                        </span>
                        {PASSOS[p]}
                        {estado === "atual" && <span className="visualmente-oculto"> (em andamento)</span>}
                    </li>
                );
            })}
        </ol>
    );
}

export function DetalhesTecnicos({ recibo }) {
    return (
        <details className="tecnico">
            <summary>Detalhes técnicos</summary>
            <dl className="lista-dados lista-dados-compacta">
                <div>
                    <dt>Transação</dt>
                    <dd>
                        <span className="mono">{encurtar(recibo.hash, 10, 8)}</span>
                        <Copiar texto={recibo.hash} rotulo="Copiar identificador da transação" />
                        <a href={linkTransacao(recibo.hash)} target="_blank" rel="noreferrer" className="link-externo">
                            Abrir no explorador <Icone nome="externo" tamanho={13} />
                        </a>
                    </dd>
                </div>
                <div>
                    <dt>Gas consumido</dt>
                    <dd>{numero(recibo.gas)}</dd>
                </div>
            </dl>
        </details>
    );
}

// Estado de sucesso de uma operacao importante.
export function Concluido({ titulo, children, acoes, recibo }) {
    return (
        <div className="painel concluido" role="status">
            <p className="concluido-titulo">
                <span className="concluido-icone" aria-hidden="true"><Icone nome="check" tamanho={16} /></span>
                {titulo}
            </p>
            {children && <div className="concluido-texto">{children}</div>}
            {acoes && <div className="acoes">{acoes}</div>}
            {recibo && <DetalhesTecnicos recibo={recibo} />}
        </div>
    );
}
