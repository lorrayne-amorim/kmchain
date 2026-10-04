// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KmChainRegistryV2
/// @notice Registro de eventos com quilometragem, feitos por organizacoes
///         credenciadas pelo DETRAN. Sucede o KmChainRegistry (v1).
///
/// @dev O que cada evento guarda em cadeia:
///   - o veiculo, pela CHAVE keccak256(chassi normalizado), calculada fora da
///     cadeia (web/src/lib/chassi.js). O chassi em texto nunca e enviado. A
///     chave e um pseudonimo: quem conhece o chassi localiza o historico;
///   - quilometragem e tipo do evento;
///   - DATA DO EVENTO (quando a vistoria, revisao etc. aconteceu), informada
///     por quem registra, e DATA DO BLOCO (quando o registro entrou em cadeia);
///   - MUNICIPIO do evento, pelo codigo IBGE de 7 digitos (os dois primeiros
///     identificam a UF). Endereco completo fica fora da cadeia;
///   - ORGANIZACAO responsavel (identificador sequencial) e a carteira do
///     USUARIO que assinou. Nome, CNPJ, endereco e dados pessoais ficam no
///     banco; aqui so os identificadores;
///   - REFERENCIA a outro evento do mesmo veiculo, usada na correcao;
///   - hash SHA-256 do comprovante, quando houver.
///
/// O contrato tambem mantem o cadastro minimo das organizacoes (tipo, situacao
/// e administrador) e o vinculo de cada carteira. A organizacao de um evento
/// vem do vinculo de quem assina, nunca de um parametro declarado, e so
/// registra quem esta ativo numa organizacao ativa. Por isso todo evento
/// gravado prova que o credenciamento valia naquele momento.
///
/// Correcao: nenhum evento e alterado. A correcao e um evento novo que aponta
/// para o original; a ligacao inversa fica num indice separado (correcaoDe).
///
/// Migracao: os registros da v1 nao sao copiados (reescreve-los mudaria
/// autoria e data). A v1 continua legivel e `contratoAnterior` aponta para ela.
contract KmChainRegistryV2 {
    enum TipoOrganizacao { NENHUM, DETRAN, OFICINA, VISTORIA, SEGURADORA }

    // Tipos de evento com funcao propria; os demais entram por registrarEvento
    // conforme a matriz `tiposPermitidos`. O catalogo com os nomes fica em
    // web/src/lib/eventos.js.
    uint8 public constant TIPO_CADASTRO_INICIAL = 0;
    uint8 public constant TIPO_CORRECAO = 1;

    uint32 public constant ORGANIZACAO_DETRAN = 1;
    uint32 public constant SEM_REFERENCIA = type(uint32).max;

    /// @notice Atraso maximo entre o evento e o seu registro em cadeia.
    uint64 public constant ATRASO_MAXIMO = 30 days;

    // --------------------------------------------------------------- structs
    // Um slot: 8 + 8 + 64 + 160 = 240 bits.
    struct Organizacao {
        uint8   tipo;
        bool    ativa;
        uint64  credenciadaEm;
        address administrador;
    }

    struct Vinculo {
        uint32 organizacao;
        bool   ativo;
    }

    // Slot 1: km | dataEvento | dataBloco | municipio | tipo | atipica
    // Slot 2: responsavel | organizacao | referencia
    // Slot 3: hashDocumento
    struct Evento {
        uint64  km;
        uint64  dataEvento;
        uint64  dataBloco;
        uint32  municipio;
        uint8   tipo;
        bool    atipica;
        address responsavel;
        uint32  organizacao;
        uint32  referencia;
        bytes32 hashDocumento;
    }

    // Um slot: 8 + 32*3 + 64*2 = 232 bits.
    struct Veiculo {
        bool    cadastrado;
        uint32  limiteDiario;     // 0 = limite padrao
        uint32  totalEventos;
        uint32  totalCorrecoes;
        uint64  ultimaKm;
        uint64  ultimaDataEvento;
    }

    mapping(uint32 => Organizacao) private _organizacoes;
    mapping(address => Vinculo)    private _vinculos;
    mapping(bytes32 => Veiculo)    private _veiculos;
    mapping(bytes32 => Evento[])   private _historico;
    // indice do evento corrigido => indice da correcao (0 = nao corrigido; o
    // indice 0 e sempre o cadastro inicial, que nunca e uma correcao).
    mapping(bytes32 => mapping(uint256 => uint256)) private _correcaoDe;

    uint32 public totalOrganizacoes;

    /// @notice Tipos de evento permitidos a cada tipo de organizacao (bit n = tipo n).
    mapping(uint8 => uint256) public tiposPermitidos;

    /// @notice Avanco diario acima do qual o evento exige confirmacao.
    uint32 public limiteDiarioPadrao = 1000;
    address public immutable contratoAnterior;

    // --------------------------------------------------------------- eventos
    // So identificadores: o conteudo esta no estado e e lido por chamada.
    event VeiculoCadastrado(bytes32 indexed chave);
    event EventoRegistrado(bytes32 indexed chave, uint256 indice);
    event LeituraCorrigida(bytes32 indexed chave, uint256 indiceOriginal, uint256 indiceCorrecao);
    event OrganizacaoCredenciada(uint32 indexed organizacao, uint8 tipo);
    event SituacaoDaOrganizacaoAlterada(uint32 indexed organizacao, bool ativa);
    event AdministradorDefinido(uint32 indexed organizacao, address indexed administrador);
    event FuncionarioDefinido(uint32 indexed organizacao, address indexed carteira, bool ativo);
    event TiposPermitidosAlterados(uint8 indexed tipoOrganizacao, uint256 tipos);

    // ----------------------------------------------------------------- erros
    error VeiculoJaCadastrado();
    error VeiculoNaoCadastrado();
    error ChaveInvalida();
    error QuilometragemRegressiva(uint256 enviada, uint256 ultima);
    error LeituraAtipica(uint256 avanco, uint256 limite, uint256 dias);
    error DataDoEventoInvalida();
    error MunicipioInvalido();
    error IndiceInvalido();
    error LeituraJaCorrigida();
    error SemVinculoAtivo(address carteira);
    error OrganizacaoInativa(uint32 organizacao);
    error OrganizacaoInexistente(uint32 organizacao);
    error ApenasDetran(address carteira);
    error ApenasAdministrador(address carteira);
    error TipoNaoPermitido(uint8 tipoOrganizacao, uint8 tipoEvento);
    error TipoDeOrganizacaoInvalido();
    error CarteiraInvalida();
    error CarteiraDeOutraOrganizacao(address carteira, uint32 organizacao);
    error AdministradorNaoPodeSerDesativado();
    error DetranNaoPodeSerSuspenso();

    constructor(address anterior) {
        contratoAnterior = anterior;

        // O DETRAN e a organizacao 1; quem implanta e o primeiro administrador.
        totalOrganizacoes = ORGANIZACAO_DETRAN;
        _organizacoes[ORGANIZACAO_DETRAN] = Organizacao({
            tipo: uint8(TipoOrganizacao.DETRAN),
            ativa: true,
            credenciadaEm: uint64(block.timestamp),
            administrador: address(0)
        });
        emit OrganizacaoCredenciada(ORGANIZACAO_DETRAN, uint8(TipoOrganizacao.DETRAN));
        _definirAdministrador(ORGANIZACAO_DETRAN, msg.sender);

        // Matriz inicial (codigos em web/src/lib/eventos.js). Ajustavel pelo DETRAN.
        _permitir(TipoOrganizacao.DETRAN,     _faixa(2, 3));
        _permitir(TipoOrganizacao.OFICINA,    _faixa(10, 15));
        _permitir(TipoOrganizacao.VISTORIA,   _faixa(20, 25));
        _permitir(TipoOrganizacao.SEGURADORA, _faixa(30, 32));
    }

    // ------------------------------------------------------------ permissoes
    modifier apenasDetran() {
        Vinculo storage v = _vinculos[msg.sender];
        if (!v.ativo || _organizacoes[v.organizacao].tipo != uint8(TipoOrganizacao.DETRAN)) {
            revert ApenasDetran(msg.sender);
        }
        _;
    }

    // A validacao do chassi acontece fora da cadeia (o contrato nunca o ve);
    // aqui so se recusa a chave vazia.
    modifier chaveValida(bytes32 chave) {
        if (chave == bytes32(0)) revert ChaveInvalida();
        _;
    }

    function _faixa(uint8 de, uint8 ate) private pure returns (uint256 tipos) {
        for (uint8 t = de; t <= ate; t++) tipos |= uint256(1) << t;
    }

    function _permitir(TipoOrganizacao tipo, uint256 tipos) private {
        // Cadastro e correcao nunca entram pela matriz.
        tipos &= ~((uint256(1) << TIPO_CADASTRO_INICIAL) | (uint256(1) << TIPO_CORRECAO));
        tiposPermitidos[uint8(tipo)] = tipos;
        emit TiposPermitidosAlterados(uint8(tipo), tipos);
    }

    function definirTiposPermitidos(TipoOrganizacao tipo, uint256 tipos) external apenasDetran {
        if (tipo == TipoOrganizacao.NENHUM) revert TipoDeOrganizacaoInvalido();
        _permitir(tipo, tipos);
    }

    // Organizacao e tipo de quem assina; exige vinculo ativo em organizacao ativa.
    function _vinculoAtivo(address carteira) private view returns (uint32 organizacao, uint8 tipo) {
        Vinculo storage v = _vinculos[carteira];
        if (!v.ativo) revert SemVinculoAtivo(carteira);
        Organizacao storage o = _organizacoes[v.organizacao];
        if (!o.ativa) revert OrganizacaoInativa(v.organizacao);
        return (v.organizacao, o.tipo);
    }

    // ---------------------------------------------------------- organizacoes
    /// @notice Credencia uma organizacao e define o seu administrador.
    function credenciarOrganizacao(TipoOrganizacao tipo, address administrador)
        external
        apenasDetran
        returns (uint32 organizacao)
    {
        if (tipo == TipoOrganizacao.NENHUM || tipo == TipoOrganizacao.DETRAN) revert TipoDeOrganizacaoInvalido();
        organizacao = ++totalOrganizacoes;
        _organizacoes[organizacao] = Organizacao({
            tipo: uint8(tipo),
            ativa: true,
            credenciadaEm: uint64(block.timestamp),
            administrador: address(0)
        });
        emit OrganizacaoCredenciada(organizacao, uint8(tipo));
        _definirAdministrador(organizacao, administrador);
    }

    /// @notice Suspende ou reativa uma organizacao. Os eventos ja registrados permanecem.
    function definirSituacaoDaOrganizacao(uint32 organizacao, bool ativa) external apenasDetran {
        _exigirOrganizacao(organizacao);
        if (organizacao == ORGANIZACAO_DETRAN) revert DetranNaoPodeSerSuspenso();
        _organizacoes[organizacao].ativa = ativa;
        emit SituacaoDaOrganizacaoAlterada(organizacao, ativa);
    }

    /// @notice Troca o administrador. O anterior continua como funcionario.
    function definirAdministrador(uint32 organizacao, address novo) external apenasDetran {
        _exigirOrganizacao(organizacao);
        _definirAdministrador(organizacao, novo);
    }

    /// @notice Vincula ou desativa um funcionario da organizacao de quem assina.
    function definirFuncionario(address carteira, bool ativo) external {
        Vinculo storage meu = _vinculos[msg.sender];
        uint32 organizacao = meu.organizacao;
        if (!meu.ativo || _organizacoes[organizacao].administrador != msg.sender) {
            revert ApenasAdministrador(msg.sender);
        }
        if (ativo) {
            _vincular(organizacao, carteira);
            return;
        }
        if (carteira == msg.sender) revert AdministradorNaoPodeSerDesativado();
        Vinculo storage v = _vinculos[carteira];
        if (v.organizacao != organizacao) revert CarteiraDeOutraOrganizacao(carteira, v.organizacao);
        v.ativo = false;
        emit FuncionarioDefinido(organizacao, carteira, false);
    }

    function _exigirOrganizacao(uint32 organizacao) private view {
        if (_organizacoes[organizacao].tipo == uint8(TipoOrganizacao.NENHUM)) revert OrganizacaoInexistente(organizacao);
    }

    function _definirAdministrador(uint32 organizacao, address novo) private {
        _vincular(organizacao, novo);
        _organizacoes[organizacao].administrador = novo;
        emit AdministradorDefinido(organizacao, novo);
    }

    // Uma carteira pertence a uma organizacao por vez.
    function _vincular(uint32 organizacao, address carteira) private {
        if (carteira == address(0)) revert CarteiraInvalida();
        Vinculo storage v = _vinculos[carteira];
        if (v.ativo && v.organizacao != organizacao) revert CarteiraDeOutraOrganizacao(carteira, v.organizacao);
        v.organizacao = organizacao;
        v.ativo = true;
        emit FuncionarioDefinido(organizacao, carteira, true);
    }

    // --------------------------------------------------------------- eventos
    function _conferirDataDoEvento(uint64 dataEvento, uint64 minima) private view {
        if (
            dataEvento > block.timestamp ||
            dataEvento + ATRASO_MAXIMO < block.timestamp ||
            dataEvento < minima
        ) revert DataDoEventoInvalida();
    }

    // Codigo IBGE de municipio: 7 digitos, com a UF (11 a 53) nos dois primeiros.
    function _conferirMunicipio(uint32 municipio) private pure {
        if (municipio < 1100000 || municipio > 5399999) revert MunicipioInvalido();
    }

    function _anexar(bytes32 chave, Evento memory evento) private returns (uint256 indice) {
        Evento[] storage h = _historico[chave];
        h.push(evento);
        return h.length - 1;
    }

    /// @notice Cadastra o veiculo com o primeiro evento. Exclusivo do DETRAN.
    function cadastrarVeiculo(
        bytes32 chave,
        uint64 km,
        uint64 dataEvento,
        uint32 municipio,
        bytes32 hashDocumento
    ) external apenasDetran chaveValida(chave) {
        Veiculo storage v = _veiculos[chave];
        if (v.cadastrado) revert VeiculoJaCadastrado();
        _conferirDataDoEvento(dataEvento, 0);
        _conferirMunicipio(municipio);

        v.cadastrado = true;
        v.ultimaKm = km;
        v.ultimaDataEvento = dataEvento;
        v.totalEventos = 1;

        _anexar(chave, Evento({
            km: km,
            dataEvento: dataEvento,
            dataBloco: uint64(block.timestamp),
            municipio: municipio,
            tipo: TIPO_CADASTRO_INICIAL,
            atipica: false,
            responsavel: msg.sender,
            organizacao: _vinculos[msg.sender].organizacao,
            referencia: SEM_REFERENCIA,
            hashDocumento: hashDocumento
        }));

        emit VeiculoCadastrado(chave);
        emit EventoRegistrado(chave, 0);
    }

    /// @notice Registra um evento com quilometragem.
    /// @param confirmarAtipica assumido por quem registra quando o avanco passa
    ///        do limite. Sem a confirmacao a transacao reverte, o que barra erro
    ///        de digitacao sem impedir uso intenso legitimo.
    function registrarEvento(
        bytes32 chave,
        uint64 km,
        uint8 tipo,
        uint64 dataEvento,
        uint32 municipio,
        bytes32 hashDocumento,
        bool confirmarAtipica
    ) external chaveValida(chave) {
        (uint32 organizacao, uint8 tipoOrganizacao) = _vinculoAtivo(msg.sender);
        if (tiposPermitidos[tipoOrganizacao] & (uint256(1) << tipo) == 0) {
            revert TipoNaoPermitido(tipoOrganizacao, tipo);
        }
        _conferirMunicipio(municipio);

        bool atipica = _avaliar(_veiculos[chave], km, dataEvento, confirmarAtipica);
        uint256 indice = _anexar(chave, Evento({
            km: km,
            dataEvento: dataEvento,
            dataBloco: uint64(block.timestamp),
            municipio: municipio,
            tipo: tipo,
            atipica: atipica,
            responsavel: msg.sender,
            organizacao: organizacao,
            referencia: SEM_REFERENCIA,
            hashDocumento: hashDocumento
        }));
        emit EventoRegistrado(chave, indice);
    }

    // Regras do evento novo e atualizacao do veiculo. Separado de
    // registrarEvento para caber na pilha da EVM sem compilar via IR.
    function _avaliar(Veiculo storage v, uint64 km, uint64 dataEvento, bool confirmarAtipica)
        private
        returns (bool atipica)
    {
        if (!v.cadastrado) revert VeiculoNaoCadastrado();
        if (km < v.ultimaKm) revert QuilometragemRegressiva(km, v.ultimaKm);
        _conferirDataDoEvento(dataEvento, v.ultimaDataEvento);

        // Limite de sanidade sobre o intervalo entre as datas dos eventos.
        uint256 dias = (dataEvento - v.ultimaDataEvento) / 1 days;
        if (dias == 0) dias = 1;
        uint256 limite = uint256(v.limiteDiario == 0 ? limiteDiarioPadrao : v.limiteDiario) * dias;
        uint256 avanco = km - v.ultimaKm;
        atipica = avanco > limite;
        if (atipica && !confirmarAtipica) revert LeituraAtipica(avanco, limite, dias);

        v.ultimaKm = km;
        v.ultimaDataEvento = dataEvento;
        v.totalEventos += 1;
    }

    /// @notice Corrige a quilometragem de um evento. Exclusivo do DETRAN.
    /// @dev O evento original nao e tocado. A correcao e um evento novo, com
    ///      data, municipio e responsavel proprios, que referencia o original.
    function corrigirLeitura(
        bytes32 chave,
        uint32 indice,
        uint64 kmCorreta,
        uint64 dataEvento,
        uint32 municipio,
        bytes32 hashDocumento
    ) external apenasDetran chaveValida(chave) {
        Veiculo storage v = _veiculos[chave];
        if (!v.cadastrado) revert VeiculoNaoCadastrado();

        Evento[] storage h = _historico[chave];
        if (indice >= h.length) revert IndiceInvalido();
        if (_correcaoDe[chave][indice] != 0) revert LeituraJaCorrigida();
        _conferirDataDoEvento(dataEvento, h[indice].dataEvento);
        _conferirMunicipio(municipio);

        uint256 indiceCorrecao = _anexar(chave, Evento({
            km: kmCorreta,
            dataEvento: dataEvento,
            dataBloco: uint64(block.timestamp),
            municipio: municipio,
            tipo: TIPO_CORRECAO,
            atipica: false,
            responsavel: msg.sender,
            organizacao: _vinculos[msg.sender].organizacao,
            referencia: indice,
            hashDocumento: hashDocumento
        }));
        _correcaoDe[chave][indice] = indiceCorrecao;
        v.totalEventos += 1;
        v.totalCorrecoes += 1;

        // A referencia passa a ser a maior quilometragem ainda valida.
        uint64 maior = 0;
        for (uint256 i = 0; i < h.length; i++) {
            if (_correcaoDe[chave][i] == 0 && h[i].km > maior) maior = h[i].km;
        }
        v.ultimaKm = maior;

        emit EventoRegistrado(chave, indiceCorrecao);
        emit LeituraCorrigida(chave, indice, indiceCorrecao);
    }

    /// @notice Ajusta o limite diario de um veiculo (taxi, frota, caminhao).
    function definirLimiteDoVeiculo(bytes32 chave, uint32 limiteDiario) external apenasDetran {
        if (!_veiculos[chave].cadastrado) revert VeiculoNaoCadastrado();
        _veiculos[chave].limiteDiario = limiteDiario;
    }

    function definirLimitePadrao(uint32 limiteDiario) external apenasDetran {
        limiteDiarioPadrao = limiteDiario;
    }

    // -------------------------------------------------------------- consulta
    // Consultas por eth_call: nao geram transacao.
    function getVeiculo(bytes32 chave) external view returns (Veiculo memory) {
        return _veiculos[chave];
    }

    function getHistorico(bytes32 chave) external view returns (Evento[] memory) {
        return _historico[chave];
    }

    function getEvento(bytes32 chave, uint256 indice) external view returns (Evento memory) {
        if (indice >= _historico[chave].length) revert IndiceInvalido();
        return _historico[chave][indice];
    }

    /// @notice Indice da correcao de um evento, ou 0 se ele nao foi corrigido.
    function correcaoDe(bytes32 chave, uint256 indice) external view returns (uint256) {
        return _correcaoDe[chave][indice];
    }

    function getOrganizacao(uint32 organizacao) external view returns (Organizacao memory) {
        return _organizacoes[organizacao];
    }

    /// @notice Situacao de uma carteira: a que organizacao pertence e o que pode.
    function vinculoDe(address carteira)
        external
        view
        returns (uint32 organizacao, uint8 tipo, bool organizacaoAtiva, bool ativo, bool administrador)
    {
        Vinculo storage v = _vinculos[carteira];
        Organizacao storage o = _organizacoes[v.organizacao];
        return (v.organizacao, o.tipo, o.ativa, v.ativo, v.ativo && o.administrador == carteira);
    }
}
