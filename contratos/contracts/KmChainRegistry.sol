// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title KmChainRegistry
/// @notice Registro publico e incremental de quilometragem veicular.
/// @dev Um unico contrato gerencia todos os veiculos por meio de mapeamentos
///      indexados pelo hash do chassi. Nenhum dado pessoal do proprietario
///      e gravado em cadeia.
contract KmChainRegistry is AccessControl {
    // ---------------------------------------------------------------- papeis
    bytes32 public constant DETRAN_ROLE   = keccak256("DETRAN_ROLE");
    bytes32 public constant VISTORIA_ROLE = keccak256("VISTORIA_ROLE");
    bytes32 public constant OFICINA_ROLE  = keccak256("OFICINA_ROLE");

    enum TipoEvento { CADASTRO, VISTORIA, REVISAO, TRANSFERENCIA, SINISTRO, CORRECAO }

    // --------------------------------------------------------------- structs
    struct Leitura {
        uint256    quilometragem;
        uint64     data;           // timestamp do bloco
        address    entidade;       // carteira que assinou o registro
        TipoEvento tipo;
        bytes32    hashDocumento;  // SHA-256 do documento; 0x0 se nao houver
        bool       atipica;        // avanco acima do limite, confirmado
        bool       contestada;     // corrigida posteriormente pelo DETRAN
    }

    struct Veiculo {
        bool    cadastrado;
        string  placa;             // campo auxiliar, mutavel ao longo da vida
        string  modelo;
        uint16  ano;
        uint256 ultimaKm;
        uint64  ultimaData;
        uint32  totalLeituras;
        uint32  totalCorrecoes;
        uint32  limiteDiario;      // 0 = usa o limite padrao da rede
        bytes32 ultimoHash;
    }

    mapping(bytes32 => Veiculo)   private _veiculos;
    mapping(bytes32 => Leitura[]) private _historico;

    /// @notice Avanco diario acima do qual a leitura exige confirmacao.
    /// 1.000 km/dia cobre uso intenso legitimo (caminhao com revezamento);
    /// erros de digitacao costumam estourar esse valor com folga.
    uint32 public limiteDiarioPadrao = 1000;

    // --------------------------------------------------------------- eventos
    event VeiculoCadastrado(bytes32 indexed chassiHash, string placa, uint16 ano);
    event LeituraRegistrada(
        bytes32 indexed chassiHash,
        uint256 quilometragem,
        TipoEvento tipo,
        address indexed entidade,
        uint64 data,
        bytes32 hashDocumento,
        bool atipica
    );
    event LeituraCorrigida(
        bytes32 indexed chassiHash,
        uint256 indexed indice,
        uint256 kmContestada,
        uint256 kmCorreta,
        address indexed autoridade
    );
    event LimiteAlterado(bytes32 indexed chassiHash, uint32 limiteDiario);

    // ----------------------------------------------------------------- erros
    error VeiculoJaCadastrado();
    error VeiculoNaoCadastrado();
    error QuilometragemRegressiva(uint256 enviada, uint256 ultima);
    error LeituraAtipica(uint256 avanco, uint256 limite, uint256 dias);
    error EntidadeNaoAutorizada(address remetente);
    error ChassiInvalido();
    error IndiceInvalido();
    error LeituraJaContestada();

    // ------------------------------------------------------------ modificador
    modifier apenasCredenciada() {
        if (
            !hasRole(DETRAN_ROLE, msg.sender) &&
            !hasRole(VISTORIA_ROLE, msg.sender) &&
            !hasRole(OFICINA_ROLE, msg.sender)
        ) revert EntidadeNaoAutorizada(msg.sender);
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(DETRAN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------- utilitario
    /// @notice Normaliza o chassi (maiusculas) e devolve a chave de indexacao.
    function chaveDoChassi(string memory chassi) public pure returns (bytes32) {
        bytes memory b = bytes(chassi);
        if (b.length != 17) revert ChassiInvalido();
        for (uint256 i = 0; i < b.length; i++) {
            if (b[i] >= 0x61 && b[i] <= 0x7A) {
                b[i] = bytes1(uint8(b[i]) - 32);
            }
        }
        return keccak256(b);
    }

    // -------------------------------------------------------------- escrita
    function cadastrarVeiculo(
        string calldata chassi,
        string calldata placa,
        string calldata modelo,
        uint16 ano,
        uint256 kmInicial,
        bytes32 hashDocumento
    ) external onlyRole(DETRAN_ROLE) {
        bytes32 id = chaveDoChassi(chassi);
        if (_veiculos[id].cadastrado) revert VeiculoJaCadastrado();

        _veiculos[id] = Veiculo({
            cadastrado: true,
            placa: placa,
            modelo: modelo,
            ano: ano,
            ultimaKm: kmInicial,
            ultimaData: uint64(block.timestamp),
            totalLeituras: 1,
            totalCorrecoes: 0,
            limiteDiario: 0,
            ultimoHash: hashDocumento
        });

        _historico[id].push(Leitura({
            quilometragem: kmInicial,
            data: uint64(block.timestamp),
            entidade: msg.sender,
            tipo: TipoEvento.CADASTRO,
            hashDocumento: hashDocumento,
            atipica: false,
            contestada: false
        }));

        emit VeiculoCadastrado(id, placa, ano);
        emit LeituraRegistrada(id, kmInicial, TipoEvento.CADASTRO, msg.sender, uint64(block.timestamp), hashDocumento, false);
    }

    /// @notice Registra uma nova leitura.
    /// @param confirmarAtipica assumido pela entidade quando o avanco diario
    ///        ultrapassa o limite. Sem essa confirmacao a transacao reverte,
    ///        o que barra erro de digitacao sem impedir uso intenso legitimo.
    function registrarLeitura(
        string calldata chassi,
        uint256 quilometragem,
        TipoEvento tipo,
        bytes32 hashDocumento,
        bool confirmarAtipica
    ) external apenasCredenciada {
        bytes32 id = chaveDoChassi(chassi);
        Veiculo storage v = _veiculos[id];
        if (!v.cadastrado) revert VeiculoNaoCadastrado();

        // REGRA 1 - validacao incremental: nunca aceita retrocesso
        if (quilometragem < v.ultimaKm) {
            revert QuilometragemRegressiva(quilometragem, v.ultimaKm);
        }

        // REGRA 2 - limite de sanidade: avanco muito acima do plausivel
        // nao e bloqueado, mas exige confirmacao explicita e fica marcado.
        uint256 dias = (block.timestamp - v.ultimaData) / 1 days;
        if (dias == 0) dias = 1;
        uint256 limite = uint256(v.limiteDiario == 0 ? limiteDiarioPadrao : v.limiteDiario) * dias;
        uint256 avanco = quilometragem - v.ultimaKm;

        bool atipica = avanco > limite;
        if (atipica && !confirmarAtipica) revert LeituraAtipica(avanco, limite, dias);

        v.ultimaKm      = quilometragem;
        v.ultimaData    = uint64(block.timestamp);
        v.totalLeituras += 1;
        if (hashDocumento != bytes32(0)) v.ultimoHash = hashDocumento;

        _historico[id].push(Leitura({
            quilometragem: quilometragem,
            data: uint64(block.timestamp),
            entidade: msg.sender,
            tipo: tipo,
            hashDocumento: hashDocumento,
            atipica: atipica,
            contestada: false
        }));

        emit LeituraRegistrada(id, quilometragem, tipo, msg.sender, uint64(block.timestamp), hashDocumento, atipica);
    }

    /// @notice Corrige uma leitura equivocada. Exclusivo do DETRAN.
    /// @dev Nada e apagado: a leitura errada permanece no historico marcada
    ///      como contestada e uma nova leitura do tipo CORRECAO e anexada,
    ///      com o documento que justifica a correcao. E um estorno contabil,
    ///      nao uma edicao - a auditoria continua completa.
    function corrigirLeitura(
        string calldata chassi,
        uint256 indice,
        uint256 kmCorreta,
        bytes32 hashJustificativa
    ) external onlyRole(DETRAN_ROLE) {
        bytes32 id = chaveDoChassi(chassi);
        Veiculo storage v = _veiculos[id];
        if (!v.cadastrado) revert VeiculoNaoCadastrado();

        Leitura[] storage h = _historico[id];
        if (indice >= h.length) revert IndiceInvalido();
        if (h[indice].contestada) revert LeituraJaContestada();

        uint256 kmContestada = h[indice].quilometragem;
        h[indice].contestada = true;

        h.push(Leitura({
            quilometragem: kmCorreta,
            data: uint64(block.timestamp),
            entidade: msg.sender,
            tipo: TipoEvento.CORRECAO,
            hashDocumento: hashJustificativa,
            atipica: false,
            contestada: false
        }));

        v.totalLeituras  += 1;
        v.totalCorrecoes += 1;
        v.ultimaData      = uint64(block.timestamp);
        if (hashJustificativa != bytes32(0)) v.ultimoHash = hashJustificativa;

        // a referencia passa a ser a maior leitura ainda valida
        uint256 maior = 0;
        for (uint256 i = 0; i < h.length; i++) {
            if (!h[i].contestada && h[i].quilometragem > maior) maior = h[i].quilometragem;
        }
        v.ultimaKm = maior;

        emit LeituraCorrigida(id, indice, kmContestada, kmCorreta, msg.sender);
    }

    /// @notice Ajusta o limite diario de um veiculo (taxi, frota, caminhao).
    function definirLimiteDoVeiculo(string calldata chassi, uint32 limiteDiario)
        external
        onlyRole(DETRAN_ROLE)
    {
        bytes32 id = chaveDoChassi(chassi);
        if (!_veiculos[id].cadastrado) revert VeiculoNaoCadastrado();
        _veiculos[id].limiteDiario = limiteDiario;
        emit LimiteAlterado(id, limiteDiario);
    }

    function definirLimitePadrao(uint32 limiteDiario) external onlyRole(DETRAN_ROLE) {
        limiteDiarioPadrao = limiteDiario;
    }

    // -------------------------------------------------------------- consulta
    function getVeiculo(string calldata chassi) external view returns (Veiculo memory) {
        return _veiculos[chaveDoChassi(chassi)];
    }

    function getHistorico(string calldata chassi) external view returns (Leitura[] memory) {
        return _historico[chaveDoChassi(chassi)];
    }

    /// @notice Token de conformidade: resposta direta ao comprador.
    function conformidade(string calldata chassi)
        external
        view
        returns (
            bool conforme,
            uint256 ultimaKm,
            uint64 ultimaData,
            uint32 totalLeituras,
            uint32 totalCorrecoes,
            bool possuiAtipicas,
            bytes32 ultimoHash
        )
    {
        bytes32 id = chaveDoChassi(chassi);
        Veiculo memory v = _veiculos[id];
        if (!v.cadastrado) return (false, 0, 0, 0, 0, false, bytes32(0));

        Leitura[] memory h = _historico[id];
        bool documentado = true;
        bool atipicas = false;
        for (uint256 i = 1; i < h.length; i++) {
            if (h[i].hashDocumento == bytes32(0)) documentado = false;
            if (h[i].atipica) atipicas = true;
        }

        conforme = documentado && h.length > 1;
        return (conforme, v.ultimaKm, v.ultimaData, v.totalLeituras, v.totalCorrecoes, atipicas, v.ultimoHash);
    }
}