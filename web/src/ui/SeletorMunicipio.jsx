import { useState } from "react";
import { useMunicipios } from "../lib/useMunicipios";
import { UFS } from "../lib/veiculo";
import Campo from "./Campo";

// UF e cidade. O valor e o codigo IBGE do municipio (7 digitos), o mesmo
// gravado em cadeia como local do evento.
export default function SeletorMunicipio({ valor, aoEscolher, erro, rotuloCidade = "Cidade", ajuda }) {
    const municipios = useMunicipios();
    const [ufEscolhida, setUfEscolhida] = useState("");
    const uf = (valor && municipios?.municipioPorCodigo(valor)?.uf) || ufEscolhida;
    const cidades = municipios && uf ? municipios.municipiosDaUf(uf) : [];

    return (
        <div className="grade-2">
            <Campo rotulo="UF" erro={erro && !uf ? erro : undefined}>
                <select
                    value={uf}
                    onChange={(e) => {
                        setUfEscolhida(e.target.value);
                        aoEscolher("");
                    }}
                >
                    <option value="">Selecione</option>
                    {UFS.map(([sigla, nome]) => <option key={sigla} value={sigla}>{nome} ({sigla})</option>)}
                </select>
            </Campo>
            <Campo rotulo={rotuloCidade} erro={erro && uf ? erro : undefined} ajuda={erro ? undefined : ajuda}>
                <select value={valor || ""} disabled={!uf || !municipios} onChange={(e) => aoEscolher(e.target.value)}>
                    <option value="">{uf ? "Selecione" : "Escolha a UF"}</option>
                    {cidades.map((m) => <option key={m.codigo} value={m.codigo}>{m.nome}</option>)}
                </select>
            </Campo>
        </div>
    );
}
