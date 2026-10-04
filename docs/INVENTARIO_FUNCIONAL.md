# Inventário funcional do KMChain

Estado do código em 04/10/2026. Descreve o que o sistema faz hoje, como faz e quem pode fazer cada coisa. Tudo aqui foi conferido contra o código do repositório; o que não está implementado aparece nas seções V e W.

**Leia antes:**

- O `KmChainRegistryV2` é o único contrato usado pela aplicação. Foi implantado na Sepolia em 04/10/2026, em `0x149954119af7491fA8d602A2009b31f8c05652f0`, com o código-fonte verificado no Etherscan. O site publicado já usa esse contrato.
- A primeira versão do contrato (`KmChainRegistry.sol`, v1) e os testes dela continuam no repositório, como registro da evolução do projeto. A aplicação não lê nem escreve nela.
- O banco foi limpo e o cenário de demonstração (seção Z) foi criado na Sepolia em 04/10/2026, pelo script, com a aplicação rodando localmente contra o banco e a rede reais. Banco e contrato foram conferidos: os 15 eventos existem nos dois.
- A interface foi validada por build e lint. Os fluxos de tela **não foram exercitados em navegador** (exigem MetaMask); o que está coberto por teste automatizado é o contrato e as rotas `/api`.
- A versão atual está publicada em https://kmchain-web.vercel.app. As rotas `/api` foram conferidas no site publicado (lista de organizações, identificação de veículo, recusa sem sessão e rota inexistente), o que valida o roteamento do `vercel.json`.
- A verificação de localização do dispositivo (seção M.1) foi acrescentada depois da primeira versão deste inventário. Ela é toda off-chain: **o contrato não foi alterado**.

Legenda de situação: **[I]** implementado · **[P]** parcialmente implementado · **[N]** não implementado.

---

## A. Visão geral

**O que é.** Protótipo acadêmico (TCC) que registra eventos com a quilometragem de veículos numa blockchain pública, para dar rastreabilidade ao histórico e dificultar adulteração posterior.

**Finalidade.** Permitir que qualquer pessoa consulte, pelo chassi, a sequência de quilometragens registradas, cada uma com tipo de evento, data e hora, município e organização responsável.

**Arquitetura.**

```
Navegador (React + Vite)
   ├── consulta pública ───────► RPC público ──► KmChainRegistryV2
   ├── transações (MetaMask) ──────────────────► KmChainRegistryV2
   └── /api (uma Serverless Function) ─► servidor/rotas.js
            controladores → serviços → repositórios ─► PostgreSQL
                                     └─► leitura do contrato (conferência)
                                     └─► IPFS/Pinata (comprovantes cifrados)
```

O servidor nunca assina transações. Quem assina é a carteira do usuário; o servidor lê o contrato para conferir o que aconteceu e guarda o complemento.

**Tecnologias.** Solidity 0.8.24, Hardhat 2, ethers 6, React 19, Vite 8, Node.js (Vercel Serverless Functions), PostgreSQL (`pg`), bcryptjs, IPFS via Pinata, Leaflet 1.9 com OpenStreetMap, html5-qrcode, qrcode.react, oxlint. Testes: Mocha/Chai, `node:test`, PGlite.

**Papel da blockchain.** Guardar, de forma que não se altera depois, os eventos de quilometragem e o cadastro mínimo de quem pode registrá-los (organização, tipo, situação, administrador, vínculo de cada carteira).

**Papel do banco.** Guardar tudo o que não precisa ou não deve ser público e permanente: contas, cadastro das organizações, identificação do veículo, proprietário, quem registrou cada evento, solicitações de correção, índice dos comprovantes e auditoria.

---

## B. Atores

| Ator | Como existe no sistema |
|---|---|
| DETRAN | Organização 1 do contrato, criada no deploy. Quem implanta é o primeiro administrador. |
| Oficina | Organização tipo `OFICINA`, credenciada pelo DETRAN. |
| Empresa de vistoria | Organização tipo `VISTORIA`, credenciada pelo DETRAN. |
| Seguradora | Organização tipo `SEGURADORA`, credenciada pelo DETRAN. |
| Público | Sem conta. Só usa a consulta e o mapa. |

Os tipos pedidos como `WORKSHOP`, `INSPECTION` e `INSURER` foram implementados com nomes em português (`OFICINA`, `VISTORIA`, `SEGURADORA`), seguindo o idioma do código.

Dentro de cada organização há dois papéis: **administrador** (um por organização, definido pelo DETRAN) e **funcionário**.

### DETRAN

- **Finalidade:** autoridade administrativa do protótipo.
- **Pode:** cadastrar, credenciar, suspender e reativar organizações; trocar o administrador de qualquer organização; alterar dados cadastrais; ver a equipe de qualquer organização; cadastrar veículos; registrar os eventos institucionais próprios; corrigir de ofício; aprovar e rejeitar solicitações de correção; consultar e alterar os dados complementares do veículo; abrir qualquer comprovante; propor marcas; ver todos os registros, a lista de contas e a auditoria.
- **Só o administrador do DETRAN:** vincular e desativar funcionários do DETRAN; aprovar ou recusar marcas propostas.
- **Não pode:** registrar eventos de oficina, vistoria ou seguradora; abrir solicitação de correção; ser suspenso.
- **Telas:** Início, Consultar, Novo registro, Cadastrar veículo, Correções, Registros, Organizações, Dados complementares, Auditoria; Equipe (só o administrador).

### Oficina, empresa de vistoria e seguradora

- **Finalidade:** registrar os eventos do próprio tipo.
- **Funcionário pode:** registrar eventos permitidos ao tipo da organização; enviar comprovantes e abrir os que a própria conta enviou; abrir solicitação de correção e acompanhar as da organização; ver os registros da organização.
- **Administrador pode, além disso:** vincular, desativar e reativar funcionários da própria organização; ver a equipe.
- **Não podem:** registrar eventos de outro tipo de organização; cadastrar veículo; corrigir, aprovar ou rejeitar; credenciar; ver ou administrar outra organização; mudar o próprio tipo; ver dados do proprietário.
- **Telas:** Início, Consultar, Novo registro, Correções, Registros; Equipe (só o administrador).

### Público

- **Pode:** consultar o histórico pelo chassi ou QR Code; ver o mapa das organizações; baixar a etiqueta com QR Code.
- **Não tem:** conta, login ou qualquer ação de escrita.

---

## C. Funcionalidades

| # | Funcionalidade | Ator | Blockchain | Banco | Situação |
|---|---|---|---|---|---|
| 1 | Consulta pública por chassi | Público | leitura do contrato | identificação, nomes das organizações, transações | [I] |
| 2 | Leitura de QR Code e etiqueta | Público | — | — | [I] |
| 3 | Mapa das organizações credenciadas | Público, DETRAN | — | endereço e coordenadas | [I] |
| 4 | Histórico de locais dos registros | Público | município de cada evento | — | [I] (lista; sem mapa) |
| 5 | Criar conta e entrar | Institucional | — | `usuarios` | [I] |
| 6 | Vincular carteira à conta | Institucional | — | `usuarios.carteira` | [I] |
| 7 | Cadastrar organização | DETRAN | — | `organizacoes` (pendente) | [I] |
| 8 | Credenciar organização | DETRAN | `credenciarOrganizacao` | situação, id em cadeia | [I] |
| 9 | Suspender e reativar | DETRAN | `definirSituacaoDaOrganizacao` | situação espelhada | [I] |
| 10 | Trocar administrador | DETRAN | `definirAdministrador` | `membros`, `organizacoes` | [I] |
| 10a | Informar ou trocar a carteira de uma conta (no cadastro da organização ou no detalhe dela) | DETRAN | `definirAdministrador`, se a organização já estiver credenciada | `usuarios.carteira`, auditoria | [I] |
| 11 | Alterar cadastro da organização | DETRAN | — | cadastro e nome datado | [I] |
| 12 | Vincular, desativar e reativar funcionário | Administrador | `definirFuncionario` | `membros` | [I] |
| 13 | Consultar equipe | Administrador, DETRAN | — | `membros` | [I] |
| 14 | Cadastrar veículo | DETRAN | `cadastrarVeiculo` | identificação, placa, UF, proprietário | [I] |
| 15 | Registrar evento | Todos os tipos | `registrarEvento` | complemento do evento | [I] |
| 16 | Confirmação de avanço atípico | Quem registra | revert `LeituraAtipica` + confirmação | — | [I] |
| 17 | Vistoria a pedido de seguradora | Empresa de vistoria | evento tipo 25 | seguradora contratante | [I] |
| 18 | Transferência de propriedade | DETRAN | evento tipo 3 | novo proprietário datado | [I] |
| 19 | Solicitar correção | Oficina, vistoria, seguradora | — | `solicitacoes_correcao` | [I] |
| 20 | Analisar, aprovar e rejeitar | DETRAN | `corrigirLeitura` (só na aprovação) | decisão e motivo | [I] |
| 21 | Correção de ofício | DETRAN | `corrigirLeitura` | justificativa | [I] |
| 22 | Registros da organização | Todos | — | `eventos` | [I] |
| 23 | Dados complementares do veículo | DETRAN | — | identificação e datados | [I] |
| 24 | Alterar placa, UF ou proprietário | DETRAN | — | linha nova datada | [I] |
| 25 | Completar identificação | DETRAN | leitura | `veiculos` | [I] |
| 26 | Ambiente local e cenário de demonstração por script | Quem apresenta | transações assinadas pelas carteiras de demonstração | criado pelas rotas `/api` | [I] |
| 27 | Marcas: lista, proposta e revisão | DETRAN | — | `marcas_adicionais` | [I] |
| 28 | Comprovantes: envio e abertura | Institucional | hash no evento | `documentos`, IPFS cifrado | [I] |
| 29 | Lista de contas | DETRAN | — | `usuarios` | [I] |
| 30 | Auditoria administrativa | DETRAN | — | `auditoria` | [I] |
| 31 | Verificação da localização do dispositivo no registro | Quem registra | — (segue só o município) | colunas `localizacao_*` de `eventos` | [I] |
| 32 | Justificativa de registro fora do local ou sem localização | Quem registra | — | `localizacao_justificativa` | [I] |
| 33 | Consulta e filtro de registros com localização divergente ou não verificada | DETRAN | — | `eventos` | [I] |
| 34 | Indicador público "Localização verificada" | Público | — | derivado de `localizacao_situacao` | [I] |

