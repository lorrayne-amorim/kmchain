# Como recriar o ambiente do KMChain

Dois ambientes: o **local**, descartável, para ensaiar; e a **Sepolia**, para a demonstração publicada. Em ambos a aplicação usa só o contrato `KmChainRegistryV2`.

Requisitos: Node.js 20.19+ ou 22.12+ e a extensão MetaMask.

```bash
cd contratos && npm install
cd ../web && npm install
```

## Testes

```bash
cd contratos && npx hardhat test       # contrato atual e a v1 (histórica)
cd web && npm test                     # rotas /api, com blockchain e banco locais
cd web && npx oxlint && npm run build
```

## Ambiente local

Não usa a Sepolia nem o banco real. Blockchain e banco nascem vazios a cada execução e são descartados ao encerrar, então não há o que resetar.

```bash
cd web
npm run demo:local        # nó Hardhat + contrato + banco em memória + aplicação em http://localhost:5173
npm run demo:preparar     # em outro terminal: cria o cenário de demonstração
```

O `demo:preparar` cria as contas, credencia as organizações, vincula os funcionários, cadastra os veículos e registra os eventos, sempre pelas rotas da aplicação e com transações assinadas pelas carteiras de teste. A senha das contas no ambiente local é `demo-kmchain-local`.

Para usar as telas com a MetaMask:

1. Adicione a rede: RPC `http://127.0.0.1:8545`, chain ID `31337`, moeda ETH.
2. Importe as contas de teste do Hardhat que for usar. As chaves são públicas e estão em `web/demo/carteiras.mjs`, na ordem: administrador do DETRAN, agente do DETRAN, gerente e mecânico da oficina, gerente e vistoriador da vistoria, gerente e analista da seguradora.
3. Ao reiniciar o ambiente, limpe os dados de atividade da conta na MetaMask (Configurações → Avançado), porque a blockchain local recomeça do zero.

## Ambiente Sepolia

Ordem obrigatória: contrato novo, banco limpo, cenário. Contrato e banco precisam começar vazios juntos.

### 1. Configuração

- `contratos/.env`: `SEPOLIA_RPC_URL`, `PRIVATE_KEY` (carteira com ETH de teste; ela vira a administradora do DETRAN), `ETHERSCAN_API_KEY`.
- `web/.env`: `VITE_RPC_URL`, `VITE_CHAIN_ID=11155111`, `VITE_EXPLORER`.
- `web/.env.local`: `DATABASE_URL`, `RPC_URL`, `SESSION_SECRET`, `DOCS_KEY`, `PINATA_JWT`, `GATEWAY`.

Nenhum desses arquivos vai para o git.

### 2. Deploy do contrato

```bash
cd contratos
npx hardhat run scripts/checar.js --network sepolia    # rede, conta e saldo
npx hardhat run scripts/deploy.js --network sepolia
```

O deploy grava o endereço em `web/src/lib/endereco.json` e a ABI ao lado. Custa cerca de 2,25 milhões de gas.

### 3. Limpeza do banco

**Apaga todos os dados do banco da `DATABASE_URL`, sem volta.** As tabelas ficam.

```bash
cd web
npm run demo:resetar -- --apenas-listar                           # só mostra o que seria apagado
KMCHAIN_PERMITIR_RESET=sim npm run demo:resetar -- --banco=<nome do banco>
```

O script recusa sem a variável, sem o nome exato do banco, em ambiente de produção (`VERCEL` ou `NODE_ENV=production`), e ainda pede que se digite `APAGAR` depois de listar as tabelas.

### 4. Aplicação

Publique a versão atual (com o `endereco.json` novo) ou rode `npm run dev`, que usa o banco e a rede reais.

### 5. Cenário de demonstração

```bash
cd web
npm run demo:carteiras                                   # cria web/demo/carteiras.local (não versionado)
DEMO_SENHA=<senha das contas> npm run demo:preparar -- --rede=sepolia --financiar
```

- `demo:carteiras` gera sete carteiras e reaproveita a do deploy como administradora do DETRAN.
- `--financiar` faz a carteira do DETRAN transferir 0,01 ETH de teste a cada carteira sem saldo para as taxas.
- `DEMO_URL` aponta para a aplicação (padrão `http://localhost:5173`).
- O script só roda em ambiente limpo: recusa se já houver organização no banco ou no contrato.

Para a apresentação, importe na MetaMask as chaves de `web/demo/carteiras.local`.

Tudo o que o script faz também pode ser feito pela tela, com a MetaMask, na mesma ordem. O que ele cria está descrito em `docs/INVENTARIO_FUNCIONAL.md`, seção Z.
