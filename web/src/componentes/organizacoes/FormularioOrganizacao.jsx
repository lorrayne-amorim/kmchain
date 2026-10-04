import { Suspense, lazy, useCallback, useState } from "react";
import { mensagemDeErro } from "../../lib/erros";
import { ORGANIZACOES_CREDENCIAVEIS } from "../../lib/eventos";
import { focarPrimeiroErro } from "../../lib/foco";
import { buscarCep, localizarEndereco } from "../../lib/geocodificacao";
import { COR_DO_TIPO, coordenadasValidas, problemasDaOrganizacao } from "../../lib/organizacao";
import { atualizarOrganizacao, cadastrarOrganizacao } from "../../lib/organizacoes";
import { useMunicipios } from "../../lib/useMunicipios";
import Aviso from "../../ui/Aviso";
import Botao from "../../ui/Botao";
import Campo from "../../ui/Campo";
import SeletorMunicipio from "../../ui/SeletorMunicipio";

const Mapa = lazy(() => import("../../ui/Mapa"));

const VAZIO = {
    tipo: "OFICINA", razaoSocial: "", nomeFantasia: "", cnpj: "", telefone: "", email: "", cep: "", logradouro: "",
    numero: "", complemento: "", bairro: "", municipio: "", latitude: "", longitude: "", administradorEmail: ""
};

const doCadastro = (o) => ({
    tipo: o.tipo, razaoSocial: o.razao_social, nomeFantasia: o.nome_fantasia, cnpj: o.cnpj ?? "", telefone: o.telefone ?? "",
    email: o.email ?? "", cep: o.cep ?? "", logradouro: o.logradouro ?? "", numero: o.numero ?? "", complemento: o.complemento ?? "",
    bairro: o.bairro ?? "", municipio: o.municipio_ibge ? String(o.municipio_ibge) : "",
    latitude: o.latitude ?? "", longitude: o.longitude ?? "", administradorEmail: ""
});