**Regras principais (valem para vários itens):**

- A quilometragem nunca regride; o contrato recusa.
- Avanço acima de 1.000 km por dia entre as datas dos eventos exige confirmação e fica marcado como atípico.
- A data do evento não pode ser futura, ter mais de 30 dias nem ser anterior à do último evento do veículo.
- O servidor não aceita do navegador os dados do evento: lê quilometragem, tipo, data, município, organização e responsável no próprio contrato.
- Reenviar a mesma transação ao servidor não duplica nada.
- Todo evento de "Novo registro" passa pela verificação de localização; sem localização compatível, só segue com justificativa (seção M.1).

---

## D. Telas

Navegação por hash. Não há roteador.

| Tela | Rota | Quem acessa | Componente | Ações |
|---|---|---|---|---|
| Consulta pública | `/` e `/?chassi=` | Todos | `ConsultaVeiculo`, `Historico`, `LeitorQr`, `EtiquetaQr` | buscar, escanear, ver detalhes (com o indicador de localização verificada), baixar etiqueta |
| Organizações credenciadas | `#/organizacoes` | Todos | `MapaOrganizacoes`, `ui/Mapa` | filtrar por tipo, UF e cidade; selecionar |
| Acesso institucional | `#/institucional` | Sem sessão | `Autenticacao` | entrar, criar conta |
| Etapas de acesso | `#/institucional` | Conta sem vínculo | `Painel` (`EtapasAcesso`) | conectar e vincular carteira |
| Início | `#/institucional/inicio` | Vinculados | `Painel` (`Inicio`) | atalhos e dados da conta |
| Consultar | `…/consulta` | Vinculados | `ConsultaVeiculo` | mesma consulta, com abertura de comprovantes |
| Novo registro | `…/registro` | Vínculo ativo | `RegistroEvento` | registrar evento, com captura da localização do dispositivo e justificativa quando exigida |
| Cadastrar veículo | `…/cadastro` | DETRAN | `CadastroVeiculo`, `SeletorMarca` | cadastrar |
| Correções | `…/correcoes` | Vínculo ativo | `Correcoes`, `SolicitarCorrecao`, `AnaliseCorrecao`, `CorrigirLeitura` | solicitar; analisar; corrigir de ofício |
| Registros | `…/registros` | Vínculo ativo | `RegistrosDaOrganizacao` | listar, abrir histórico, abrir transação, ver a situação da localização; o DETRAN filtra e abre os detalhes da localização |
| Equipe | `…/equipe` | Administrador | `Equipe` | vincular, desativar, reativar |
| Organizações | `…/organizacoes` | DETRAN | `Organizacoes`, `FormularioOrganizacao`, `Equipe`, `MapaOrganizacoes` | cadastrar, credenciar, suspender, reativar, trocar administrador, editar |
| Dados complementares | `…/complementares` | DETRAN | `DadosComplementares`, `CompletarIdentificacao` | consultar, alterar, completar |
| Auditoria | `…/auditoria` | DETRAN | `Auditoria`, `MarcasPropostas` | filtrar; revisar marcas (administrador) |

Organização suspensa: os funcionários continuam entrando, veem um aviso e só têm Início e Consultar.

---

## E. Tipos de evento

Catálogo em `web/src/lib/eventos.js`. O código é o valor gravado em cadeia.

| Código | Evento | Quem registra | Exige além do padrão |
|---|---|---|---|
| 0 | Cadastro inicial | DETRAN, só por `cadastrarVeiculo` | identificação e proprietário (banco) |
| 1 | Correção de leitura | DETRAN, só por `corrigirLeitura` | evento referenciado; justificativa ou solicitação |
| 2 | Vistoria do DETRAN | DETRAN | — |
| 3 | Transferência de propriedade | DETRAN | nome e CPF do novo proprietário (banco) |
| 10 | Revisão | Oficina | — |
| 11 | Manutenção | Oficina | — |
| 12 | Orçamento | Oficina | — |
| 13 | Inspeção mecânica | Oficina | — |
| 14 | Reparo | Oficina | — |
| 15 | Troca de componentes | Oficina | — |
| 20 | Vistoria de transferência | Empresa de vistoria | — |
| 21 | Vistoria de sinistro | Empresa de vistoria | — |
| 22 | Vistoria de GNV | Empresa de vistoria | — |
| 23 | Vistoria de alteração de característica | Empresa de vistoria | — |
| 24 | Vistoria cautelar | Empresa de vistoria | — |
| 25 | Vistoria a pedido de seguradora | Empresa de vistoria | seguradora contratante (banco) |
| 30 | Vistoria prévia de seguro | Seguradora | — |
| 31 | Vistoria de renovação de seguro | Seguradora | — |
| 32 | Inspeção de sinistro (seguro) | Seguradora | — |

**Padrão, em todo evento:** chassi, quilometragem, data e hora do evento, município e, opcionalmente, um comprovante.

**Vai para a blockchain:** chave do veículo, quilometragem, código do tipo, data do evento, data do bloco, código IBGE do município, id da organização, carteira do responsável, referência (correção), hash do comprovante, marca de atípico.

**Fica no banco:** nome e e-mail de quem registrou, transação, justificativa, seguradora contratante, novo proprietário e a verificação de localização do dispositivo (posição, precisão, distância, situação e justificativa).

Um tipo novo entra no catálogo e é liberado em cadeia por `definirTiposPermitidos`, sem novo deploy. Os tipos marcados como vistoria no catálogo (2, 20–25, 30–32) podem servir de evidência numa solicitação de correção.

---

## F. Blockchain

**Contrato:** `contratos/contracts/KmChainRegistryV2.sol`, Solidity 0.8.24, sem dependências externas. Implantado na Sepolia em `0x149954119af7491fA8d602A2009b31f8c05652f0` (deploy de 2.245.627 gas; fonte verificada no Etherscan). É o único contrato usado pela aplicação. A carteira que implantou, `0x3abCa8bD636b17391B6E8bDE4B58D5f16643Ea0F`, é a administradora do DETRAN. A primeira versão, `KmChainRegistry.sol` (v1), permanece no repositório com seus testes e na Sepolia em `0x8BcAB5232FFa571B802ac444E5Aba43f7333c49C`; o contrato novo guarda esse endereço em `contratoAnterior` apenas como referência histórica.

### Estruturas

```
Evento  (3 slots)
  km uint64 · dataEvento uint64 · dataBloco uint64 · municipio uint32 · tipo uint8 · atipica bool
  responsavel address · organizacao uint32 · referencia uint32
  hashDocumento bytes32

Veiculo (1 slot)
  cadastrado bool · limiteDiario uint32 · totalEventos uint32 · totalCorrecoes uint32
  ultimaKm uint64 · ultimaDataEvento uint64

Organizacao (1 slot)
  tipo uint8 · ativa bool · credenciadaEm uint64 · administrador address

Vinculo
  organizacao uint32 · ativo bool
```

Mapeamentos: organização por id; vínculo por carteira; veículo e histórico por chave; `correcaoDe` (índice corrigido → índice da correção); `tiposPermitidos` por tipo de organização (máscara de bits).

