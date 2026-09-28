# KmChain

Protótipo acadêmico de registro público da quilometragem de veículos em blockchain (Ethereum/Sepolia). Qualquer pessoa consulta de graça, sem carteira e sem cadastro; só carteiras credenciadas pelo administrador do contrato, nas funções de DETRAN, centro de vistoria ou oficina, gravam novas leituras. As funções são **simuladas**: não há integração com Detran, RENAVE, Inmetro ou oficinas reais.

**Site publicado:** https://kmchain-web.vercel.app

## Por que

Odômetro se adultera. Uma vez gravada em cadeia, uma leitura não pode ser apagada nem sobrescrita — só contestada por uma correção do DETRAN, que fica igualmente visível ao lado da leitura original. Isso torna os registros feitos por entidades identificadas rastreáveis e verificáveis por qualquer comprador.

O que o sistema **não** prova: que a km informada era verdadeira, nem que o hodômetro não foi adulterado antes do primeiro registro ou entre registros. Veja [docs/REVISAO_TECNICA.md](docs/REVISAO_TECNICA.md).

## Como usar

### Qualquer pessoa (consulta pública)

Não precisa de carteira, MetaMask ou cadastro.

1. Acesse o [site](https://kmchain-web.vercel.app).
2. Digite o chassi (17 caracteres) que consta no documento do veículo, **ou** clique em "Escanear QR Code" e aponte a câmera para a etiqueta.
3. Veja o histórico completo: cada leitura, a data em que foi registrada em cadeia, o tipo de evento (cadastro, vistoria, revisão, transferência, sinistro, correção) e a carteira que assinou. Uma nota indica se todos os registros após o cadastro têm comprovante anexado.

**Experimente agora** com um veículo já cadastrado na rede de testes:

<p align="center">
  <img src="docs/qr-exemplo.png" alt="QR Code de exemplo" width="200" />
</p>

- Chassi: `7GTNRJMVMHW482160`
- Ou abra direto: https://kmchain-web.vercel.app/?chassi=7GTNRJMVMHW482160

### DETRAN, vistorias e oficinas (painel profissional)

Clique em "Acesso para DETRAN, vistoria e oficinas credenciadas" no rodapé da home. O acesso tem duas camadas, nessa ordem:

1. **Login e senha** (conta própria, guardada com hash em banco SQL). Quem ainda não tem conta pode criar uma na hora, só com nome, e-mail e senha — a função da entidade (oficina, vistoria ou DETRAN) é atribuída depois pelo administrador do contrato, ao credenciar a carteira vinculada à conta.
2. **Carteira MetaMask credenciada na rede Sepolia e vinculada à conta.** Criar a conta de login não dá nenhum acesso por si só — é o administrador quem credencia a carteira em cadeia. Depois de logar, a pessoa vincula a carteira à conta (assinando uma mensagem). Registrar leituras, enviar comprovantes e ver dados privados exigem essa carteira vinculada: o servidor confere login, vínculo e função em cada pedido.

O que aparece no painel depende do papel da carteira conectada, conferido em tempo real no próprio contrato:

| Papel | Pode fazer |
|---|---|
| Oficina / Vistoria | Registrar leitura (com documento comprobatório opcional) |
| DETRAN | Tudo acima, além de cadastrar veículo, corrigir leitura equivocada, definir limites de avanço diário e consultar os registros privados |
| Admin (dono do contrato) | Credenciar ou revogar o acesso de outras carteiras, e ver as contas de login aguardando credenciamento |

Cadastro de veículo e transferência de propriedade também pedem o nome e o CPF do proprietário atual (e o cadastro, a placa). Esses dados **não vão para a blockchain** — ficam só no banco SQL, junto do nome de quem de fato realizou o serviço (não só a carteira que assinou), e só o DETRAN consegue consultá-los.

Toda leitura com avanço de quilometragem muito acima do plausível para o período exige uma segunda confirmação explícita antes de ser gravada — e fica marcada como atípica no histórico público, em vez de ser bloqueada (o que impediria uso legítimo intenso, como frotas).

## Como funciona por baixo

- **Contrato** (`contratos/`): um único `KmChainRegistry.sol`, escrito em Solidity, guarda os veículos e o histórico de leituras indexados pelo hash do chassi. Papéis (DETRAN, vistoria, oficina) são geridos via `AccessControl` da OpenZeppelin.
- **Documentos**: o arquivo comprobatório (nota fiscal, laudo de vistoria) nunca vai para a blockchain. Só o SHA-256 dele é gravado em cadeia; o arquivo em si fica no IPFS via Pinata, **cifrado com AES-256-GCM** pelo servidor antes do envio (nem o nome original do arquivo nem qualquer metadado vai para lá). A chave (`DOCS_KEY`) existe só no servidor. O comprovante é aberto por um link de uso único, válido por 60 segundos: o DETRAN abre qualquer comprovante; oficinas e vistorias, só os que enviaram. O servidor confere login, carteira vinculada e função, registra o acesso e verifica se o arquivo decifrado tem exatamente o hash registrado em cadeia.
- **Login e dados privados** (`web/api/auth/`, `web/api/privado/`): banco SQL (Postgres) guarda a conta de login de cada entidade (senha com hash bcrypt, sessão em cookie HttpOnly assinado por HMAC) e os dados que a blockchain nunca deveria expor — placa, CPF e nome do proprietário atual, e o nome de quem, de fato, realizou cada serviço (não só a carteira). A leitura desses dados exige, além do login, a mesma prova por assinatura usada nos documentos: só quem tem `DETRAN_ROLE` em cadeia consulta.
- **Frontend** (`web/`): React + Vite, conversando com o contrato via `ethers.js`. Funciona de graça para consulta (RPC público) e exige login + MetaMask só para quem for gravar algo.

## Rodando localmente

```bash
# Contrato (v1 em uso + proposta v2): compila e roda os testes
cd contratos
npm install
npx hardhat test

# Sistema completo (tela + login + /api) em http://localhost:5173
cd web
npm install
npm run dev

# Testes de integracao das rotas /api (Hardhat local, Postgres em memoria,
# Pinata simulado - nao toca na Sepolia nem no banco real)
npm test
```

O frontend precisa de um `.env` (endereço da rede, RPC público) e um `.env.local` (chave da Pinata, RPC do backend, `DATABASE_URL` do Postgres, `SESSION_SECRET` do login e `DOCS_KEY`, a chave AES-256 dos documentos). O `npm run dev` carrega o `.env.local` e serve todas as rotas `/api` — usando o banco e a rede reais configurados ali. As tabelas do banco são criadas sozinhas na primeira chamada. Detalhes em [docs/DOCUMENTACAO.txt](docs/DOCUMENTACAO.txt).

## Stack

Solidity · Hardhat · OpenZeppelin AccessControl · React · Vite · ethers.js · IPFS/Pinata · Postgres · bcrypt · Vercel
