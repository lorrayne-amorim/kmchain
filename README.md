# KMChain

Protótipo acadêmico (TCC) de **histórico de quilometragem de veículos em blockchain**, como proposta para mitigar fraudes no odômetro. Cada leitura do hodômetro é gravada na rede Ethereum (rede de testes **Sepolia**) por uma entidade credenciada e fica disponível para consulta pública pelo chassi do veículo, de graça e sem cadastro.

**Site publicado:** https://kmchain-web.vercel.app

> **Protótipo, não sistema oficial.** As funções de DETRAN, centro de vistoria e oficina são **simuladas**. Não há integração com Detran, RENAVE, Inmetro ou oficinas reais, e o credenciamento no KMChain não equivale a credenciamento oficial. Não use dados pessoais reais.

---

## Sumário

- [O que o protótipo demonstra e o que não demonstra](#o-que-o-protótipo-demonstra-e-o-que-não-demonstra)
- [Funcionalidades](#funcionalidades)
- [Como usar](#como-usar)
- [Arquitetura](#arquitetura)
- [O que fica na blockchain e o que fica no banco](#o-que-fica-na-blockchain-e-o-que-fica-no-banco)
- [Segurança e controle de acesso](#segurança-e-controle-de-acesso)
- [Contrato inteligente](#contrato-inteligente)
- [Tecnologias](#tecnologias)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Rodando localmente](#rodando-localmente)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Documentação complementar](#documentação-complementar)

---

## O que o protótipo demonstra e o que não demonstra

**Demonstra:**
- **Registros que não podem ser alterados nem apagados** depois de gravados na blockchain.
- **Sequência verificável:** o histórico de cada veículo tem ordem e é consultável por qualquer pessoa.
- **Autoria:** cada registro fica atribuído à carteira que o assinou, e essa carteira precisava ter credencial no momento.
- **Revogação:** revogar uma credencial impede novos registros sem apagar os anteriores.
- **Regras de consistência:**
  - quilometragem menor que a última é recusada;
  - um avanço muito acima do plausível exige confirmação explícita e fica marcado como atípico.
- **Correção auditável:** a leitura errada continua visível, marcada como corrigida, ao lado da correção.
- **Integridade da evidência:** o hash do comprovante gravado em cadeia prova que o arquivo apresentado é o mesmo usado no registro.
- **Separação dos dados:** dados pessoais (placa, UF, nome e CPF do proprietário, quem fez o serviço) ficam fora da blockchain.

**Não demonstra:**
- que a quilometragem informada era verdadeira;
- que o hodômetro não foi adulterado antes do primeiro registro ou entre registros;
- a identidade física de quem assinou (a assinatura prova a posse de uma chave);
- participação real de órgãos, vistorias ou oficinas;
- conformidade com a LGPD, que exige avaliação jurídica e institucional.

---

## Funcionalidades

### Consulta pública (qualquer pessoa)
- Busca pelo **chassi** (17 caracteres), aceitando minúsculas, espaços e hífens.
- Leitura de **QR Code** pela câmera do celular.
- Histórico completo, do mais recente para o mais antigo, com:
  - quilometragem e avanço desde a leitura anterior;
  - tipo de evento;
  - data do registro em cadeia;
  - carteira que assinou;
  - se há comprovante anexado.
- Sinalização de leituras **atípicas**, leituras **corrigidas** e registros cuja origem o contrato não garante.
- Etiqueta com QR Code do veículo, para baixar ou imprimir.

### Painel institucional (DETRAN, vistorias e oficinas)
- **Conta de login** (nome, e-mail e senha) e **vínculo da carteira MetaMask** à conta, provado por assinatura.
- **Cadastro de veículo** (DETRAN), em três seções:
  1. *Identificação do veículo:*
     - chassi e placa;
     - marca, escolhida num seletor com busca;
     - modelo, ano de fabricação e ano-modelo;
     - UF de registro na data do cadastro.
  2. *Primeira leitura:* quilometragem, data e hora da observação, entidade que realizou a leitura e comprovante.
  3. *Informações privadas:* proprietário na data do cadastro (nome e CPF).
- **Marcas:**
  - lista padronizada;
  - uma marca ausente pode ser **proposta** e fica pendente até o administrador aprovar;
  - nome igual ou muito parecido com uma marca existente é barrado.
- **Registro de leitura** (DETRAN, vistoria, oficina): quilometragem, tipo de evento, data e hora da observação e comprovante. Na transferência, pede também o novo proprietário.
- **Confirmação de leitura atípica:** o próprio contrato recusa e mostra o avanço, o limite e o período.
- **Correção de leitura** (DETRAN), com justificativa.
- **Registros privados** (DETRAN):
  - identificação do veículo;
  - placa, UF e proprietário **com histórico datado**;
  - registro de alterações, sem apagar as informações anteriores;
  - quem fez cada registro.
- **Comprovantes:** envio de PDF, PNG ou JPEG até 3 MB e abertura por link de uso único.
- **Acessos** (Admin):
  - conceder e revogar funções;
  - ver as contas cadastradas;
  - aprovar ou recusar marcas propostas.

---

## Como usar

### Consulta pública

1. Acesse https://kmchain-web.vercel.app.
2. Digite o chassi **ou** clique em "Escanear QR Code".
3. Veja o histórico.

**Experimente** com um veículo de teste já cadastrado:

<p align="center">
  <img src="docs/qr-exemplo.png" alt="QR Code de exemplo" width="200" />
</p>

- Chassi: `7GTNRJMVMHW482160`
- Link direto: https://kmchain-web.vercel.app/?chassi=7GTNRJMVMHW482160

### Painel institucional

Clique em **"Acesso institucional"**. O acesso tem duas camadas:

1. **Login e senha:** identifica a pessoa. Criar conta não dá nenhum acesso por si só.
2. **Carteira MetaMask na rede Sepolia, vinculada à conta e credenciada pelo administrador do contrato:** dá a permissão.

| Função | Pode fazer |
|---|---|
| Oficina / Centro de vistoria | Registrar leitura e enviar comprovante; abrir os comprovantes que a própria conta enviou |
| DETRAN | Tudo acima, cadastrar veículo, corrigir leitura, consultar e alterar registros privados, abrir qualquer comprovante, propor marca |
| Admin (quem publicou o contrato) | Conceder e revogar funções, ver as contas cadastradas, aprovar ou recusar marcas propostas |

Só o **Admin** concede funções. Uma carteira DETRAN não credencia outras.

---

## Arquitetura

```
Navegador (React + Vite)
   │
   ├── consulta pública ─────────► RPC público ──► Contrato KmChainRegistry (Sepolia)
   ├── registros (MetaMask) ─────────────────────► Contrato KmChainRegistry (Sepolia)
   │
   └── /api (Vercel Serverless Functions, Node.js)
          ├── auth/*      login, sessão, vínculo de carteira, lista de contas ──► Postgres
          ├── privado/*   identificação, placa, UF, proprietário (datados) ─────► Postgres
          ├── marcas      lista, proposta e revisão de marcas ──────────────────► Postgres
          ├── upload      comprovante cifrado ──────────────────────────────────► IPFS (Pinata)
          └── documento   link de uso único; decifra e confere o hash ──────────► IPFS + contrato
```

- **Identificador do veículo: o chassi.** Placa e RENAVAM mudam ao longo da vida do veículo e não o substituem. A chave do veículo é `keccak256(chassi normalizado)`, calculada por uma regra única (`web/src/lib/chassi.js`) usada pela tela, pelo servidor, pelo QR Code e pelos testes. Ela é igual à do contrato.
- **Consulta pública sem servidor:** o navegador lê o contrato direto por um RPC público.
- **Escrita:** a transação é assinada na MetaMask. Depois, o servidor **confere a transação na própria rede** antes de gravar os dados privados.

---

## O que fica na blockchain e o que fica no banco

| Dado | Blockchain (contrato em uso) | Banco privado |
|---|---|---|
| Chassi | chave `keccak256` + o chassi em texto nos dados da transação | sim |
| Marca e modelo | sim, num texto só ("Marca Modelo") | sim, separados, com o `id` da marca |
| Ano de fabricação / ano-modelo | só o ano-modelo | os dois |
| Placa, UF de registro | **não** | sim, **datados** |
| Nome e CPF do proprietário | **não** | sim, **datados** |
| Quilometragem | sim | sim |
| Data do registro (bloco) | sim | sim |
| Data da observação do hodômetro | não | sim |
| Tipo de evento | sim | sim |
| Carteira que assinou | sim | sim |
| Pessoa que fez o registro | não | sim |
| Comprovante | só o hash SHA-256 | índice (hash, CID, quem enviou) |

**Informações datadas:** uma mudança de placa, UF ou proprietário entra como **nova linha**, com a data em que passou a valer. Nada é sobrescrito, e o histórico anterior continua consultável.

**Privacidade:** a chave derivada do chassi é um **pseudônimo, não anonimização**. Quem conhece o chassi calcula a chave e encontra o histórico público, que é justamente o objetivo da consulta. No contrato em uso, o chassi também aparece em texto nos dados de cada transação. A proposta v2 remove isso.

---

## Segurança e controle de acesso

- Toda rota sensível é conferida **no servidor**; esconder botões na tela não é controle de acesso.
  - camada 1: sessão de login;
  - camada 2: carteira **vinculada** à conta, com a função exigida, **consultada no contrato**;
  - leituras sensíveis (lista de contas, dados privados, comprovantes, alterações) pedem ainda uma **assinatura na hora**, com o e-mail da conta e validade de 2 minutos.
- **Senhas** com bcrypt. **Sessão** em cookie `HttpOnly` assinado por HMAC-SHA256.
- **Registro privado conferido na transação:** o servidor verifica que ela deu certo, foi para o contrato do KMChain, saiu da carteira vinculada e tem o evento do chassi informado. Tipo, quilometragem, modelo e ano vêm do evento. Reenviar é seguro (idempotente).
- **Comprovantes:**
  - tipo detectado pelo conteúdo;
  - cifrados com **AES-256-GCM** antes do IPFS, enviados com nome aleatório e sem metadados;
  - abertos por **link de uso único de 60 segundos**, com regra de acesso por função e **trilha de auditoria**;
  - rotação de chave suportada.
- **Mensagens de erro:** dizem o motivo real (sem login, carteira diferente, sem função, serviço fora do ar), sem expor detalhes internos.

---

## Contrato inteligente

**Em uso:** `contratos/contracts/KmChainRegistry.sol`, na Sepolia, em `0x8BcAB5232FFa571B802ac444E5Aba43f7333c49C`.

- **Papéis** (OpenZeppelin `AccessControl`): `DEFAULT_ADMIN_ROLE`, `DETRAN_ROLE`, `VISTORIA_ROLE` e `OFICINA_ROLE`.
- **Funções:** `cadastrarVeiculo`, `registrarLeitura`, `corrigirLeitura`, `definirLimiteDoVeiculo`, `definirLimitePadrao`, `getVeiculo`, `getHistorico` e `conformidade`.
- **Regras:**
  - nunca aceita quilometragem regressiva;
  - limite de avanço de 1.000 km/dia por padrão (ajustável por veículo), acima do qual a leitura exige confirmação e fica marcada como atípica;
  - uma correção marca a original como contestada e anexa uma leitura nova.
- **"Conforme"** significa apenas que todos os registros após o cadastro têm comprovante. Não atesta que a quilometragem é verdadeira.

**Proposta v2, não implantada:** `contratos/contracts/KmChainRegistryV2.sol`.

- recebe a **chave** do veículo, não o chassi: o chassi não aparece nos dados nem nos logs das transações;
- separa o **tipo da leitura** (procedimento) do **motivo** (transferência, sinistro...), que fica só no banco;
- grava a **origem** (tipo de entidade) no momento do registro;
- tem uma **matriz de permissões**: cada entidade só registra os tipos compatíveis com sua atuação;
- guarda a **data da observação**;
- troca o hash direto do comprovante por um **compromisso com sal**;
- tira marca, modelo e ano da blockchain;
- custa **≈23% menos gas** por leitura.

A migração proposta não copia os registros antigos: a v1 continua legível, e a interface leria as duas. Detalhes na [revisão técnica](docs/REVISAO_TECNICA.md), seção 8.

---

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Blockchain | Ethereum (rede de testes Sepolia), Solidity 0.8.24, OpenZeppelin Contracts 5 (`AccessControl`) |
| Desenvolvimento do contrato | Hardhat 2, Hardhat Toolbox (ethers, Chai, gas reporter) |
| Frontend | React 19, Vite 8, ethers.js 6, MetaMask, html5-qrcode (leitura do QR), qrcode.react (etiqueta) |
| Backend | Vercel Serverless Functions (Node.js), `node:crypto` (AES-256-GCM, HMAC-SHA256, SHA-256), bcryptjs |
| Banco de dados | PostgreSQL (driver `pg`), com migração automática e aditiva |
| Armazenamento de comprovantes | IPFS via Pinata (arquivos cifrados) |
| Testes | Mocha/Chai (contrato), `node:test`, PGlite (Postgres em memória), nó Hardhat local |
| Qualidade | oxlint |
| Hospedagem | Vercel |

---

## Estrutura do repositório

```
contratos/
  contracts/KmChainRegistry.sol      contrato em uso (v1)
  contracts/KmChainRegistryV2.sol    proposta v2 (não implantada)
  test/                              testes do contrato (v1 e v2)
  scripts/                           deploy, credenciamento, diagnóstico e medição de gas
web/
  api/                               rotas /api (auth, privado, marcas, upload, documento)
  src/componentes/                   telas (consulta, histórico, painel, cadastro, leitura...)
  src/ui/                            componentes de interface (campo, botão, seletor de marca...)
  src/lib/                           regras compartilhadas (chassi, veículo, validação, mensagens)
  src/dados/marcas.json              lista padronizada de marcas
  test/                              testes de integração das rotas
docs/
  DOCUMENTACAO.txt                   documentação do sistema
  REVISAO_TECNICA.md                 revisão técnica, privacidade, proposta v2 e limitações
```

---

## Rodando localmente

Requisitos: **Node.js 20.19+ ou 22.12+** e a extensão **MetaMask** na rede Sepolia (só para gravar).

```bash
# Contrato: compila e roda os testes
cd contratos
npm install
npx hardhat test

# Sistema completo (tela + login + /api) em http://localhost:5173
cd web
npm install
npm run dev
```

O `web/` precisa de dois arquivos de configuração, que não vão para o git:
- **`.env`:** variáveis públicas `VITE_RPC_URL`, `VITE_CHAIN_ID`, `VITE_API_URL`, `VITE_IPFS_GATEWAY` e `VITE_EXPLORER`.
- **`.env.local`:** segredos `PINATA_JWT`, `GATEWAY`, `RPC_URL`, `DATABASE_URL`, `SESSION_SECRET` e `DOCS_KEY` (chave AES-256 de 32 bytes em base64). Opcionais: `DOCS_KEYS_ANTIGAS` e `KMCHAIN_ENDERECO`.

O `npm run dev` carrega o `.env.local` e serve todas as rotas `/api`, **usando o banco e a rede reais** configurados ali. As tabelas do banco são criadas sozinhas na primeira chamada.

---

## Testes

```bash
cd contratos && npx hardhat test    # 38 testes: contrato em uso + proposta v2
cd web && npm test                  # 55 testes: rotas /api de ponta a ponta
cd web && npx oxlint && npm run build
```

Os testes das rotas sobem uma **blockchain Hardhat local** com o contrato, um **Postgres em memória** (PGlite) e um **Pinata simulado**. Não tocam na Sepolia nem no banco real e usam **apenas dados fictícios**.

**O que cobrem:**
- login e carteira vinculada, inclusive carteira diferente, sem função, assinatura expirada, RPC e banco fora do ar;
- cadastro completo e validação de cada campo;
- marca ausente da lista e mudança posterior de placa, UF ou proprietário sem perda de histórico;
- conferência da transação (outro contrato, outra carteira, transação que falhou);
- idempotência;
- comprovantes: link de uso único, expiração, arquivo adulterado e limite de pedidos;
- consulta por chassi e QR Code.

**Cenários do contrato:**
- evolução normal e quilometragem regressiva;
- erro de digitação e avanço atípico legítimo;
- correção e revogação de credencial;
- evidência alterada;
- custo de gas (v1 × v2).

---

## Limitações conhecidas

- **No contrato em uso (v1):**
  - o chassi vai em texto nos dados das transações;
  - marca, modelo e ano-modelo ficam públicos;
  - a data da observação só existe no banco;
  - a função da carteira na época do registro não fica gravada;
  - qualquer credenciada consegue gravar registros do tipo "correção" ou "cadastro" (a interface os sinaliza como sem garantia de origem).
- **Proposta v2:** corrige esses pontos, mas não está implantada.
- **Validação:** o dígito verificador do VIN não é conferido.
- **Marcas e modelos:** a lista de marcas é curada para o protótipo e não é oficial; o modelo é texto livre.
- **Autenticação:** a sessão não é revogável antes de expirar (7 dias) e o login não limita tentativas.
- **IPFS:** é público e permanente; um arquivo enviado não pode ser apagado com garantia, mesmo cifrado.

---

## Documentação complementar

- [docs/DOCUMENTACAO.txt](docs/DOCUMENTACAO.txt): documentação do sistema (contrato, telas, rotas, banco, variáveis, como rodar).
- [docs/REVISAO_TECNICA.md](docs/REVISAO_TECNICA.md): revisão técnica e de privacidade; inclui:
  - defeitos corrigidos;
  - matriz de entidades e leituras, com fontes;
  - matriz de dados;
  - proposta v2 e migração;
  - validação experimental;
  - limitações e texto de apoio para o TCC.