### Funções públicas de escrita

| Função | Quem | O que faz |
|---|---|---|
| `credenciarOrganizacao(tipo, administrador)` | DETRAN | cria a organização com id sequencial e vincula o administrador |
| `definirSituacaoDaOrganizacao(id, ativa)` | DETRAN | suspende ou reativa (não vale para o DETRAN) |
| `definirAdministrador(id, novo)` | DETRAN | troca o administrador; o anterior continua vinculado |
| `definirFuncionario(carteira, ativo)` | Administrador | vincula ou desativa na própria organização |
| `cadastrarVeiculo(chave, km, dataEvento, municipio, hash)` | DETRAN | cria o veículo com o evento 0 |
| `registrarEvento(chave, km, tipo, dataEvento, municipio, hash, confirmarAtipica)` | Vínculo ativo | registra um evento do tipo permitido |
| `corrigirLeitura(chave, indice, kmCorreta, dataEvento, municipio, hash)` | DETRAN | registra a correção |
| `definirTiposPermitidos(tipo, mascara)` | DETRAN | ajusta a matriz |
| `definirLimiteDoVeiculo`, `definirLimitePadrao` | DETRAN | ajustam o limite diário |

### Funções de leitura

`getVeiculo`, `getHistorico`, `getEvento`, `correcaoDe`, `getOrganizacao`, `vinculoDe`, `tiposPermitidos`, `totalOrganizacoes`, `limiteDiarioPadrao`, `contratoAnterior`, e as constantes `TIPO_CADASTRO_INICIAL`, `TIPO_CORRECAO`, `ORGANIZACAO_DETRAN`, `SEM_REFERENCIA`, `ATRASO_MAXIMO`.

### Funções internas relevantes

`_vinculoAtivo` (exige vínculo ativo em organização ativa), `_vincular` (uma carteira por organização), `_definirAdministrador`, `_avaliar` (regras de km, data e atípico), `_conferirDataDoEvento`, `_conferirMunicipio`, `_anexar`, `_permitir`, `_faixa`.

### Eventos Solidity

`VeiculoCadastrado(chave)`, `EventoRegistrado(chave, indice)`, `LeituraCorrigida(chave, indiceOriginal, indiceCorrecao)`, `OrganizacaoCredenciada(organizacao, tipo)`, `SituacaoDaOrganizacaoAlterada(organizacao, ativa)`, `AdministradorDefinido(organizacao, administrador)`, `FuncionarioDefinido(organizacao, carteira, ativo)`, `TiposPermitidosAlterados(tipoOrganizacao, tipos)`. Levam só identificadores.

### Regras de acesso

- Não usa `AccessControl`. A permissão vem do vínculo: `apenasDetran` exige vínculo ativo com organização do tipo DETRAN.
- `registrarEvento` exige vínculo ativo, organização ativa e tipo de evento liberado para o tipo da organização.
- Cadastro (0) e correção (1) nunca entram por `registrarEvento`, nem se liberados na matriz.

### Como cada item pedido foi representado

| Item | Representação |
|---|---|
| Veículo | `bytes32` = `keccak256(chassi normalizado)`, calculado fora da cadeia. O chassi em texto não é enviado. É um pseudônimo: quem conhece o chassi acha o histórico. |
| Data e hora | `dataEvento` (informada) e `dataBloco` (da transação), em segundos. |
| Localização | código IBGE do município, `uint32`. O contrato só confere a faixa (1100000 a 5399999). A posição do dispositivo não vai para o contrato. |
| Organização | id sequencial `uint32`, tirado do vínculo de quem assina, não de um parâmetro. |
| Usuário | endereço da carteira que assinou (`responsavel`). Não há hash separado de usuário. |
| Referência | índice do evento corrigido; `SEM_REFERENCIA` nos demais. |

### Correção

`corrigirLeitura` não modifica o evento original. Ela anexa um evento novo de tipo 1 com `referencia` apontando para o original e grava `correcaoDe[original] = novo`. Um evento só é corrigido uma vez; a própria correção pode ser corrigida. Depois, `ultimaKm` passa a ser a maior quilometragem entre os eventos não corrigidos.

### Gas medido nos testes (rede local)

| Operação | Gas |
|---|---|
| `registrarEvento` | 94.202 a 114.498 |
| `cadastrarVeiculo` | ~122.700 |
| `corrigirLeitura` | ~124.200 |
| `credenciarOrganizacao` | ~82.300 |
| `definirFuncionario` | 33.613 a 50.811 |
| Deploy | 2.245.387 |

No mesmo cenário de teste, um registro com comprovante custou 148.649 na v1 e 114.498 na v2.

---

## G. Dados off-chain

| Dado | Por que fica fora |
|---|---|
| Nome e CPF do proprietário | dado pessoal; não pode ser público nem permanente |
| Placa e UF de registro | mudam ao longo da vida do veículo; a placa pode identificar o dono |
| Marca, modelo, anos | não são necessários para provar a quilometragem; podem ser corrigidos |
| Razão social, nome fantasia, CNPJ, contato e endereço da organização | cadastrais e mutáveis |
| Nome e e-mail de funcionários | dado pessoal |
| Comprovantes | arquivos; em cadeia vai só o hash |
| Justificativas, motivos de decisão, solicitações rejeitadas | administrativo |
| Seguradora contratante de uma vistoria | relação comercial, não necessária ao registro |
| Auditoria | rotina administrativa |
| Latitude, longitude e precisão do dispositivo no registro, distância até a organização, situação da verificação e justificativa | dado sensível de quem registra; serve à auditoria do DETRAN e não precisa ser público nem permanente |

---

## H. Modelo de dados

Migração aditiva e idempotente em `web/servidor/nucleo/banco.js`, executada na primeira consulta de cada instância.

| Tabela | Finalidade | Campos principais | Relacionamentos |
|---|---|---|---|
| `usuarios` | contas de login | nome, email, senha_hash, carteira | — |
| `organizacoes` | cadastro das organizações | id_cadeia, tipo, razão social, nome fantasia, CNPJ, contato, endereço, municipio_ibge, latitude, longitude, situacao, credenciada_em, credenciamento_tx | administrador_id, criada_por → `usuarios` |
| `organizacao_nomes` | nomes datados | razão social, nome fantasia, vigente_desde | organizacao_id |
| `membros` | vínculo conta–organização (espelho do contrato) | carteira, papel, ativo, vinculado_em, desativado_em | organizacao_id, usuario_id |
| `eventos` | complemento de cada evento em cadeia | chassi, contrato, indice, tipo_codigo, tipo_evento, quilometragem, observada_em (data do evento), registrado_em_cadeia, municipio_ibge, referencia_indice, hash_documento, justificativa, tx_hash, carteira; verificação de localização: localizacao_situacao, localizacao_latitude, localizacao_longitude, localizacao_precisao (m), localizacao_distancia (m), localizacao_capturada_em, localizacao_motivo, localizacao_justificativa | organizacao_id, seguradora_id, usuario_id |
| `solicitacoes_correcao` | pedidos de correção | chassi, indice_original, km_original, km_solicitada, justificativa, hash_evidencia, vistoria_indice, situacao, motivo_decisao, correcao_indice, correcao_tx | organizacao_id, usuario_id, analisada_por |
| `auditoria` | ações administrativas | acao, alvo_tipo, alvo_id, detalhes (JSON) | usuario_id, organizacao_id |
| `veiculos` | identificação | chassi, chave, marca, modelo, anos, cadastro_tx, origem | cadastrado_por |
| `veiculo_placas`, `veiculo_ufs`, `veiculo_proprietarios` | informações datadas | valor, vigente_desde, origem, tx_hash | registrado_por |
| `documentos` | índice dos comprovantes | hash, cid, mime, tamanho, chassi | enviado_por |
| `tokens_documento` | links de uso único | token_hash, expira_em, usado_em | usuario_id |
| `acessos_documentos` | quem pediu cada comprovante | hash, resultado | usuario_id |
| `marcas_adicionais` | marcas propostas | nome, situacao | proposta_por, revisada_por |

`eventos` é a antiga `registros_privados`, renomeada pela migração. A coluna `contrato` distingue linhas de versões do contrato; depois da limpeza do banco só há linhas `v2`.

As colunas `localizacao_*` ficam vazias nos eventos que não passam pela verificação (cadastro e correção). A coordenada de referência não é copiada para o evento: é a do cadastro da organização (`organizacoes.latitude` e `longitude`); o que se guarda é a distância calculada no momento do registro.

---

## I. Autenticação e autorização

**Login.** E-mail e senha, com bcrypt (custo 12). Sessão em cookie `HttpOnly`, `SameSite=Lax`, assinado por HMAC-SHA256, com validade de 7 dias.

