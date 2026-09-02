import { useEffect, useState } from "react";
import ConsultaPublica from "./componentes/ConsultaPublica";
import RegistroLeitura from "./componentes/RegistroLeitura";
import CadastroVeiculo from "./componentes/CadastroVeiculo";
import CorrigirLeitura from "./componentes/CorrigirLeitura";
import CredenciarEntidade from "./componentes/CredenciarEntidade";
import { conectarCarteira, contaConectada, papeisDaConta } from "./lib/blockchain";

const SEM_PAPEIS = { admin: false, detran: false, vistoria: false, oficina: false };

export default function App() {
  // "publico" e a home de qualquer pessoa: so a consulta, sem carteira.
  // "profissional" e o painel do DETRAN/vistoria/oficina, atras da carteira.
  const [modo, setModo] = useState("publico");
  const [aba, setAba] = useState("registro");
  const [conta, setConta] = useState(null);
  const [papeis, setPapeis] = useState(SEM_PAPEIS);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState("");

  async function atualizar(endereco) {
    setConta(endereco);
    setPapeis(endereco ? await papeisDaConta(endereco) : SEM_PAPEIS);
  }

  // Reconecta sozinho se a carteira ja estava autorizada neste site,
  // e acompanha troca de conta feita direto na extensao.
  useEffect(() => {
    contaConectada().then(atualizar).catch(() => {});
    if (!window.ethereum) return;
    const aoTrocarConta = (contas) => atualizar(contas[0] ?? null);
    window.ethereum.on("accountsChanged", aoTrocarConta);
    return () => window.ethereum.removeListener("accountsChanged", aoTrocarConta);
  }, []);

  const credenciada = papeis.detran || papeis.vistoria || papeis.oficina;

  // Se a conta perder o papel que dava acesso a aba aberta (ex.: trocou de
  // carteira), volta para uma aba que ela ainda pode ver em vez de travar a tela.
  useEffect(() => {
    if ((aba === "cadastro" || aba === "correcao") && !papeis.detran) setAba("registro");
    if (aba === "credenciar" && !papeis.admin) setAba("registro");
    if (aba === "registro" && !credenciada && papeis.admin) setAba("credenciar");
  }, [aba, papeis, credenciada]);

  async function conectar() {
    setErro("");
    setConectando(true);
    try {
      await atualizar(await conectarCarteira());
    } catch (e) {
      setErro(e.message);
    } finally {
      setConectando(false);
    }
  }

  if (modo === "publico") {
    return (
      <main>
        <header>
          <div className="marca">
            <img className="logo" src="/logo.png" alt="" />
            <h1>Km<span className="acento">Chain</span></h1>
          </div>
          <p>Histórico de quilometragem verificável por qualquer pessoa.</p>
        </header>

        <ConsultaPublica />

        <footer className="rodape">
          <button className="acesso-profissional" onClick={() => setModo("profissional")}>
            Acesso para DETRAN, vistoria e oficinas credenciadas →
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main>
      <header>
        <button className="link voltar" onClick={() => setModo("publico")}>
          ← Consulta pública
        </button>
        <div className="marca">
          <img className="logo" src="/logo.png" alt="" />
          <h1>Km<span className="acento">Chain</span></h1>
        </div>
        <p className="etiqueta-modo">Painel profissional</p>

        {conta ? (
          <p className="carteira">
            Conectado: {conta.slice(0, 6)}...{conta.slice(-4)}
            {papeis.detran && <span className="papel">DETRAN</span>}
            {papeis.vistoria && <span className="papel">Vistoria</span>}
            {papeis.oficina && <span className="papel">Oficina</span>}
          </p>
        ) : (
          <button onClick={conectar} disabled={conectando}>
            {conectando ? "Conectando..." : "Conectar carteira"}
          </button>
        )}
        {erro && <p className="erro">{erro}</p>}
      </header>

      {!conta && (
        <p className="aviso central">
          Conecte a carteira credenciada pelo DETRAN, por uma vistoria ou por uma
          oficina para acessar o painel.
        </p>
      )}

      {conta && !credenciada && !papeis.admin && (
        <p className="erro central">
          Esta carteira não tem nenhum papel credenciado no KmChain.
        </p>
      )}

      {conta && (credenciada || papeis.admin) && (
        <>
          <nav>
            {credenciada && (
              <button aria-current={aba === "registro"} onClick={() => setAba("registro")}>
                Registrar leitura
              </button>
            )}
            {papeis.detran && (
              <button aria-current={aba === "cadastro"} onClick={() => setAba("cadastro")}>
                Cadastrar veículo
              </button>
            )}
            {papeis.detran && (
              <button aria-current={aba === "correcao"} onClick={() => setAba("correcao")}>
                Corrigir leitura
              </button>
            )}
            {papeis.admin && (
              <button aria-current={aba === "credenciar"} onClick={() => setAba("credenciar")}>
                Credenciar entidade
              </button>
            )}
          </nav>

          {aba === "registro" && credenciada && <RegistroLeitura />}
          {aba === "cadastro" && papeis.detran && <CadastroVeiculo />}
          {aba === "correcao" && papeis.detran && <CorrigirLeitura />}
          {aba === "credenciar" && papeis.admin && <CredenciarEntidade />}
        </>
      )}
    </main>
  );
}
