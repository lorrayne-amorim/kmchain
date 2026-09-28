// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice SO PARA TESTES. Imita uma conta inteligente (EIP-7702 / ERC-4337):
///         quem envia a transacao e o dono, o destino da transacao e esta
///         conta, e o contrato do KmChain ve ESTA conta como msg.sender.
contract CarteiraInteligenteDeTeste {
    address public immutable dono;

    constructor(address _dono) {
        dono = _dono;
    }

    function executar(address alvo, bytes calldata dados) external {
        _chamar(alvo, dados);
    }

    function executarLote(address alvo, bytes[] calldata lote) external {
        for (uint256 i = 0; i < lote.length; i++) _chamar(alvo, lote[i]);
    }

    function _chamar(address alvo, bytes calldata dados) private {
        require(msg.sender == dono, "so o dono");
        (bool ok, bytes memory retorno) = alvo.call(dados);
        if (!ok) {
            assembly {
                revert(add(retorno, 32), mload(retorno))
            }
        }
    }
}