**Camadas de acesso** (`servidor/servicos/autorizacao.js`):

1. sessão válida e conta existente;
2. carteira vinculada à conta (provada por assinatura no vínculo);
3. vínculo **ativo** dessa carteira com organização **ativa**, lido do contrato a cada requisição.

A rota declara o que exige: tipos de organização aceitos e, quando for o caso, papel de administrador. `validarOrganizacaoPodeRegistrarEvento` confere o tipo de evento contra o catálogo.

**Assinatura na hora.** Lista de contas, dados complementares, alterações do veículo e abertura de comprovante pedem que a carteira assine uma mensagem com o e-mail da conta e o horário, válida por 2 minutos.

**Proteção na tela.** O painel monta o menu pelo vínculo lido do contrato. É só conveniência: o servidor e o contrato conferem de novo.

**Não há:** recuperação de senha, limite de tentativas de login, revogação de sessão antes do prazo, desativação de conta sem vínculo.

---

## J. Organizações

1. **Cadastro.** O DETRAN preenche tipo, razão social, nome fantasia, CNPJ, telefone, e-mail, CEP, logradouro, número, complemento, bairro, UF e cidade, posição no mapa (opcional) e o e-mail da conta do administrador. O servidor valida (inclusive dígitos do CNPJ e o município na lista do IBGE) e grava como **pendente**.
2. **Credenciamento.** O DETRAN assina `credenciarOrganizacao`. O servidor confere a transação, lê o id atribuído e o administrador gravados, e marca a organização como **ativa**.
3. **Administrador.** Precisa ter conta e carteira, e não estar ativo em outra organização. A carteira pode ser vinculada pela própria pessoa, com assinatura, ou informada pelo DETRAN no cadastro da organização ou no detalhe dela ("Informar carteira" / "Trocar carteira"). Se a organização já estiver credenciada, a troca da carteira é seguida da assinatura de `definirAdministrador` para a carteira nova; a anterior continua vinculada à organização no contrato, como funcionário. A troca é assinada pelo DETRAN e espelhada no banco; o anterior vira funcionário.
4. **Funcionários.** O administrador informa o e-mail de uma conta já criada, assina `definirFuncionario` e o servidor espelha. Desativar não apaga: o vínculo fica com data de desativação.
5. **Situação.** `pendente`, `ativa`, `suspensa`. Suspender e reativar são transações do DETRAN. A organização suspensa não registra; o que ela já registrou permanece.
6. **Alteração cadastral.** Só o DETRAN. Tipo e CNPJ não mudam. Mudança de nome gera linha em `organizacao_nomes`, e a consulta pública mostra o nome da época do evento.

Limitações: não há exclusão de organização pendente nem troca do administrador indicado antes do credenciamento.

---

## K. Correção de leitura

**Solicitação.** Funcionário de oficina, vistoria ou seguradora escolhe o veículo e o registro, informa a quilometragem que considera correta, a justificativa (10 a 1000 caracteres) e a evidência: um documento enviado pela própria conta, uma vistoria já registrada no histórico do mesmo veículo, ou os dois. O servidor recusa se o registro não existe, já foi corrigido, se o valor é igual ao registrado ou se já há solicitação em análise para o mesmo registro. Nada vai para a blockchain.

**Análise.** O DETRAN vê o registro original (tipo, km, data, local, organização e funcionário), o valor solicitado, a justificativa, o documento e a vistoria indicada com organização, funcionário, data e local.

**Rejeição.** Exige motivo. A solicitação fica `REJEITADA` no banco, com quem decidiu e quando. Nenhum evento é registrado.

**Aprovação.** O DETRAN informa motivo, data e hora e município da correção, e assina `corrigirLeitura` com a quilometragem solicitada. O servidor confere que a transação é a correção daquele registro, com aquele valor, e marca `APROVADA`. A aprovação e a efetivação são um passo só; não existe "aprovada e ainda não efetivada".

**Imutabilidade.** O teste compara o evento original campo a campo antes e depois da correção e exige igualdade.

**Correção de ofício.** O DETRAN pode corrigir sem solicitação, com justificativa obrigatória.


---

## L. Consulta pública

- **Como:** chassi de 17 caracteres ou QR Code. O chassi vai para a URL (`?chassi=`).
- **De onde vem:** os eventos são lidos pelo navegador direto do contrato, por RPC público. Do servidor vêm a identificação do veículo, o nome das organizações e o hash das transações.
- **Aparece por evento:** tipo, quilometragem e avanço, data e hora do evento, cidade e UF, "Registrado por" com o nome da organização, "Registro verificado na blockchain", "Localização verificada no momento do registro" (só quando a verificação resultou compatível), notas de correção e de avanço atípico. Em "Ver detalhes": data da transação, situação do credenciamento na data, comprovante anexado ou não, id da organização, código IBGE, carteira do responsável, link da transação no explorador e hash do comprovante.
- **Aparece do veículo:** marca, modelo, anos, placa e UF vigentes, com a nota de que vêm do cadastro e não da blockchain.
- **Não aparece:** proprietário, CPF, nome ou e-mail de funcionários, conteúdo de comprovantes, justificativas, solicitações, coordenadas do dispositivo, distância, precisão e a informação de que um registro foi feito fora do local cadastrado ou sem localização.
- **"Verificado na blockchain"** significa que o evento foi lido do contrato naquele momento. Não há verificação criptográfica adicional no navegador.

---

## M. Localização

| Aspecto | Como está |
|---|---|
| Cadastral | endereço completo e coordenadas da organização, no banco |
| Do evento | código IBGE do município, escolhido no registro; vem preenchido com o município da organização e pode ser trocado |
| Em cadeia | só o código IBGE |
| Nome da cidade | resolvido na tela por `dados/municipios.json` (5.571 municípios, da API de localidades do IBGE) |
| Mapa | Leaflet sobre OpenStreetMap, com filtros por tipo, UF e cidade |
| Geocodificação | no navegador: ViaCEP preenche o endereço; Nominatim sugere coordenadas; um clique no mapa ajusta |
| Histórico geográfico | lista cronológica dos locais dos eventos, na consulta |

**Limitações:** o município gravado em cadeia é o declarado por quem registra; a posição do dispositivo só gera uma sugestão na tela quando indica outra cidade, e o servidor não confere o município contra as coordenadas. O histórico de locais não é trajeto. Não há mapa dos eventos de um veículo. ViaCEP e Nominatim são serviços de terceiros, sem garantia de disponibilidade. Organização sem coordenadas não aparece no mapa. O DETRAN não tem endereço cadastrado, então escolhe o município a cada registro.

### M.1 Verificação da localização do dispositivo

Camada adicional de rastreabilidade no registro de eventos. Não é prova de presença física.

**Onde se aplica.** Em todo evento registrado pela tela "Novo registro" (`registrarEvento` do contrato), para qualquer tipo de organização. Não se aplica ao cadastro de veículo nem à correção, que são atos do DETRAN.

**Captura.** Ao clicar em "Revisar registro", o navegador pede a posição uma única vez (`navigator.geolocation.getCurrentPosition`, alta precisão, espera de 15 s, sem cache). São capturados latitude, longitude, precisão em metros (`accuracy`) e a data e hora da captura. Altitude, velocidade e direção não são coletadas. Não há acompanhamento contínuo. O texto da interface fala em "localização do dispositivo", sem afirmar que veio de GPS.

**Decisão.** Quem decide a situação é o servidor (`servidor/servicos/localizacao.js`), duas vezes: antes da assinatura (`eventos/conferir`) e depois da transação (`eventos`), quando grava. Ele valida o formato, recusa captura com mais de 30 minutos ou no futuro, e recalcula a distância com as coordenadas da organização que estão no banco. Situação e distância enviadas pelo navegador são ignoradas.

**Cálculo.** Fórmula de Haversine, com raio da Terra de 6.371 km, implementada em `src/lib/localizacao.js`, sem biblioteca nova.

**Constantes** (em `src/lib/localizacao.js`):

| Constante | Valor | Por quê |
|---|---|---|
| `TOLERANCIA_DA_ORGANIZACAO_METROS` | 300 m | cobre o porte de um estabelecimento (pátio, galpão) e o erro da geocodificação do endereço |
| `PRECISAO_MAXIMA_METROS` | 500 m | acima disso a posição não permite concluir nada; redes sem GPS costumam passar desse valor |
| `VALIDADE_DA_CAPTURA_MS` | 30 min | idade máxima da captura em relação ao registro, no servidor |
| `CAPTURA_RECENTE_MS` | 20 min | idade a partir da qual a tela pede nova revisão antes de assinar |
| `JUSTIFICATIVA_MINIMA` / `MAXIMA` | 10 / 500 caracteres | tamanho da justificativa |

