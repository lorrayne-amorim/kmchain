// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title KmChainRegistryV2 (PROPOSTA - nao implantado)
/// @notice Evolucao do KmChainRegistry. Este arquivo existe para discussao e
///         testes; o contrato em uso continua sendo o KmChainRegistry (v1).
///
/// @dev Diferencas em relacao a v1:
///   1. TIPO DA LEITURA (o procedimento que observou o hodometro) fica em
///      cadeia; o MOTIVO (transferencia, sinistro, compra...) fica so no
///      banco privado. Motivo revela fatos da vida do proprietario e nao e
///      necessario para provar ordem, autoria e integridade da leitura.
///   2. A ORIGEM (tipo de entidade) no momento do registro fica gravada: a
///      consulta publica nao depende mais da funcao ATUAL da carteira.
///   3. Matriz de permissoes: cada origem so registra os tipos de leitura
///      compativeis com sua atuacao (configuravel pelo admin).
///   4. CADASTRO_INICIAL e CORRECAO so pelas funcoes proprias - na v1 qualquer
///      credenciada podia gravar esses tipos via registrarLeitura.
///   5. Data declarada da observacao do hodometro, separada da data do bloco.
///   6. Compromisso da evidencia em vez do hash direto do documento:
///      keccak256(sha256(documento), sal), com o sal guardado no banco
///      privado. Quem tem o documento e o sal confere; quem so tem um
///      documento candidato nao confirma, pela cadeia, que ele foi usado.
///   7. Leitura empacotada em 3 slots (a v1 usa 4): menos gas por registro.
///   8. Sem veredito "conforme": o contrato devolve contagens, e a interface
///      explica o que elas significam.
///   9. O chassi NAO e enviado: as funcoes recebem a CHAVE do veiculo,
///      keccak256 do chassi normalizado, calculada fora da cadeia pela mesma
///      regra em todos os fluxos (web/src/lib/chassi.js). Na v1 o chassi vai
///      em texto no calldata de cada transacao. A chave e um PSEUDONIMO, nao
///      anonimizacao: quem conhece o chassi calcula a chave e acha o historico.
///  10. Marca, modelo e anos saem da cadeia (ficam no banco privado com o
///      restante da identificacao); nao sao necessarios para provar ordem,
///      autoria, tipo, quilometragem e integridade da evidencia.
///  11. Eventos so com a chave e o indice. Remetente e data do bloco ja estao
///      na propria transacao; ainda assim, entidade e dataBloco ficam no
///      estado (mesmo slot da leitura, custo marginal zero para a data) para
///      que o historico seja legivel por uma unica chamada, sem depender de
///      nos que guardem logs e transacoes antigas.
///
/// Migracao: nao ha copia da v1. Reescrever leituras antigas aqui mudaria
/// autoria e data. A v1 continua legivel para sempre; a interface le as duas
/// e rotula os registros da v1 como tal. `contratoAnterior` so aponta para ela.
contract KmChainRegistryV2 is AccessControl {
    // ---------------------------------------------------------------- papeis
    bytes32 public constant ORGAO_TRANSITO_ROLE = keccak256("ORGAO_TRANSITO_ROLE");
    bytes32 public constant VISTORIA_ROLE       = keccak256("VISTORIA_ROLE");   // ECV
    bytes32 public constant OFICINA_ROLE        = keccak256("OFICINA_ROLE");
    bytes32 public constant REVENDA_ROLE        = keccak256("REVENDA_ROLE");
    bytes32 public constant INSPECAO_ROLE       = keccak256("INSPECAO_ROLE");   // OIA
    bytes32 public constant SEGURADORA_ROLE     = keccak256("SEGURADORA_ROLE");
    bytes32 public constant LEILOEIRA_ROLE      = keccak256("LEILOEIRA_ROLE");  // leilao ou patio
    bytes32 public constant FROTA_ROLE          = keccak256("FROTA_ROLE");      // locadora/gestora

    enum Origem {
        NENHUMA, ORGAO_TRANSITO, VISTORIA, OFICINA, REVENDA, INSPECAO, SEGURADORA, LEILOEIRA, FROTA
    }

    enum TipoLeitura {
        CADASTRO_INICIAL,        // 0 - so cadastrarVeiculo
        VISTORIA_IDENTIFICACAO,  // 1
        VISTORIA_CAUTELAR,       // 2
        INSPECAO_SEGURANCA,      // 3
        REVISAO_MANUTENCAO,      // 4
        AVALIACAO_COMERCIAL,     // 5
        MOVIMENTACAO_ESTOQUE,    // 6
        VISTORIA_SEGURO,         // 7
        CONTROLE_FROTA,          // 8
        CORRECAO                 // 9 - so corrigirLeitura
    }

    // --------------------------------------------------------------- structs
    // Slot 1: km | dataBloco | dataObservacao | tipo | origem | atipica | contestada
    // Slot 2: entidade
    // Slot 3: compromisso
    struct Leitura {
        uint64  km;
        uint64  dataBloco;
        uint64  dataObservacao;
        uint8   tipo;
        uint8   origem;
        bool    atipica;
        bool    contestada;
        address entidade;
        bytes32 compromisso;
    }

    // Um slot: 8 + 32*3 + 64*2 = 232 bits.
    struct Veiculo {
        bool    cadastrado;
        uint32  limiteDiario;     // 0 = limite padrao
        uint32  totalLeituras;
        uint32  totalCorrecoes;
        uint64  ultimaKm;
        uint64  ultimaObservacao;
    }

    mapping(bytes32 => Veiculo)   private _veiculos;
    mapping(bytes32 => Leitura[]) private _historico;

    /// @notice Tipos permitidos por origem (bit n = TipoLeitura n).
    mapping(uint8 => uint256) public tiposPermitidos;
    mapping(uint8 => bytes32) public papelDaOrigem;

    uint32 public limiteDiarioPadrao = 1000;
    /// @notice Atraso maximo entre observar o hodometro e registrar.
    uint64 public constant ATRASO_MAXIMO = 30 days;
    address public immutable contratoAnterior;

    // --------------------------------------------------------------- eventos
    // Eventos minimos: o conteudo ja esta no historico, e cada campo extra
    // num evento e mais um dado indexavel por terceiros.
    event VeiculoCadastrado(bytes32 indexed chave);
    event LeituraRegistrada(bytes32 indexed chave, uint256 indice);
    event LeituraCorrigida(bytes32 indexed chave, uint256 indiceContestado, uint256 indiceCorrecao);
    event PermissoesAlteradas(uint8 indexed origem, uint256 tipos);

    // ----------------------------------------------------------------- erros
    error VeiculoJaCadastrado();
    error VeiculoNaoCadastrado();
    error ChaveInvalida();
    error QuilometragemRegressiva(uint256 enviada, uint256 ultima);
    error LeituraAtipica(uint256 avanco, uint256 limite, uint256 dias);
    error OrigemNaoAutorizada(address remetente, uint8 origem);
    error TipoNaoPermitido(uint8 origem, uint8 tipo);
    error DataObservacaoInvalida();
    error IndiceInvalido();
    error LeituraJaContestada();
    error KmForaDoIntervalo();

    constructor(address anterior) {
        contratoAnterior = anterior;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        papelDaOrigem[uint8(Origem.ORGAO_TRANSITO)] = ORGAO_TRANSITO_ROLE;
        papelDaOrigem[uint8(Origem.VISTORIA)]       = VISTORIA_ROLE;
        papelDaOrigem[uint8(Origem.OFICINA)]        = OFICINA_ROLE;
        papelDaOrigem[uint8(Origem.REVENDA)]        = REVENDA_ROLE;
        papelDaOrigem[uint8(Origem.INSPECAO)]       = INSPECAO_ROLE;
        papelDaOrigem[uint8(Origem.SEGURADORA)]     = SEGURADORA_ROLE;
        papelDaOrigem[uint8(Origem.LEILOEIRA)]      = LEILOEIRA_ROLE;
        papelDaOrigem[uint8(Origem.FROTA)]          = FROTA_ROLE;

        // Matriz inicial (ver docs/REVISAO_TECNICA.md). Ajustavel pelo admin.
        _permitir(Origem.ORGAO_TRANSITO, _bits3(TipoLeitura.VISTORIA_IDENTIFICACAO, TipoLeitura.INSPECAO_SEGURANCA, TipoLeitura.VISTORIA_IDENTIFICACAO));
        _permitir(Origem.VISTORIA,       _bits3(TipoLeitura.VISTORIA_IDENTIFICACAO, TipoLeitura.VISTORIA_CAUTELAR, TipoLeitura.VISTORIA_CAUTELAR));
        _permitir(Origem.OFICINA,        _bits3(TipoLeitura.REVISAO_MANUTENCAO, TipoLeitura.VISTORIA_CAUTELAR, TipoLeitura.REVISAO_MANUTENCAO));
        _permitir(Origem.REVENDA,        _bits3(TipoLeitura.AVALIACAO_COMERCIAL, TipoLeitura.MOVIMENTACAO_ESTOQUE, TipoLeitura.AVALIACAO_COMERCIAL));
        _permitir(Origem.INSPECAO,       _bits3(TipoLeitura.INSPECAO_SEGURANCA, TipoLeitura.INSPECAO_SEGURANCA, TipoLeitura.INSPECAO_SEGURANCA));
        _permitir(Origem.SEGURADORA,     _bits3(TipoLeitura.VISTORIA_SEGURO, TipoLeitura.VISTORIA_SEGURO, TipoLeitura.VISTORIA_SEGURO));
        _permitir(Origem.LEILOEIRA,      _bits3(TipoLeitura.AVALIACAO_COMERCIAL, TipoLeitura.MOVIMENTACAO_ESTOQUE, TipoLeitura.AVALIACAO_COMERCIAL));
        _permitir(Origem.FROTA,          _bits3(TipoLeitura.CONTROLE_FROTA, TipoLeitura.CONTROLE_FROTA, TipoLeitura.CONTROLE_FROTA));
    }

    // ------------------------------------------------------------- utilitario
    function _bits3(TipoLeitura a, TipoLeitura b, TipoLeitura c) private pure returns (uint256) {
        return (1 << uint8(a)) | (1 << uint8(b)) | (1 << uint8(c));
    }

    function _permitir(Origem origem, uint256 tipos) private {
        // Cadastro e correcao nunca entram pela matriz.
        tipos &= ~((1 << uint8(TipoLeitura.CADASTRO_INICIAL)) | (1 << uint8(TipoLeitura.CORRECAO)));
        tiposPermitidos[uint8(origem)] = tipos;
        emit PermissoesAlteradas(uint8(origem), tipos);
    }

    function definirTiposPermitidos(Origem origem, uint256 tipos) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _permitir(origem, tipos);
    }

    // A validacao do chassi acontece fora da cadeia (o contrato nunca o ve);
    // aqui so se recusa a chave vazia.
    modifier chaveValida(bytes32 chave) {
        if (chave == bytes32(0)) revert ChaveInvalida();
        _;
    }

    function _conferirObservacao(uint64 dataObservacao, uint64 anterior) private view {
        if (
            dataObservacao > block.timestamp ||
            dataObservacao + ATRASO_MAXIMO < block.timestamp ||
            dataObservacao < anterior
        ) revert DataObservacaoInvalida();
    }

    // -------------------------------------------------------------- escrita
    function cadastrarVeiculo(
        bytes32 id,
        uint256 kmInicial,
        uint64 dataObservacao,
        bytes32 compromisso
    ) external onlyRole(ORGAO_TRANSITO_ROLE) chaveValida(id) {
        Veiculo storage v = _veiculos[id];
        if (v.cadastrado) revert VeiculoJaCadastrado();
        if (kmInicial > type(uint64).max) revert KmForaDoIntervalo();
        _conferirObservacao(dataObservacao, 0);

        v.cadastrado = true;
        v.ultimaKm = uint64(kmInicial);
        v.ultimaObservacao = dataObservacao;
        v.totalLeituras = 1;

        _historico[id].push(Leitura({
            km: uint64(kmInicial),
            dataBloco: uint64(block.timestamp),
            dataObservacao: dataObservacao,
            tipo: uint8(TipoLeitura.CADASTRO_INICIAL),
            origem: uint8(Origem.ORGAO_TRANSITO),
            atipica: false,
            contestada: false,
            entidade: msg.sender,
            compromisso: compromisso
        }));

        emit VeiculoCadastrado(id);
        emit LeituraRegistrada(id, 0);
    }

    /// @param origem em nome de qual tipo de entidade a carteira registra
    ///        (uma carteira pode ter mais de um papel; a leitura guarda qual usou).
    function registrarLeitura(
        bytes32 id,
        uint256 km,
        TipoLeitura tipo,
        Origem origem,
        uint64 dataObservacao,
        bytes32 compromisso,
        bool confirmarAtipica
    ) external chaveValida(id) {
        uint8 o = uint8(origem);
        if (origem == Origem.NENHUMA || !hasRole(papelDaOrigem[o], msg.sender)) {
            revert OrigemNaoAutorizada(msg.sender, o);
        }
        if (tiposPermitidos[o] & (1 << uint8(tipo)) == 0) revert TipoNaoPermitido(o, uint8(tipo));

        bool atipica = _avaliar(_veiculos[id], km, dataObservacao, confirmarAtipica);
        uint256 indice = _anexar(id, Leitura({
            km: uint64(km),
            dataBloco: uint64(block.timestamp),
            dataObservacao: dataObservacao,
            tipo: uint8(tipo),
            origem: o,
            atipica: atipica,
            contestada: false,
            entidade: msg.sender,
            compromisso: compromisso
        }));
        emit LeituraRegistrada(id, indice);
    }

    // Regras da leitura nova e atualizacao do veiculo. Separado de
    // registrarLeitura para caber na pilha da EVM sem compilar via IR.
    function _avaliar(Veiculo storage v, uint256 km, uint64 dataObservacao, bool confirmarAtipica)
        private
        returns (bool atipica)
    {
        if (!v.cadastrado) revert VeiculoNaoCadastrado();
        if (km > type(uint64).max) revert KmForaDoIntervalo();
        if (km < v.ultimaKm) revert QuilometragemRegressiva(km, v.ultimaKm);
        _conferirObservacao(dataObservacao, v.ultimaObservacao);

        // Limite de sanidade sobre o intervalo entre OBSERVACOES.
        uint256 dias = (dataObservacao - v.ultimaObservacao) / 1 days;
        if (dias == 0) dias = 1;
        uint256 limite = uint256(v.limiteDiario == 0 ? limiteDiarioPadrao : v.limiteDiario) * dias;
        uint256 avanco = km - v.ultimaKm;
        atipica = avanco > limite;
        if (atipica && !confirmarAtipica) revert LeituraAtipica(avanco, limite, dias);

        v.ultimaKm = uint64(km);
        v.ultimaObservacao = dataObservacao;
        v.totalLeituras += 1;
    }

    function _anexar(bytes32 id, Leitura memory leitura) private returns (uint256 indice) {
        Leitura[] storage h = _historico[id];
        h.push(leitura);
        return h.length - 1;
    }

    function corrigirLeitura(
        bytes32 id,
        uint256 indice,
        uint256 kmCorreta,
        bytes32 compromissoJustificativa
    ) external onlyRole(ORGAO_TRANSITO_ROLE) chaveValida(id) {
        Veiculo storage v = _veiculos[id];
        if (!v.cadastrado) revert VeiculoNaoCadastrado();
        if (kmCorreta > type(uint64).max) revert KmForaDoIntervalo();

        Leitura[] storage h = _historico[id];
        if (indice >= h.length) revert IndiceInvalido();
        if (h[indice].contestada) revert LeituraJaContestada();
        h[indice].contestada = true;

        // A correcao herda a data de observacao da leitura corrigida: ela
        // diz o que o hodometro marcava NAQUELE momento.
        h.push(Leitura({
            km: uint64(kmCorreta),
            dataBloco: uint64(block.timestamp),
            dataObservacao: h[indice].dataObservacao,
            tipo: uint8(TipoLeitura.CORRECAO),
            origem: uint8(Origem.ORGAO_TRANSITO),
            atipica: false,
            contestada: false,
            entidade: msg.sender,
            compromisso: compromissoJustificativa
        }));
        v.totalLeituras += 1;
        v.totalCorrecoes += 1;

        uint64 maior = 0;
        for (uint256 i = 0; i < h.length; i++) {
            if (!h[i].contestada && h[i].km > maior) maior = h[i].km;
        }
        v.ultimaKm = maior;

        emit LeituraCorrigida(id, indice, h.length - 1);
    }

    function definirLimiteDoVeiculo(bytes32 id, uint32 limiteDiario) external onlyRole(ORGAO_TRANSITO_ROLE) {
        if (!_veiculos[id].cadastrado) revert VeiculoNaoCadastrado();
        _veiculos[id].limiteDiario = limiteDiario;
    }

    function definirLimitePadrao(uint32 limiteDiario) external onlyRole(ORGAO_TRANSITO_ROLE) {
        limiteDiarioPadrao = limiteDiario;
    }

    // -------------------------------------------------------------- consulta
    // Consultas por eth_call: nao geram transacao, nada fica publico em cadeia.
    function getVeiculo(bytes32 id) external view returns (Veiculo memory) {
        return _veiculos[id];
    }

    function getHistorico(bytes32 id) external view returns (Leitura[] memory) {
        return _historico[id];
    }

    /// @notice Contagens objetivas do historico, sem veredito.
    function resumo(bytes32 id)
        external
        view
        returns (uint256 total, uint256 comEvidencia, uint256 atipicas, uint256 correcoes, uint256 contestadas)
    {
        Leitura[] storage h = _historico[id];
        total = h.length;
        for (uint256 i = 0; i < h.length; i++) {
            if (h[i].compromisso != bytes32(0)) comEvidencia++;
            if (h[i].atipica) atipicas++;
            if (h[i].tipo == uint8(TipoLeitura.CORRECAO)) correcoes++;
            if (h[i].contestada) contestadas++;
        }
    }
}
