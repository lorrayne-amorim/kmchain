# KmChain

Registro público e à prova de adulteração da quilometragem de veículos, gravado em blockchain (Ethereum/Sepolia). Qualquer pessoa consulta de graça, sem carteira e sem cadastro; só o DETRAN e as entidades por ele credenciadas (oficinas e centros de vistoria) podem gravar novas leituras.

**Site publicado:** https://kmchain-web.vercel.app

## Por que

Odômetro se adultera. Uma vez gravada em cadeia, uma leitura não pode ser apagada nem sobrescrita — só contestada por uma correção do DETRAN, que fica igualmente visível ao lado da leitura original. Isso dá a qualquer comprador a possibilidade de conferir o histórico completo de um veículo antes de fechar negócio.

## Como usar

### Qualquer pessoa (consulta pública)

Não precisa de carteira, MetaMask ou cadastro.

1. Acesse o [site](https://kmchain-web.vercel.app).
2. Digite o chassi (17 caracteres) que consta no documento do veículo, **ou** clique em "Ler QR Code" e aponte a câmera para a etiqueta.
3. Veja o histórico completo: cada leitura, sua data, o tipo de evento (cadastro, vistoria, revisão, transferência, sinistro, correção) e a entidade que assinou. Um selo indica se o histórico está totalmente documentado.

**Experimente agora** com um veículo já cadastrado na rede de testes:

<p align="center">
  <img src="docs/qr-exemplo.png" alt="QR Code de exemplo" width="200" />
</p>

- Chassi: `7GTNRJMVMHW482160`
- Ou abra direto: https://kmchain-web.vercel.app/?chassi=7GTNRJMVMHW482160

### DETRAN, vistorias e oficinas (painel profissional)

Clique em "Acesso para DETRAN, vistoria e oficinas credenciadas" no rodapé da home e conecte a carteira MetaMask cadastrada na rede Sepolia. O que aparece depende do papel daquela carteira, conferido em tempo real no próprio contrato:

| Papel | Pode fazer |
|---|---|
| Oficina / Vistoria | Registrar leitura (com documento comprobatório opcional) |
| DETRAN | Tudo acima, além de cadastrar veículo, corrigir leitura equivocada e definir limites de avanço diário |
| Admin (dono do contrato) | Credenciar ou revogar o acesso de outras carteiras |

Toda leitura com avanço de quilometragem muito acima do plausível para o período exige uma segunda confirmação explícita antes de ser gravada — e fica marcada como atípica no histórico público, em vez de ser bloqueada (o que impediria uso legítimo intenso, como frotas).

## Como funciona por baixo

- **Contrato** (`contratos/`): um único `KmChainRegistry.sol`, escrito em Solidity, guarda os veículos e o histórico de leituras indexados pelo hash do chassi. Papéis (DETRAN, vistoria, oficina) são geridos via `AccessControl` da OpenZeppelin.
- **Documentos**: o arquivo comprobatório (nota fiscal, laudo de vistoria) nunca vai para a blockchain. Só o SHA-256 dele é gravado em cadeia; o arquivo em si fica no IPFS via Pinata, e só é liberado a uma carteira que prove (assinando uma mensagem) ter um papel credenciado.
- **Frontend** (`web/`): React + Vite, conversando com o contrato via `ethers.js`. Funciona de graça para consulta (RPC público) e exige MetaMask só para quem for gravar algo.

## Rodando localmente

```bash
# Contrato: compila e roda os testes
cd contratos
npm install
npx hardhat test

# Frontend: sobe em http://localhost:5173
cd web
npm install
npm run dev
```

O frontend precisa de um `.env` (endereço da rede, RPC público) e um `.env.local` (chave da Pinata, RPC do backend) — veja `web/.env` e `web/.env.local` para as variáveis esperadas.

## Stack

Solidity · Hardhat · OpenZeppelin AccessControl · React · Vite · ethers.js · IPFS/Pinata · Vercel
