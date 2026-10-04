# KMChain

Protótipo acadêmico (TCC) de **histórico de quilometragem de veículos em blockchain**. Cada evento com quilometragem (revisão, vistoria, inspeção de seguro...) é gravado na rede Ethereum por uma organização credenciada, com data e hora, município e responsável, e fica disponível para consulta pública pelo chassi, de graça e sem cadastro.

**Site publicado:** https://kmchain-web.vercel.app

> **Protótipo, não sistema oficial.** DETRAN, oficinas, empresas de vistoria e seguradoras são atores **simulados**. Não há vínculo, parceria ou homologação com órgão público, e o credenciamento no KMChain não equivale a credenciamento oficial. Não use dados pessoais reais.

> **Estado atual.** O contrato `KmChainRegistryV2` está na Sepolia em [`0x5D88Ba98B0ed0188E0193E4598841cFE68255152`](https://sepolia.etherscan.io/address/0x5D88Ba98B0ed0188E0193E4598841cFE68255152#code), com o código verificado. A aplicação usa só esse contrato; a primeira versão (v1) fica no repositório como histórico.

A descrição completa do que o sistema faz, tela por tela e rota por rota, está em [docs/INVENTARIO_FUNCIONAL.md](docs/INVENTARIO_FUNCIONAL.md).

---

## O que o protótipo demonstra e o que não demonstra

**Demonstra:**
- registros que não são alterados nem apagados depois de gravados;
- sequência verificável de eventos por veículo, com data e hora do evento, município e organização responsável;
- credenciamento em cadeia: só registra quem tem vínculo ativo com uma organização ativa, e só os tipos de evento do tipo da organização;
- suspensão e desativação que bloqueiam novos registros sem apagar os anteriores;
- correção auditável: o registro original fica intacto e a correção entra como novo evento que o referencia;
- integridade da evidência pelo hash do comprovante;
- separação entre o que é público e permanente (blockchain) e o que é cadastral ou pessoal (banco).

**Não demonstra:**
- que a quilometragem, a data ou o local informados eram verdadeiros;
- que o hodômetro não foi adulterado antes do primeiro registro ou entre registros;
- o trajeto do veículo (o local é o do evento registrado);
- a identidade da pessoa que controla a carteira;
- conformidade com a LGPD.

---

## Atores

| Ator | Papel |
|---|---|
| DETRAN | credencia e suspende organizações, define um ou mais administradores por organização, cadastra veículos, registra eventos institucionais, decide correções |
| Oficina | registra revisão, manutenção, orçamento, inspeção mecânica, reparo e troca de componentes |
| Empresa de vistoria | registra vistorias (transferência, sinistro, GNV, alteração de característica, cautelar, a pedido de seguradora) |
| Seguradora | registra vistoria prévia, de renovação e inspeção de sinistro |
| Público | consulta o histórico e o mapa das organizações, sem conta |

Cada organização tem um ou mais administradores, definidos pelo DETRAN, que vinculam os funcionários. Administradores e funcionários podem ser indicados pelo e-mail da conta ou direto pela carteira: quem ainda não tem conta assume o vínculo ao criar a conta e vincular essa carteira.

---

## Como testar

### Consulta pública (sem conta)

Acesse https://kmchain-web.vercel.app e consulte um dos veículos fictícios do cenário de demonstração:

| Chassi | O que mostra |
|---|---|
| `9KMDEM00000000001` | histórico normal, com eventos de DETRAN, oficina, empresa de vistoria e seguradora |
| `9KMDEM00000000002` | erro de digitação corrigido: o registro original continua, ao lado da correção |
| `9KMDEM00000000003` | registros feitos fora do local cadastrado da organização |
| `9KMDEM00000000004` | vistoria a pedido de seguradora |

Link direto: https://kmchain-web.vercel.app/?chassi=9KMDEM00000000001. O mapa das organizações fica em https://kmchain-web.vercel.app/#/organizacoes.

### Painel institucional (ambiente local)

As contas do site publicado não são divulgadas: quem tivesse as chaves poderia gravar no contrato em nome das organizações. Para experimentar o painel, use o ambiente local, que sobe uma blockchain e um banco descartáveis na sua máquina:

```bash
cd contratos && npm install
cd ../web && npm install
npm run demo:local        # aplicação em http://localhost:5173
npm run demo:preparar     # em outro terminal: cria o cenário de demonstração
```

Na MetaMask, adicione a rede local (RPC `http://127.0.0.1:8545`, chain ID `31337`) e importe a conta de teste que for usar. As chaves são as contas públicas do Hardhat, listadas em `web/demo/carteiras.mjs` na ordem abaixo. Servem só nessa rede local.

| Conta | E-mail | Chave em `carteiras.mjs` |
|---|---|---|
| Administrador do DETRAN | `detran.admin@exemplo.com` | 1ª |
| Agente do DETRAN | `detran.agente@exemplo.com` | 2ª |
| Gerente da oficina | `oficina.admin@exemplo.com` | 3ª |
| Mecânico da oficina | `oficina.mecanico@exemplo.com` | 4ª |
| Gerente da vistoria | `vistoria.admin@exemplo.com` | 5ª |
| Vistoriador | `vistoria.vistoriador@exemplo.com` | 6ª |
| Gerente da seguradora | `seguradora.admin@exemplo.com` | 7ª |
| Analista da seguradora | `seguradora.analista@exemplo.com` | 8ª |

Senha de todas as contas no ambiente local: `demo-kmchain-local`.

Ao entrar, conecte na MetaMask a carteira da conta. Cada ação de escrita (credenciar, registrar evento, aprovar correção) pede uma assinatura. Mais detalhes em [docs/AMBIENTE.md](docs/AMBIENTE.md).

---

## O que fica na blockchain e o que fica no banco

| Na blockchain | No banco |
|---|---|
| chave do veículo (`keccak256` do chassi) | chassi, marca, modelo, anos |
| quilometragem e tipo do evento | placa e UF, com histórico datado |
| data e hora do evento e da transação | proprietário (nome e CPF), restrito ao DETRAN |
| município do evento (código IBGE) | cadastro e endereço das organizações |
| identificador da organização | nome de quem registrou cada evento |
| carteira do responsável | solicitações de correção e decisões |
| referência ao evento corrigido | auditoria administrativa |
| hash do comprovante | índice dos comprovantes (arquivo cifrado no IPFS) |

---

## Estrutura do repositório

```
contratos/
  contracts/KmChainRegistryV2.sol    contrato atual
  contracts/KmChainRegistry.sol      primeira versão (v1), preservada como histórico
  test/  scripts/
web/
  api/index.js                       única Serverless Function
  servidor/                          rotas, controladores, serviços, repositórios e núcleo
  src/componentes/  src/ui/  src/lib/  src/dados/
  test/                              testes de integração das rotas
docs/
  INVENTARIO_FUNCIONAL.md            o que o sistema faz hoje
```

---

## Rodando localmente

Requisitos: **Node.js 20.19+ ou 22.12+** e a extensão **MetaMask** (só para gravar).

```bash
cd contratos && npm install && npx hardhat test
cd web && npm install && npm run dev
```

O `web/` precisa de dois arquivos que não vão para o git:
- **`.env`:** `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_EXPLORER`.
- **`.env.local`:** `PINATA_JWT`, `GATEWAY`, `RPC_URL`, `DATABASE_URL`, `SESSION_SECRET` e `DOCS_KEY` (chave AES-256 de 32 bytes em base64). Opcionais: `DOCS_KEYS_ANTIGAS`, `KMCHAIN_ENDERECO`.

O `npm run dev` usa **o banco e a rede reais** configurados ali, e cria ou migra as tabelas na primeira chamada.

**Deploy do contrato:** `cd contratos && npx hardhat run scripts/deploy.js --network sepolia`. O script grava o endereço e a ABI em `web/src/lib`. A conta que implanta vira a administradora do DETRAN.

---

## Testes

```bash
cd contratos && npx hardhat test    # 50 testes: contrato atual e a v1 (histórica)
cd web && npm test                  # 100 testes: rotas /api de ponta a ponta
cd web && npx oxlint && npm run build
```

Os testes das rotas sobem uma blockchain Hardhat local com o contrato, um Postgres em memória (PGlite) e um Pinata simulado. Não tocam na Sepolia nem no banco real e usam só dados fictícios.

---

## Documentação

- [docs/INVENTARIO_FUNCIONAL.md](docs/INVENTARIO_FUNCIONAL.md): atores, telas, eventos, contrato, modelo de dados, rotas, permissões, segurança e pendências.
- [docs/AMBIENTE.md](docs/AMBIENTE.md): como subir o ambiente local, implantar na Sepolia, limpar o banco e criar o cenário de demonstração.
- [docs/DOCUMENTACAO.txt](docs/DOCUMENTACAO.txt) e [docs/REVISAO_TECNICA.md](docs/REVISAO_TECNICA.md): descrevem a versão anterior (contrato v1) e ficam como registro histórico.
