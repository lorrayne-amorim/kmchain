// Mesma estrutura do RegistroLeitura, trocando a chamada do contrato por:
const tx = await contrato.cadastrarVeiculo(
    chassi.trim().toUpperCase(),
    placa.trim().toUpperCase(),
    modelo,
    Number(ano),
    BigInt(kmInicial),
    digest
);
// Só carteiras com DETRAN_ROLE conseguem executar esta função:
// qualquer outra recebe o erro AccessControlUnauthorizedAccount.