// Cadastro de uma organizacao pelo DETRAN (ou alteracao dos dados
// cadastrais, quando `organizacao` e informada). Tudo aqui fica no banco do
// KMChain; em cadeia vao so o tipo, o identificador e o administrador.
export default function FormularioOrganizacao({ organizacao, aoSalvar, aoCancelar }) {
    const editando = Boolean(organizacao);
    const [dados, setDados] = useState(() => (organizacao ? doCadastro(organizacao) : VAZIO));
    const [erros, setErros] = useState({});
    const [falha, setFalha] = useState("");
    const [enviando, setEnviando] = useState(false);
    const [localizando, setLocalizando] = useState(false);
    const [avisoLocal, setAvisoLocal] = useState("");
    const municipios = useMunicipios();

    const alterar = (campo, valor) => {
        setDados((d) => ({ ...d, [campo]: valor }));
        setErros((e) => ({ ...e, [campo]: undefined }));
    };

    // Preenche o endereco pelo CEP (ViaCEP), sem sobrescrever o que ja foi digitado.
    async function preencherPeloCep() {
        const endereco = await buscarCep(dados.cep).catch(() => null);
        if (!endereco) return;
        setDados((d) => ({
            ...d,
            logradouro: d.logradouro || endereco.logradouro,
            bairro: d.bairro || endereco.bairro,
            municipio: endereco.municipio || d.municipio
        }));
    }

    async function localizar() {
        setAvisoLocal("");
        const municipio = municipios?.municipioPorCodigo(dados.municipio);
        if (!municipio || !dados.logradouro) return setAvisoLocal("Informe o logradouro, a UF e a cidade antes de localizar.");
        setLocalizando(true);
        try {
            const posicao = await localizarEndereco({ logradouro: dados.logradouro, numero: dados.numero, cidade: municipio.nome, uf: municipio.uf });
            if (!posicao) return setAvisoLocal("Endereço não encontrado. Clique no mapa para marcar a posição.");
            setDados((d) => ({ ...d, ...posicao }));
        } catch {
            setAvisoLocal("Não foi possível consultar o serviço de mapas. Clique no mapa para marcar a posição.");
        } finally {
            setLocalizando(false);
        }
    }

    const marcarNoMapa = useCallback((posicao) => setDados((d) => ({ ...d, ...posicao })), []);

    async function salvar(e) {
        e.preventDefault();
        setFalha("");
        const novos = problemasDaOrganizacao(dados);
        if (!editando && !dados.administradorEmail.trim()) novos.email_administrador = "Informe o e-mail da conta do administrador.";
        setErros(novos);
        if (Object.keys(novos).length > 0) return focarPrimeiroErro();

        setEnviando(true);
        try {
            const r = editando ? await atualizarOrganizacao(organizacao.id, dados) : await cadastrarOrganizacao(dados);
            aoSalvar(r);
        } catch (erro) {
            if (erro.dados?.campos) {
                const { email, ...campos } = erro.dados.campos;
                // "email" na resposta de conta nao encontrada e o do administrador.
                setErros(erro.codigo?.startsWith("conta_") ? { ...campos, email_administrador: email } : erro.dados.campos);
                focarPrimeiroErro();
            }
            setFalha(mensagemDeErro(erro, "Não foi possível salvar a organização."));
        } finally {
            setEnviando(false);
        }
    }

    const comPosicao = coordenadasValidas(dados.latitude, dados.longitude);
    const pontos = comPosicao
        ? [{ id: 1, latitude: Number(dados.latitude), longitude: Number(dados.longitude), cor: COR_DO_TIPO[dados.tipo], rotulo: dados.nomeFantasia }]
        : [];

    return (
        <form className="painel formulario" onSubmit={salvar} noValidate>
            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">1</span>Organização</legend>
                <div className="grade-2">
                    <Campo rotulo="Tipo" erro={erros.tipo} ajuda={editando ? "O tipo é gravado em cadeia no credenciamento e não muda." : undefined}>
                        <select value={dados.tipo} disabled={editando} onChange={(e) => alterar("tipo", e.target.value)}>
                            {ORGANIZACOES_CREDENCIAVEIS.map((o) => <option key={o.chave} value={o.chave}>{o.rotulo}</option>)}
                        </select>
                    </Campo>
                    <Campo rotulo="CNPJ" erro={erros.cnpj}>
                        <input inputMode="numeric" value={dados.cnpj} disabled={editando} placeholder="00.000.000/0000-00"
                            onChange={(e) => alterar("cnpj", e.target.value)} />
                    </Campo>
                </div>
                <div className="grade-2">
                    <Campo rotulo="Razão social" erro={erros.razaoSocial}>
                        <input value={dados.razaoSocial} maxLength={120} onChange={(e) => alterar("razaoSocial", e.target.value)} />
                    </Campo>
                    <Campo rotulo="Nome fantasia" erro={erros.nomeFantasia} ajuda={erros.nomeFantasia ? undefined : "É o nome mostrado na consulta pública."}>
                        <input value={dados.nomeFantasia} maxLength={80} onChange={(e) => alterar("nomeFantasia", e.target.value)} />
                    </Campo>
                </div>
                <div className="grade-2">
                    <Campo rotulo="Telefone" erro={erros.telefone}>
                        <input inputMode="tel" value={dados.telefone} placeholder="(00) 00000-0000" onChange={(e) => alterar("telefone", e.target.value)} />
                    </Campo>
                    <Campo rotulo="E-mail" erro={erros.email}>
                        <input type="email" value={dados.email} onChange={(e) => alterar("email", e.target.value)} />
                    </Campo>
                </div>
            </fieldset>

            <fieldset className="grupo">
                <legend className="grupo-titulo"><span className="grupo-numero">2</span>Endereço</legend>
                <div className="grade-2">
                    <Campo rotulo="CEP" erro={erros.cep} ajuda={erros.cep ? undefined : "O endereço é preenchido pelo CEP."}>
                        <input inputMode="numeric" value={dados.cep} maxLength={9} onBlur={preencherPeloCep} onChange={(e) => alterar("cep", e.target.value)} />
                    </Campo>
                    <Campo rotulo="Bairro" erro={erros.bairro}>
                        <input value={dados.bairro} onChange={(e) => alterar("bairro", e.target.value)} />
                    </Campo>
                </div>
                <Campo rotulo="Logradouro" erro={erros.logradouro}>
                    <input value={dados.logradouro} onChange={(e) => alterar("logradouro", e.target.value)} />
                </Campo>
                <div className="grade-2">
                    <Campo rotulo="Número" erro={erros.numero}>
                        <input value={dados.numero} maxLength={10} onChange={(e) => alterar("numero", e.target.value)} />
                    </Campo>
                    <Campo rotulo="Complemento" opcional>
                        <input value={dados.complemento} maxLength={60} onChange={(e) => alterar("complemento", e.target.value)} />
                    </Campo>
                </div>
                <SeletorMunicipio valor={dados.municipio} erro={erros.municipio} aoEscolher={(codigo) => alterar("municipio", codigo)} />

                <div className="campo">
                    <span className="campo-rotulo">Posição no mapa <span className="campo-opcional">(opcional)</span></span>
                    <div className="acoes">
                        <Botao variante="secundario" tamanho="p" carregando={localizando} onClick={localizar}>Localizar pelo endereço</Botao>
                        <span className="texto-3">
                            {comPosicao ? `${Number(dados.latitude).toFixed(5)}, ${Number(dados.longitude).toFixed(5)}` : "Sem posição: a organização não aparece no mapa."}
                        </span>
                    </div>
                    <Suspense fallback={<div className="mapa mapa-pequeno" />}>
                        <div className="mapa-pequeno">
                            <Mapa pontos={pontos} aoClicar={marcarNoMapa} rotulo="Posição da organização" />
                        </div>
                    </Suspense>
                    <p className="campo-ajuda">Clique no mapa para ajustar a posição.</p>
                    {(avisoLocal || erros.latitude) && <p className="campo-erro">{avisoLocal || erros.latitude}</p>}
                </div>
            </fieldset>

            {!editando && (
                <fieldset className="grupo">
                    <legend className="grupo-titulo"><span className="grupo-numero">3</span>Administrador responsável</legend>
                    <Campo rotulo="E-mail da conta do administrador" erro={erros.email_administrador}
                        ajuda={erros.email_administrador ? undefined : "A pessoa precisa ter criado a conta no acesso institucional e vinculado a carteira."}>
                        <input type="email" value={dados.administradorEmail} onChange={(e) => alterar("administradorEmail", e.target.value)} />
                    </Campo>
                </fieldset>
            )}

            {falha && <Aviso tipo="erro">{falha}</Aviso>}
            <div className="acoes acoes-fim">
                <Botao variante="secundario" onClick={aoCancelar}>Cancelar</Botao>
                <Botao type="submit" carregando={enviando}>{editando ? "Salvar alterações" : "Cadastrar organização"}</Botao>
            </div>
        </form>
    );
}
