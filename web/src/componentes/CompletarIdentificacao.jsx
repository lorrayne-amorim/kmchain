import { useEffect, useState } from "react";
import { mensagemDeErro } from "../lib/erros";
import { focarPrimeiroErro } from "../lib/foco";
import { LISTA_INICIAL, carregarMarcas } from "../lib/marcas";
import { alterarDado } from "../lib/registros";
import { avisar } from "../lib/toast";
import { UFS } from "../lib/veiculo";
import Aviso from "../ui/Aviso";
import Botao from "../ui/Botao";
import Campo from "../ui/Campo";
import SeletorMarca from "../ui/SeletorMarca";

const VAZIO = { placa: "", marca: null, modelo: "", anoFabricacao: "", anoModelo: "", uf: "", nomeProprietario: "", cpfProprietario: "" };

// Veiculo que tem eventos na blockchain mas esta sem identificacao no banco
// do KMChain (os dados complementares do cadastro nao foram salvos). Marca,
// modelo e anos nao ficam no contrato: sao informados aqui, conforme o
// documento do veiculo.
// Placa, UF e proprietario passam a valer na data do cadastro em cadeia.
export default function CompletarIdentificacao({ chassi, aoConcluir }) {
    const [dados, setDados] = useState(VAZIO);
    const [marcas, setMarcas] = useState(LISTA_INICIAL);
    const [erros, setErros] = useState({});
    const [falha, setFalha] = useState("");
    const [enviando, setEnviando] = useState(false);

    useEffect(() => {
        carregarMarcas().then(setMarcas).catch(() => { });
    }, []);

    const alterar = (campo, valor) => {
        setDados((d) => ({ ...d, [campo]: valor }));
        setErros((e) => ({ ...e, [campo]: undefined }));
    };

    async function salvar(e) {
        e.preventDefault();
        setFalha("");
        setEnviando(true);
        try {
            await alterarDado(chassi, "identificacao", {
                placa: dados.placa, marcaId: dados.marca?.id, modelo: dados.modelo,
                anoFabricacao: dados.anoFabricacao, anoModelo: dados.anoModelo, uf: dados.uf,
                nomeProprietario: dados.nomeProprietario, cpfProprietario: dados.cpfProprietario
            });
            avisar("Identificação do veículo registrada.");
            aoConcluir();
        } catch (erro) {
            if (erro.dados?.campos) {
                setErros(erro.dados.campos);
                focarPrimeiroErro();
            }
            setFalha(mensagemDeErro(erro, "Não foi possível registrar a identificação."));
        } finally {
            setEnviando(false);
        }
    }

    return (
        <form className="painel formulario" onSubmit={salvar} noValidate>
            <h2 className="painel-titulo">Completar identificação</h2>
            <p className="painel-texto">
                Este veículo tem eventos registrados na blockchain, mas está sem identificação no cadastro do
                KMChain. Marca, modelo, anos, placa e UF não ficam na blockchain: informe-os conforme o documento
                do veículo. Placa e UF passam a valer na data do cadastro.
            </p>

            <div className="grade-2">
                <SeletorMarca marcas={marcas} valor={dados.marca} erro={erros.marca}
                    aoEscolher={(m) => alterar("marca", m)} aoNovaMarca={(m) => setMarcas((l) => [...l, m])} />
                <Campo rotulo="Modelo" erro={erros.modelo}>
                    <input value={dados.modelo} maxLength={60} onChange={(e) => alterar("modelo", e.target.value)} />
                </Campo>
            </div>
            <div className="grade-2">
                <Campo rotulo="Ano de fabricação" erro={erros.anoFabricacao}>
                    <input inputMode="numeric" maxLength={4} value={dados.anoFabricacao}
                        onChange={(e) => alterar("anoFabricacao", e.target.value.replace(/\D/g, ""))} />
                </Campo>
                <Campo rotulo="Ano-modelo" erro={erros.anoModelo}>
                    <input inputMode="numeric" maxLength={4} value={dados.anoModelo}
                        onChange={(e) => alterar("anoModelo", e.target.value.replace(/\D/g, ""))} />
                </Campo>
            </div>
            <div className="grade-2">
                <Campo rotulo="Placa" erro={erros.placa}>
                    <input className="mono" value={dados.placa} maxLength={8} onChange={(e) => alterar("placa", e.target.value.toUpperCase())} />
                </Campo>
                <Campo rotulo="UF de registro na data do cadastro" erro={erros.uf}>
                    <select value={dados.uf} onChange={(e) => alterar("uf", e.target.value)}>
                        <option value="">Selecione</option>
                        {UFS.map(([sigla, nome]) => <option key={sigla} value={sigla}>{nome} ({sigla})</option>)}
                    </select>
                </Campo>
            </div>
            <p className="campo-rotulo">Proprietário na data do cadastro <span className="campo-opcional">(opcional)</span></p>
            <div className="grade-2">
                <Campo rotulo="Nome" erro={erros.nomeProprietario}>
                    <input value={dados.nomeProprietario} onChange={(e) => alterar("nomeProprietario", e.target.value)} />
                </Campo>
                <Campo rotulo="CPF" erro={erros.cpfProprietario}>
                    <input inputMode="numeric" value={dados.cpfProprietario} placeholder="000.000.000-00"
                        onChange={(e) => alterar("cpfProprietario", e.target.value)} />
                </Campo>
            </div>

            {falha && <Aviso tipo="erro">{falha}</Aviso>}
            <div className="acoes acoes-fim">
                <Botao type="submit" carregando={enviando}>Assinar e registrar</Botao>
            </div>
        </form>
    );
}
