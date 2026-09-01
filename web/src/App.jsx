import { useState } from "react";
import ConsultaPublica from "./componentes/ConsultaPublica";
import RegistroLeitura from "./componentes/RegistroLeitura";
import CadastroVeiculo from "./componentes/CadastroVeiculo";
import CorrigirLeitura from "./componentes/CorrigirLeitura";

export default function App() {
  const [aba, setAba] = useState("consulta");

  return (
    <main>
      <header>
        <h1>KmChain</h1>
        <p>Histórico de quilometragem verificável por qualquer pessoa.</p>
      </header>

      <nav>
        <button onClick={() => setAba("consulta")}>Consultar</button>
        <button onClick={() => setAba("registro")}>Registrar leitura</button>
        <button onClick={() => setAba("cadastro")}>Cadastrar veículo</button>
        <button onClick={() => setAba("correcao")}>Corrigir leitura</button>
      </nav>

      {aba === "consulta" && <ConsultaPublica />}
      {aba === "registro" && <RegistroLeitura />}
      {aba === "cadastro" && <CadastroVeiculo />}
      {aba === "correcao" && <CorrigirLeitura />}
    </main>
  );
}