**Situações.**

| Situação | Quando | Justificativa |
|---|---|---|
| `VERIFICADA` | precisão até 500 m e distância até 300 m + precisão | não |
| `FORA_DA_AREA` | precisão até 500 m e distância maior que 300 m + precisão | obrigatória |
| `BAIXA_PRECISAO` | precisão pior que 500 m, qualquer que seja a distância | obrigatória |
| `INDISPONIVEL` | posição não obtida: permissão negada, navegador sem suporte, tempo esgotado, posição indisponível ou erro | obrigatória |
| `SEM_REFERENCIA` | a organização não tem coordenadas cadastradas (caso do DETRAN) | não |

A precisão entra como margem: o ponto real pode estar até `precisão` metros mais perto do que o informado. Baixa precisão não é tratada como irregularidade: é uma situação própria, que só diz que não foi possível concluir.

**Comportamento na tela.**

- *Compatível:* segue para a revisão, que mostra "Localização compatível com a organização" e a distância.
- *Distante:* o registro não é bloqueado. Aparece o aviso "A localização atual está distante do endereço cadastrado da organização", com organização, município cadastrado, local detectado, distância aproximada e precisão, e um campo de justificativa obrigatório.
- *Permissão negada, sem suporte, tempo esgotado, indisponível ou erro:* a tela não trava. Mostra "Não foi possível verificar sua localização", o motivo, e exige a justificativa. Negar a permissão não contorna a verificação em silêncio: o registro fica marcado como não verificado, com motivo e justificativa.
- *Baixa precisão:* aviso próprio e justificativa obrigatória.
- *Organização sem coordenadas:* segue sem justificativa; a posição capturada é guardada assim mesmo.

A justificativa é texto livre, de 10 a 500 caracteres. Sem ela, o servidor recusa na conferência (antes da assinatura) e de novo na gravação.

**Município.** Quando há posição, a tela consulta o Nominatim para descobrir a cidade e, se for diferente da escolhida no formulário, sugere a troca. Só vai ao serviço a posição arredondada a duas casas decimais (cerca de 1 km). Se o serviço falhar ou a cidade não for reconhecida, nada é sugerido. O município gravado em cadeia continua sendo o escolhido por quem registra.

**Quem vê o quê.**

| Quem | O que vê |
|---|---|
| Público | só o indicador "Localização verificada no momento do registro", nos eventos com situação `VERIFICADA` |
| Funcionário e administrador da organização | a situação da localização dos registros da própria organização |
| DETRAN | tudo: organização, endereço e coordenadas cadastrados, posição capturada, precisão, distância, data e hora da captura, situação, motivo e justificativa; filtros "Localização divergente" e "Localização não verificada" |

A decisão de não mostrar ao público que um registro foi feito fora do local cadastrado é deliberada: atendimento externo é legítimo, e a marca pública sugeriria irregularidade sem contexto.

**Limitações.**

- A posição informada pelo navegador pode ser imprecisa e, em dispositivo comprometido ou ambiente controlado, pode ser forjada. O servidor recebe as coordenadas do navegador e não tem como atestar sua origem.
- A referência é o endereço cadastrado, cuja posição depende da geocodificação ou do clique no mapa feitos no cadastro.
- O servidor não confere o município contra as coordenadas.
- Para o DETRAN, sem coordenadas cadastradas, a verificação sempre resulta em `SEM_REFERENCIA`.
- A consulta de cidade envia a posição aproximada a um serviço de terceiros (Nominatim).
- A captura acontece na conferência e vale por 30 minutos no servidor. A tela exige nova revisão se a captura tiver mais de 20 minutos na hora de assinar (`CAPTURA_RECENTE_MS`); ainda assim, se a transação demorar a confirmar além do prazo, o evento fica em cadeia sem complemento.

A verificação deve ser lida junto das outras camadas: credenciamento da organização, vínculo do funcionário, carteira responsável, data e hora, município, evidências, auditoria e blockchain.

---

## N. Árvore do projeto

```
contratos/
  contracts/KmChainRegistryV2.sol     contrato atual
  contracts/KmChainRegistry.sol       primeira versão (v1), preservada; não é usada pela aplicação
  contracts/test/                     conta inteligente de teste
  scripts/                            deploy, credenciar, medirGas, checar
  test/                               testes dos dois contratos
web/
  api/index.js                        única Serverless Function
  vercel.json                         encaminha /api/* para ela
  servidor/
    rotas.js                          tabela de rotas e despacho
    controladores/                    entrada e saída de cada rota
    servicos/                         regras de negócio
    repositorios/                     consultas SQL
    nucleo/                           banco, contrato, sessão, cifra, erros HTTP
  src/
    componentes/                      telas (correcoes/, organizacoes/)
    ui/                               componentes de interface
    lib/                              chamadas de API, contrato e regras compartilhadas
    dados/                            marcas.json, municipios.json
  test/                               testes das rotas
docs/
```

---

## O. Backend

| Módulo | Responsabilidade |
|---|---|
| `rotas.js` | liga método e caminho ao controlador; trata erros |
| `controladores/auth.js` | criar conta, entrar, sessão, sair, vincular carteira |
| `controladores/organizacoes.js` | organizações, contas e equipe |
| `controladores/eventos.js` | eventos e correções |
| `controladores/veiculo.js` | identificação pública, conferência do cadastro, dados complementares, alterações, auditoria |
| `controladores/marcas.js`, `upload.js`, `documento.js` | marcas e comprovantes |
| `servicos/autorizacao.js` | camadas de acesso e validação de vínculo e de tipo de evento |
| `servicos/organizacoes.js` | cadastro, confirmação do credenciamento, espelho do contrato |
| `servicos/funcionarios.js` | espelho do vínculo e listagem da equipe |
| `servicos/eventos.js` | conferência prévia e gravação do complemento |
| `servicos/localizacao.js` | valida a posição enviada, decide a situação e exige a justificativa |
| `servicos/correcoes.js` | solicitação, detalhe, rejeição e aprovação |
| `servicos/cadastroVeiculo.js`, `veiculos.js`, `marcas.js` | veículo e marcas |
| `servicos/auditoria.js` | registrar e listar |
| `repositorios/*` | SQL de organizações, membros, eventos e correções |
| `nucleo/cadeia.js` | provedor, contratos, recibo da transação, assinatura |
| `nucleo/banco.js`, `sessao.js`, `cripto.js`, `http.js` | infraestrutura |

Validadores compartilhados com a tela ficam em `web/src/lib` (`validar.js`, `veiculo.js`, `organizacao.js`, `chassi.js`, `eventos.js`, `municipios.js`). Não há pasta de middlewares: as rotas não são Express, e a autorização é chamada por cada controlador.

---

## P. Frontend

| Módulo | Responsabilidade |
|---|---|
| `lib/acesso.js` | hook com sessão, carteira e vínculo |
| `lib/blockchain.js` | contratos de leitura e escrita, vínculo da carteira |
| `lib/historico.js` | junta os eventos dos dois contratos num formato único |
| `lib/eventos.js` | catálogo de tipos de organização e de evento |
| `lib/organizacoes.js`, `correcoes.js`, `registros.js`, `auth.js`, `marcas.js`, `documentos.js`, `identificacao.js` | chamadas de API e transações |
| `lib/municipios.js`, `useMunicipios.js`, `geocodificacao.js` | municípios, endereço, captura da localização do dispositivo e cidade de uma posição |
| `lib/localizacao.js` | constantes de tolerância, distância (Haversine), situações e rótulos; usado também pelo servidor |
| `lib/api.js`, `erros.js`, `formato.js`, `rota.js`, `toast.js`, `mensagens.js` | apoio |
| `componentes/` | telas (seção D) |
| `ui/` | `Campo`, `Botao`, `Tabela`, `Dialogo`, `Aviso`, `Pagina`, `Transacao`, `SeletorMarca`, `SeletorMunicipio`, `Mapa`, `Icone`, `Copiar`, `Toasts` |

Não há contexts: o estado de acesso é passado por propriedades a partir do `Painel`.

---

## Q. Endpoints

Todos sob `/api`. "Membro" = sessão + carteira vinculada + vínculo ativo em organização ativa.

| Método e caminho | Finalidade | Exige | Entrada | Resultado |
|---|---|---|---|---|
| POST `auth/cadastrar` | criar conta | — | nome, email, senha | usuário e sessão |
| POST `auth/entrar` | login | — | email, senha | usuário e sessão |
| GET `auth/eu` | sessão atual | — | — | usuário, vínculo, organização |
| DELETE `auth/eu` | sair | — | — | ok |
| POST `auth/vincular-carteira` | vincular carteira | sessão | carteira, assinatura | ok |
| POST `auth/pendentes` | listar contas | DETRAN + assinatura | assinatura | contas |
| POST `contas/localizar` | achar conta por e-mail | DETRAN ou administrador | email | nome, email, carteira |
| POST `contas/carteira` | informar ou trocar a carteira de uma conta | DETRAN | email, carteira | nome, email, carteira |
| GET `organizacoes` | lista pública | — | — | nome, tipo, endereço, coordenadas, situação, nomes datados |
| POST `organizacoes` | cadastrar | DETRAN | cadastro + e-mail do administrador e, opcionalmente, a carteira dele | organização e dados para assinar |
| PATCH `organizacoes` | alterar cadastro | DETRAN | id + cadastro | organização |
| GET `organizacoes/gestao` | lista completa | DETRAN | — | organizações |
| POST `organizacoes/credenciamento` | confirmar credenciamento | DETRAN | id, txHash | organização |
| POST `organizacoes/sincronizar` | espelhar situação e administrador | DETRAN | id | organização |
| GET `funcionarios` | equipe | administrador (própria) ou DETRAN | `?organizacao=` | funcionários |
| POST `funcionarios/sincronizar` | espelhar vínculo | administrador | carteira | funcionário |
| POST `eventos/conferir` | validar antes de assinar, incluindo a localização | membro | chassi, tipo, km, data, município, complemento, `localizacao` (latitude, longitude, precisao, capturadaEm, ou motivo), `justificativaLocalizacao` | ok e a situação e a distância decididas pelo servidor; 400 se faltar a justificativa |
| POST `eventos` | gravar complemento e a verificação de localização | membro | chassi, txHash, complemento, `localizacao`, `justificativaLocalizacao` | ok, índice |
| GET `eventos` | registros | membro | `?organizacao=` e `?localizacao=divergente\|nao_verificada` (só DETRAN) | eventos com a situação da localização; para o DETRAN, também coordenadas, precisão, distância, motivo, justificativa e endereço da organização |
| GET `correcoes` | listar ou detalhar | membro | `?id=`, `?situacao=` | solicitações |
| POST `correcoes` | solicitar | oficina, vistoria, seguradora | chassi, índice, km, justificativa, evidência | solicitação |
| PATCH `correcoes` | aprovar ou rejeitar | DETRAN | id, decisão, motivo, txHash | solicitação |
| GET `veiculo` | identificação pública | — | `?chassi=` | veículo e, por evento, a transação e `localizacao_verificada` (verdadeiro ou falso) |
| POST `veiculo` | conferir cadastro | DETRAN | cadastro | ok, chave |
| POST `veiculo/dados-complementares` | consultar | DETRAN + assinatura | chassi | identificação, datados, registros |
| POST `veiculo/alteracoes` | alterar ou completar | DETRAN + assinatura | chassi, campo, valores | ok |
| GET `marcas` | lista | — | — | marcas |
| POST `marcas` | propor | DETRAN | nome | marca pendente |
| PATCH `marcas` | revisar | administrador do DETRAN | id, decisão | marca |
| POST `upload` | enviar comprovante | membro | arquivo em base64, chassi, hash | hash |
| POST `documento` | pedir link | membro + assinatura | hash | link de uso único |
| GET `documento` | abrir | sessão + token | `?t=` | arquivo |
| GET `auditoria` | trilha | DETRAN | `?acao=` | registros |

---

## R. Fluxos

**1. Credenciamento.** DETRAN preenche o cadastro → servidor valida e grava como pendente → DETRAN assina `credenciarOrganizacao` → servidor confere a transação, grava o id em cadeia, ativa a organização e registra a auditoria.

**2. Administrador.** A pessoa cria a conta e vincula a carteira → o DETRAN informa o e-mail dela no cadastro da organização → o credenciamento a vincula no contrato. Troca: DETRAN informa o e-mail do novo → assina `definirAdministrador` → servidor espelha.

**3. Funcionário.** A pessoa cria a conta e vincula a carteira → o administrador informa o e-mail → assina `definirFuncionario` → servidor espelha em `membros` e audita.

**4 e 5. Evento.** Funcionário informa chassi, tipo, km, data e local → ao revisar, o navegador captura a localização do dispositivo → servidor confere permissão e dados, calcula a distância até a organização e decide a situação → se a situação exigir, a tela pede a justificativa e a conferência é refeita → envio do comprovante (opcional) → carteira assina `registrarEvento`, com o código IBGE do município → contrato confere vínculo, tipo, km e data → confirmada, a tela envia o hash da transação, a localização e a justificativa → servidor lê o evento no contrato, recalcula a verificação e grava o complemento.

**6. Consulta institucional.** Mesma tela da pública, com botão para abrir comprovantes.

**7. Solicitação de correção.** Seção K.

**8, 9 e 10. Análise, aprovação e rejeição.** Seção K.

**11. Consulta pública.** Seção L.

**12. Cadastro de veículo.** DETRAN preenche identificação, primeiro registro e proprietário → servidor confere → assina `cadastrarVeiculo` → servidor grava identificação, placa, UF e proprietário datados.

**13. Preparação da demonstração.** Seção Z e `docs/AMBIENTE.md`.

**14. Comprovante.** Envio: servidor detecta o tipo pelo conteúdo, confere o hash, cifra com AES-256-GCM e envia ao IPFS. Abertura: assinatura → link de uso único de 60 segundos → servidor baixa, decifra e confere o hash.

**15. Falha depois da transação.** Se o servidor não gravar o complemento, a tela mostra "Dados complementares pendentes" e permite reenviar a mesma transação.

---

## S. Matriz de permissões

✓ pode · ✗ não pode · A = só o administrador da organização

| Ação | DETRAN | Oficina | Vistoria | Seguradora | Público |
|---|---|---|---|---|---|
| Consultar histórico e mapa | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cadastrar e credenciar organização | ✓ | ✗ | ✗ | ✗ | ✗ |
| Suspender e reativar organização | ✓ | ✗ | ✗ | ✗ | ✗ |
| Trocar administrador | ✓ | ✗ | ✗ | ✗ | ✗ |
| Informar ou trocar a carteira de outra conta | ✓ | ✗ | ✗ | ✗ | ✗ |
| Vincular e desativar funcionário da própria organização | A | A | A | A | ✗ |
| Ver equipe da própria organização | A | A | A | A | ✗ |
| Ver equipe de outra organização | ✓ | ✗ | ✗ | ✗ | ✗ |
| Cadastrar veículo | ✓ | ✗ | ✗ | ✗ | ✗ |
| Registrar evento institucional (2, 3) | ✓ | ✗ | ✗ | ✗ | ✗ |
| Registrar evento de oficina (10–15) | ✗ | ✓ | ✗ | ✗ | ✗ |
| Registrar evento de vistoria (20–25) | ✗ | ✗ | ✓ | ✗ | ✗ |
| Registrar evento securitário (30–32) | ✗ | ✗ | ✗ | ✓ | ✗ |
| Solicitar correção | ✗ | ✓ | ✓ | ✓ | ✗ |
| Aprovar, rejeitar e corrigir de ofício | ✓ | ✗ | ✗ | ✗ | ✗ |
| Ver solicitações | todas | próprias | próprias | próprias | ✗ |
| Ver registros | todos | próprios | próprios | próprios | ✗ |
| Ver a situação da localização dos registros | todos | próprios | próprios | próprios | só "verificada" |
| Ver coordenadas, distância e justificativa de localização | ✓ | ✗ | ✗ | ✗ | ✗ |
| Dados complementares e alterações do veículo | ✓ | ✗ | ✗ | ✗ | ✗ |
| Abrir comprovante | qualquer | os da própria conta | os da própria conta | os da própria conta | ✗ |
| Propor marca | ✓ | ✗ | ✗ | ✗ | ✗ |
| Aprovar marca | A | ✗ | ✗ | ✗ | ✗ |
| Lista de contas e auditoria | ✓ | ✗ | ✗ | ✗ | ✗ |

O DETRAN não abre solicitação porque corrige de ofício.

---

## T. On-chain × off-chain

| Dado | On-chain | Off-chain | Observação |
|---|---|---|---|
| Chassi | não (só a chave `keccak256`) | sim | o chassi em texto nunca é enviado ao contrato |
| Quilometragem | sim | sim (espelho) | |
| Tipo do evento | sim (código) | sim (código e rótulo) | |
| Data e hora do evento | sim | sim (espelho) | informada por quem registra |
| Data e hora da transação | sim (bloco) | sim (espelho) | |
| Município do evento | sim (código IBGE) | sim (espelho) | nome resolvido na tela |
| Latitude e longitude do dispositivo no registro | não | sim | só o DETRAN vê |
| Precisão e data e hora da captura | não | sim | só o DETRAN vê |
| Distância até a organização | não | sim | calculada pelo servidor |
| Situação da verificação de localização | não | sim | ao público, só o indicador de "verificada" |
| Motivo de a localização não ter sido obtida | não | sim | informado pelo navegador |
| Justificativa de registro fora do local ou sem localização | não | sim | só o DETRAN vê |
| Organização responsável | sim (id) | sim (cadastro) | |
| Tipo, situação e administrador da organização | sim | sim (espelho) | |
| Nome, CNPJ, contato e endereço da organização | não | sim | nomes com histórico datado |
| Coordenadas da organização | não | sim | |
| Usuário responsável | sim (carteira) | sim (nome e e-mail) | |
| Vínculo carteira–organização | sim | sim (espelho) | |
| Vínculo carteira–conta | não | sim | |
| Referência da correção | sim | sim (espelho) | |
| Hash do comprovante | sim | sim | |
| Comprovante | não | IPFS, cifrado | |
| Marca de avanço atípico | sim | não | |
| Marca, modelo, anos | não | sim | |
| Placa e UF | não | sim, datadas | |
| Proprietário (nome e CPF) | não | sim, datado | só o DETRAN vê |
| Seguradora contratante | não | sim | |
| Justificativa e motivo de decisão | não | sim | |
| Solicitações de correção | não | sim | a aprovada gera evento em cadeia |
| Auditoria | não | sim | credenciamento e vínculos também geram logs no contrato |
| Hash da transação | — | sim | exposto na consulta pública |

---

## U. Segurança

**Mecanismos:**

- senha com bcrypt; cookie de sessão `HttpOnly` assinado;
- autorização no servidor em toda rota protegida, com o vínculo lido do contrato a cada requisição;
- o contrato repete as regras: vínculo ativo, organização ativa, tipo de evento por tipo de organização, funções exclusivas do DETRAN;
- o administrador só alcança carteiras da própria organização, no servidor e no contrato;
- dados do evento lidos do contrato, nunca aceitos do navegador;
- autoria pelo `responsavel` gravado pelo contrato, o que cobre contas inteligentes;
- idempotência por hash de transação;
- solicitações de correção visíveis só à organização que abriu e ao DETRAN;
- comprovantes: tipo pelo conteúdo, limite de 3 MB, cifra AES-256-GCM, link de uso único, limite de 30 pedidos em 10 minutos, trilha de acessos;
- erros sem detalhe interno;
- auditoria das ações administrativas;
- verificação de localização decidida pelo servidor: distância recalculada com as coordenadas do banco, situação e distância do navegador ignoradas, captura antiga recusada, justificativa obrigatória quando a localização não é compatível ou não foi obtida;
- coordenadas do dispositivo restritas ao DETRAN, fora da consulta pública e fora da blockchain.

**Limitações conhecidas:**

- a quilometragem, a data e o município são declarados; nada garante que são verdadeiros;
- a localização do dispositivo é informada pelo navegador e pode ser imprecisa ou forjada; a verificação é um indício, não uma prova de presença;
- a organização do evento é a do vínculo de quem assina; a pessoa por trás da carteira não é verificada;
- o banco é um espelho: uma alteração direta no banco mudaria nomes e complementos, não os eventos em cadeia;
- se a tela fechar entre a transação e o envio ao servidor, o evento fica em cadeia sem complemento; a tela oferece reenvio, mas não há reconciliação automática;
- a carteira informada pelo DETRAN para uma conta não é provada por assinatura da pessoa: é um atestado do DETRAN, registrado na auditoria. Nas rotas que não pedem assinatura na hora, a conta passa a agir pelo vínculo dessa carteira;
- sem limite de tentativas de login e sem revogação de sessão;
- listas de equipe, registros, auditoria e gestão não pedem assinatura na hora;
- a lista pública expõe o endereço das organizações;
- o IPFS é público e permanente; o arquivo cifrado não pode ser apagado com garantia;
- o dígito verificador do chassi não é conferido;
- conformidade com a LGPD não foi avaliada.

---

## V. Não implementado

| Item | Motivo |
|---|---|
| Teste dos fluxos em navegador | exigem MetaMask; não foram exercitados |
| Hash separado do usuário em cadeia | a carteira que assina já identifica o usuário e é provada por assinatura |
| Organização solicitante e seguradora contratante em cadeia | mantidas no banco para não ampliar o contrato |
| Etapas separadas "aprovar" e "efetivar" | a aprovação só é gravada quando a correção está em cadeia |
| Mapa dos locais dos eventos de um veículo | existe a lista cronológica |
| Conferência, no servidor, do município contra as coordenadas | exigiria base de limites municipais ou serviço externo no servidor; a tela só sugere a cidade |
| Verificação de localização no cadastro e na correção | atos do DETRAN, que não tem coordenadas cadastradas |
| Mapa com a posição capturada, na visão do DETRAN | os detalhes aparecem em texto |
| Registro das localizações divergentes na tabela `auditoria` | ficam no próprio evento e são filtradas na tela Registros |
| Geocodificação no servidor | feita no navegador, opcional |
| Login ou cadastro de usuário público | fora do escopo, conforme pedido |
| Integração com sistemas de órgãos públicos | fora do escopo, conforme pedido |
| Excluir organização pendente; trocar administrador indicado antes do credenciamento | não implementado |
| Leitura dos registros da v1 pela aplicação | removida de propósito: o protótipo final opera só com a v2; os registros antigos continuam na Sepolia, fora da aplicação |
| Histórico de alterações de endereço da organização | só o nome é datado |
| Verificação de tipos (TypeScript) | o projeto é JavaScript |
| Atualização de `docs/DOCUMENTACAO.txt` e `docs/REVISAO_TECNICA.md` | descrevem o estado anterior; levam aviso no topo |

**Divergências em relação ao pedido:**

- o texto apontado como incorreto ("marca, modelo e ano-modelo gravados em cadeia") era verdadeiro para a v1; passou a ser falso com a v2, e foi corrigido;
- nomes de tipos em português;
- a ordem de execução antecipou o contrato, do qual as demais etapas dependiam.

---

## W. Melhorias futuras

- Reconciliação automática entre eventos em cadeia e complementos no banco.
- Limite de tentativas de login e revogação de sessão.
- Compromisso com sal para o hash do comprovante.
- Mapa dos locais dos eventos na consulta.
- Convite de funcionário por e-mail, em vez de exigir conta prévia.
- Catálogo de modelos por marca.
- Avaliação jurídica de proteção de dados.

---

## X. Estado final

| Item | Resultado |
|---|---|
| Build do frontend (`npm run build`) | concluído; aviso de um bloco acima de 500 kB (já existia) |
| Build do backend | não há etapa de build (funções Node) |
| Cenário de demonstração (`npm run demo:preparar`) | criado por completo no ambiente local e na Sepolia: 3 organizações, 8 contas, 4 veículos, 15 eventos; banco e contrato conferidos |
| Testes do contrato (`npx hardhat test`) | 49 passando (25 do contrato atual; 24 da v1, mantidos como histórico) |
| Testes das rotas (`npm test`) | 98 passando (11 da verificação de localização, 3 da carteira informada pelo DETRAN) |
| Lint (`npx oxlint`) | sem apontamentos |
| TypeScript | não se aplica |
| Erros conhecidos | nenhum nos testes; telas ainda não exercitadas em navegador com MetaMask |

**Testes da verificação de localização** (em `web/test/api.test.mjs`): dentro da tolerância, com a precisão como margem; fora sem justificativa, recusado antes e depois da assinatura; fora com justificativa; indisponível sem e com justificativa, com o motivo gravado; baixa precisão; organização sem coordenadas; situação e distância forjadas pelo navegador; posição malformada ou antiga; consulta pública sem coordenadas; detalhes e filtros do DETRAN; organização comum sem acesso a coordenadas.

**Migrações.** A do banco é automática na primeira requisição: renomeia `registros_privados` para `eventos`, cria as tabelas novas, a linha do DETRAN e as oito colunas `localizacao_*`. É aditiva; não apaga dados. O contrato já está implantado; um novo deploy (`npx hardhat run scripts/deploy.js --network sepolia`) regrava o endereço e a ABI em `web/src/lib` e exige banco limpo.

**Atenção ao publicar.** O `npm run dev` usa o banco real do `.env.local` e dispara a migração. Antes de publicar esta versão no site, limpe o banco: os dados antigos não correspondem ao contrato novo.

**Variáveis de ambiente.** As mesmas de antes. Para os scripts de demonstração: `DEMO_SENHA` (senha das contas fictícias; obrigatória fora do ambiente local), `DEMO_URL`, `DEMO_RPC_URL`, `KMCHAIN_PERMITIR_RESET`.

**Dependência nova.** `leaflet` 1.9.4.

**Arquivos novos de configuração.** `web/vercel.json`.

---

## Z. Cenário de demonstração do TCC

Definido em `web/demo/cenario.mjs` e criado por `npm run demo:preparar`. Todos os dados são fictícios: nomes, CNPJ, CPF, chassis e placas foram montados para passar nas validações e não se referem a empresa, pessoa ou veículo existente.

**Como é criado.** O script faz o que uma pessoa faria pela tela: chama as rotas `/api` e assina cada transação no contrato com a carteira da conta responsável. Nada é escrito direto no banco e nenhum evento existe só no banco. O script simula duas coisas: a posição do dispositivo em cada registro e as datas dos eventos.

**Datas e quilometragens.** O contrato só aceita evento ocorrido nos últimos 30 dias e marca como atípico o avanço acima de 1.000 km por dia. Por isso os históricos cabem em quatro semanas, com avanços modestos, em vez de se estenderem por meses.

### Organizações

| Organização | Tipo | Cidade | Administrador | Funcionário |
|---|---|---|---|---|
| DETRAN | DETRAN | sem endereço cadastrado | Administração DETRAN (demonstração) | Agente DETRAN (demonstração) |
| Oficina KM Teste | OFICINA | Cachoeiro de Itapemirim - ES | Gerente da Oficina KM Teste | Mecânico da Oficina KM Teste |
| Vistoria KM Teste | VISTORIA | Vitória - ES | Gerente da Vistoria KM Teste | Vistoriador da Vistoria KM Teste |
| Seguradora KM Teste | SEGURADORA | Vila Velha - ES | Gerente da Seguradora KM Teste | Analista da Seguradora KM Teste |

As oito contas usam e-mails do domínio definido em `web/demo/cenario.mjs` e a senha de `DEMO_SENHA`. As contas criadas na Sepolia em 04/10/2026 usam `@demo.kmchain.test`; o domínio do arquivo foi alterado depois para `@exemplo.com` e vale para as próximas criações. Cada conta tem uma carteira: no ambiente local, as contas de teste do Hardhat; na Sepolia, as de `web/demo/carteiras.local`, criadas por `npm run demo:carteiras` (a do administrador do DETRAN é a que implanta o contrato).

### Veículos

| Veículo | Chassi | Sequência | O que demonstra |
|---|---|---|---|
| A · Fiat Argo | `9KMDEM00000000001` | cadastro 45.000 → revisão 45.820 → manutenção 46.910 → vistoria de transferência 47.640 → vistoria prévia de seguro 48.215 | histórico normal, com os quatro atores e três cidades |
| B · Volkswagen Gol | `9KMDEM00000000002` | cadastro 82.300 → vistoria cautelar 83.150 → revisão 838.900 (erro de digitação, atípico) → correção 83.890 | solicitação com vistoria como evidência, aprovação pelo DETRAN, original preservado |
| C · Chevrolet Onix | `9KMDEM00000000003` | cadastro 12.400 → reparo 12.950 em Vargem Alta, a cerca de 22 km da oficina, com justificativa → troca de componentes 13.020 sem localização, com justificativa | registro fora do local, localização não obtida, auditoria do DETRAN |
| D · Toyota Corolla | `9KMDEM00000000004` | cadastro 30.100 → vistoria a pedido de seguradora 30.640 → revisão 31.900; solicitação de correção **em análise** | seguradora contratante; análise ao vivo (aprovar ou rejeitar) |

### O que fica onde

- **Na blockchain:** as 3 organizações credenciadas e os 8 vínculos; 15 eventos (4 cadastros, 10 registros e 1 correção), cada um com quilometragem, tipo, data, município, organização e carteira.
- **No banco:** contas, cadastro e endereço das organizações, identificação e proprietário fictício de cada veículo, quem registrou cada evento, a verificação de localização (posição simulada, distância, situação e justificativa), as duas solicitações de correção e a auditoria.

### O que depende de MetaMask

O script assina com as chaves das carteiras de demonstração, sem MetaMask. Na apresentação, toda ação de escrita feita pela tela pede a MetaMask com a carteira da conta logada: credenciar, suspender, trocar administrador, vincular funcionário, cadastrar veículo, registrar evento, aprovar correção. Assinam uma mensagem, sem transação: vincular a carteira à conta, abrir comprovante, consultar dados complementares e a lista de contas. Rejeitar correção, solicitar correção e todas as consultas não pedem assinatura.

---

## Y. Resumo para a documentação do TCC

O KMChain é um protótipo de registro de eventos com quilometragem veicular sobre uma blockchain pública compatível com Ethereum. Cada evento é gravado por um contrato inteligente e contém a chave do veículo, derivada do chassi por função de hash, a quilometragem, o tipo do evento, a data e hora em que o evento ocorreu, a data e hora do bloco, o código IBGE do município, o identificador da organização responsável, o endereço da carteira que assinou e, quando há comprovante, o hash SHA-256 do documento.

O contrato mantém também o cadastro mínimo das organizações: identificador sequencial, tipo, situação e administrador, além do vínculo de cada carteira com uma organização. O DETRAN, modelado como a primeira organização do contrato, credencia oficinas, empresas de vistoria e seguradoras, suspende e reativa organizações e define seus administradores. O administrador vincula e desativa os funcionários. O contrato só aceita um registro de quem tem vínculo ativo em organização ativa, e apenas para os tipos de evento permitidos ao tipo da organização, segundo uma matriz mantida em cadeia. A organização registrada em cada evento é obtida do vínculo de quem assina, e não de um parâmetro informado.

Dados cadastrais e pessoais permanecem fora da blockchain, em um banco relacional: contas, nomes e endereços das organizações, identificação do veículo, placa, unidade federativa e proprietário com histórico datado, o nome de quem realizou cada registro, as solicitações de correção e a trilha de auditoria administrativa. Os comprovantes são cifrados e armazenados em IPFS, e apenas seu hash é gravado em cadeia.

As transações são assinadas pela carteira do próprio usuário. O servidor não assina transações; ele verifica previamente as permissões, lendo no contrato o vínculo da carteira associada à conta, e, após a confirmação, lê o evento no contrato para gravar os dados complementares. As mesmas regras de permissão são aplicadas no servidor e no contrato.

No registro de um evento, o sistema solicita ao navegador a localização do dispositivo, uma única vez, e a compara com o endereço cadastrado da organização. A distância é calculada pelo servidor com a fórmula de Haversine. Considera-se compatível a posição a até 300 metros do endereço, acrescidos da precisão informada pelo dispositivo; posições com precisão pior que 500 metros são classificadas como de baixa precisão, sem conclusão sobre a distância. Quando a posição é distante, imprecisa ou não pôde ser obtida, o registro não é bloqueado, mas exige justificativa. As coordenadas, a precisão, a distância, a situação e a justificativa são armazenadas apenas no banco e consultadas pelo DETRAN; na blockchain permanece somente o código do município. Esse mecanismo amplia a rastreabilidade do registro, mas não constitui prova de presença física, pois a posição informada pelo dispositivo pode ser imprecisa ou manipulada.

A correção de uma quilometragem não altera o registro original. Organizações credenciadas abrem uma solicitação com o valor proposto, a justificativa e a evidência, que pode ser um documento ou uma vistoria já registrada. O DETRAN analisa. A rejeição é registrada apenas no banco. A aprovação consiste em um novo evento de correção, com data, local e responsável próprios, que referencia o evento original; o contrato mantém um índice separado que liga o evento corrigido à sua correção.

A consulta pública dispensa cadastro. O navegador lê os eventos diretamente do contrato e obtém do servidor a identificação do veículo e o nome das organizações. São exibidos, para cada evento, o tipo, a quilometragem, a data e hora, o município, a organização responsável e, quando for o caso, a indicação de que a localização foi verificada no registro. Dados do proprietário e dos funcionários e as coordenadas dos dispositivos não são expostos. As organizações credenciadas podem ser visualizadas em um mapa a partir do endereço cadastrado.

A primeira versão do contrato permanece no repositório como registro da evolução do projeto; a aplicação opera exclusivamente com a versão descrita aqui.

O protótipo assegura a integridade e a ordem dos registros após sua inserção e a identificação da organização e da carteira responsáveis. Não assegura a veracidade da quilometragem, da data ou do local informados, tampouco a presença física no local, nem a identidade da pessoa que controla a carteira. A confiabilidade da entrada depende do credenciamento, do vínculo institucional, das permissões por tipo de organização, da verificação de localização, das evidências anexadas e da análise do DETRAN nas correções. O uso do nome DETRAN é ilustrativo e não indica vínculo com órgão público.

A verificação automatizada compreende 49 testes do contrato e 98 testes de integração das rotas do servidor, executados em rede local. O contrato está implantado na rede de testes Sepolia; os fluxos de interface ainda não foram exercitados em navegador.
