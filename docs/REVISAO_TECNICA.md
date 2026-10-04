> **Documento histórico.** Descreve o sistema em 27/09/2026, com o contrato v1 e a proposta de v2 daquela data. O estado atual está em [INVENTARIO_FUNCIONAL.md](INVENTARIO_FUNCIONAL.md).

# KmChain: revisão técnica, funcional, de privacidade e acadêmica

Estado em 27/09/2026. Contrato em uso: `KmChainRegistry` (v1) na Sepolia, `0x8BcAB5232FFa571B802ac444E5Aba43f7333c49C`.
Nada desta revisão foi implantado: não houve deploy do site, do contrato nem migração do banco.

Cada afirmação vem marcada com a sua natureza:

| Marca | Significado |
|---|---|
| **[C]** | Comportamento comprovado (teste automatizado ou chamada real, com resultado registrado) |
| **[D]** | Defeito reproduzido (a falha foi provocada e observada) |
| **[R]** | Risco identificado por inspeção do código (não provocado) |
| **[A]** | Decisão de arquitetura proposta |
| **[L]** | Limitação que continua existindo no protótipo |

---

## 1. "Não foi possível carregar as contas": causa verificada

**[D] Causa.** `web/api/auth/pendentes.js` importa `web/api/_chain.js`. Até o commit `553241b`, esse arquivo importava `KmChainRegistry.abi.json` e `endereco.json` sem `with { type: "json" }` e com importação nomeada de JSON, que o Node não aceita. A rota nem chegava a carregar.
- Reprodução: carregar a versão de `553241b` falha com `ERR_IMPORT_ATTRIBUTE_MISSING`.
- No `vercel dev`, a falha derrubava o servidor inteiro. O log do servidor que caiu mostra o mesmo erro.
- O navegador recebia uma falha de rede, que `contasPendentes()` convertia em "Não foi possível carregar as contas."
- Correção: commit `95600ea`, já publicado.
- No site publicado antes dessa data, a falha é provável (mesmo código), mas **não verificada**: os logs da Vercel só guardam o dia corrente.

**[D] Problemas encontrados no mesmo fluxo depois da correção:**
- A rota **não exigia login**. Uma carteira Admin ou DETRAN recebia nome e e-mail de todas as contas sem sessão nenhuma.
- A carteira que assinava não era comparada com a vinculada à conta.
- Assinatura expirada aparecia como "sem credencial".
- Falhas de RPC e de banco devolviam ao navegador a mensagem interna (`connect ECONNREFUSED ...`).

**[C] Situação atual** (testes em `web/test/api.test.mjs`):

| Cenário | Resposta | Mensagem na tela |
|---|---|---|
| Sem sessão | 401 `sem_sessao` | Faça login para continuar. |
| Conta sem carteira vinculada | 403 `carteira_nao_vinculada` | Vincule a carteira da entidade à sua conta... |
| Assinada por carteira diferente da vinculada | 403 `carteira_diferente` | A carteira conectada não é a vinculada... troque de conta na MetaMask |
| Assinatura feita para outra conta (outro e-mail) | 403 `carteira_diferente` | idem |
| Carteira sem papel / oficina | 403 `sem_papel` | A carteira vinculada não tem a função necessária. |
| Assinatura expirada | 400 `assinatura_expirada` | A assinatura expirou. Tente de novo. |
| Assinatura inválida ou ausente | 400 `assinatura_invalida` | Não foi possível validar a assinatura. |
| Assinatura recusada na MetaMask | não chega ao servidor | A assinatura foi cancelada na carteira. |
| RPC fora do ar | 503, sem detalhe interno | Um serviço do sistema está indisponível... |
| Banco fora do ar | 503 `banco_indisponivel`, sem detalhe interno | idem |
| Admin ou DETRAN corretos | 200 com a lista | lista |

---

## 2. Problemas encontrados

| # | Gravidade | Natureza | Problema | Evidência | Situação |
|---|---|---|---|---|---|
| 1 | Alta | [D] | Rota de contas não carregava (import de JSON) | `ERR_IMPORT_ATTRIBUTE_MISSING` com o código de `553241b` | Corrigido (`95600ea`) |
| 2 | Alta | [D] | `/api/auth/pendentes` entregava nome e e-mail de todas as contas sem login | chamada sem cookie devolveu 200 com a lista | Corrigido: login + carteira vinculada assinando + papel |
| 3 | Alta | [D] | **Contrato v1:** qualquer credenciada grava leituras do tipo CADASTRO ou CORRECAO via `registrarLeitura`; a interface as mostrava como "Correção do DETRAN" | teste `LIMITACAO: registrarLeitura aceita os tipos CADASTRO e CORRECAO...` | Interface corrigida (`src/lib/origem.js`); contrato só na proposta v2 |
| 4 | Alta | [R] | `/api/upload` aceitava envio de qualquer pessoa, sem login | leitura do código antigo | Corrigido: login + carteira vinculada com papel |
| 5 | Alta | [R] | `/api/documento` entregava qualquer comprovante a qualquer credenciada, sem sessão e sem regra por documento | leitura do código antigo | Corrigido: política por função e vínculo, link de uso único, auditoria |
| 6 | Alta | [R] | `/api/privado/registrar` confiava em `carteira`, `txHash`, `tipoEvento`, `modelo` e `ano` enviados pelo navegador | leitura do código antigo | Corrigido: tudo conferido na transação; reenvio idempotente |
| 7 | Média | [D] | Mensagens internas (banco, RPC) chegavam ao navegador | `{"erro":"connect ECONNREFUSED 127.0.0.1:1"}` | Corrigido em todas as rotas (`api/_http.js`) |
| 8 | Média | [D] | A **mesma carteira está vinculada a duas contas** no banco real | consulta: `0x3abc…ea0f` aparece 2 vezes | Resolvido em 27/09/2026: desvinculada da conta do Rui, mantida na sua; a rota impede novos casos |
| 9 | Média | [R] | Metadados no Pinata com chassi, tipo e hash; nome do arquivo = hash | leitura do código antigo | Corrigido: nome aleatório, sem metadados |
| 10 | Média | [R] | Interface mostrava a função ATUAL da carteira como se fosse a da época | leitura de `Historico.jsx` | Corrigido: rótulos "função na época" e "função atual" |
| 11 | Média | [R] | Data do bloco apresentada como data da leitura | leitura de `Historico.jsx` | Corrigido: "registrado em cadeia"; data da observação só na v2 |
| 12 | Média | [R] | Painel permitia registrar com carteira não vinculada; o registro privado falharia depois da transação | leitura de `Painel.jsx` + regra nova do servidor | Corrigido: seções de escrita exigem a carteira vinculada |
| 13 | Média | [R] | Correção não gravava registro privado (quem corrigiu se perdia) | leitura de `CorrigirLeitura.jsx` | Corrigido |
| 14 | Média | [R] | Limite de upload de 12 MB no código, mas a Vercel recusa corpos acima de 4,5 MB: PDF grande falhava sem explicação | configuração vs. limite documentado da Vercel | Corrigido: 3 MB, com aviso antes do envio |
| 15 | Baixa | [C] | Telas diziam "o DETRAN define a função"; no contrato só o Admin concede papéis | teste `so o admin concede papeis...` | Textos corrigidos |
| 16 | Baixa | [D] | `npm run dev` não servia as rotas de login e dados privados (404); `vercel dev` não lê `.env.local` | erro `DATABASE_URL não configurada` | `npm run dev` agora serve todas as rotas |
| 17 | Baixa | [D] | Provedor RPC antigo não era encerrado e seguia tentando a rede | processo de teste não terminava | Corrigido (`destroy()`) |
| 18 | Baixa | [R] | Servidor de desenvolvimento servia o código-fonte de `api/_*.js` e respondia 200 a `/.env.local?raw` (conteúdo não verificado) | status HTTP | Bloqueado no `vite.config.js` (404); só afeta `localhost` |
| 19 | Baixa | [C] | `registros_privados` está vazia no banco real: nenhum registro privado foi salvo até hoje | consulta de contagem | Causa não determinada; o fluxo novo foi testado de ponta a ponta com dados fictícios |

---

## 3. Arquivos alterados

**Backend (`web/api`)**
- `_http.js` (novo): erro com código estável; falhas de infraestrutura viram 503; logs sem mensagem nem dados pessoais.
- `_chain.js`: `exigirConta`, `exigirContaComPapel` e `exigirCarteiraAssinada`; papéis calculados localmente; provedor RPC encerrado ao trocar.
- `_db.js`:
  - tabelas `documentos`, `acessos_documentos` e `tokens_documento`;
  - colunas `quilometragem` e `registrado_em_cadeia`;
  - índice único por transação;
  - índice único de carteira (criado só se não houver duplicatas);
  - executor substituível para os testes.
- `_cripto.js`: rotação da `DOCS_KEY` com `DOCS_KEYS_ANTIGAS`.
- `auth/pendentes.js`, `privado/consultar.js`: modelo login + carteira vinculada assinando + papel.
- `auth/vincular-carteira.js`: carteira única por conta; troca de vínculo com nova assinatura.
- `privado/registrar.js`:
  - confere a transação: sucesso, contrato, remetente, evento e chassi;
  - tipo, km, modelo e ano vêm do evento;
  - CPF só em cadastro e transferência; placa só no cadastro;
  - idempotente.
- `upload.js`:
  - exige login e papel;
  - tipo detectado pelo conteúdo (PDF, PNG ou JPEG);
  - limite de 3 MB;
  - sem metadados no Pinata;
  - índice no banco.
- `documento.js`: política de acesso, trilha de auditoria, limite de pedidos, link de uso único de 60 s, resposta sem cache.
- `auth/cadastrar.js`, `auth/entrar.js`, `auth/eu.js`: erros sem detalhe interno.

**Compartilhado (`web/src/lib`)**
- `mensagens.js` (novo): texto de cada assinatura, com o e-mail da sessão.
- `validar.js` (movido de `api/`): CPF com dígitos verificadores, placa e chassi.
- `origem.js` (novo): o que o contrato garante sobre a origem de cada registro.

**Frontend**
- `lib/api.js` (novo): chamada única com mensagens por código.
- `lib/privado.js`, `lib/documentos.js`, `lib/auth.js`, `lib/erros.js`.
- `componentes/PrivadoPendente.jsx` (novo): tentar de novo o registro privado.
- `componentes/Historico.jsx`: função na época × função atual, data em cadeia, registros sem garantia de origem, nota sobre o que o histórico não prova.
- `componentes/RegistroLeitura.jsx`, `CadastroVeiculo.jsx`, `CorrigirLeitura.jsx`: payload mínimo, validação de CPF e placa, nova tentativa.
- `componentes/Painel.jsx`: seções de escrita exigem a carteira vinculada; aviso de carteira diferente.
- `componentes/ConsultaPrivada.jsx`: data em cadeia e km.
- `componentes/CredenciarEntidade.jsx`, `Autenticacao.jsx`, `ConsultaVeiculo.jsx`: textos sobre quem credencia e o que credenciamento significa.
- `ui/Campo.jsx`: valida tipo e tamanho do arquivo ao escolher.
- `vite.config.js`: serve todas as rotas `/api` no `npm run dev` e bloqueia `.env` e `api/_*`.

**Contratos (`contratos/`)**
- `test/KmChainRegistry.test.js`: revogação, só o Admin concede papéis, evidência, correção e três testes `LIMITACAO`.
- `contracts/KmChainRegistryV2.sol` e `test/KmChainRegistryV2.test.js` (novos): **proposta, não implantada**.

**Testes (`web/test`)**
- `ambiente.mjs`: Hardhat local, PGlite e Pinata simulado.
- `api.test.mjs`, `origem.test.mjs`.

---

## 4. Testes executados

| Suíte | Comando | Resultado |
|---|---|---|
| Contrato v1 + proposta v2 | `cd contratos && npx hardhat test` | **38 passando** (atualizado na seção 13) |
| Integração das rotas `/api` | `cd web && npm test` | **55 passando** (52 de API + 3 da regra de origem; atualizado na seção 13) |
| Lint | `cd web && npx oxlint` | sem avisos |
| Build | `cd web && npm run build` | ok |
| Rotas no `vercel dev` e no `npm run dev` | chamadas sem sessão | 401/400/405 esperados, sem tocar no banco |

Os testes de integração usam blockchain Hardhat local, Postgres em memória (PGlite) e Pinata simulado. Todos os dados são fictícios.

**Não testado de ponta a ponta:**
- **MetaMask no navegador.** A extensão não pode ser automatizada aqui. A assinatura foi testada com carteiras `ethers` e as mesmas mensagens.
- **Pinata e gateway reais.** Simulados. O formato da resposta de upload (`data.cid`) segue a API v3 já usada pelo código anterior.
- **Sepolia e o banco Neon com o código novo.** Não houve deploy.

---

## 5. Entidades, leituras e evidência

### 5.1 Regra para criar uma leitura

Um registro de quilometragem só existe quando alguém **observou o hodômetro naquele momento**, **identificou o veículo** e **produziu evidência**.

Processo administrativo, venda, comunicado de venda ou sinistro **não** geram leitura sozinhos. Se uma vistoria acontece durante uma transferência, existe **uma** leitura (tipo: vistoria de identificação; motivo: transferência), e não duas.

O modelo separa três coisas:

1. **Tipo da leitura:** o procedimento que obteve a km. Vai para a cadeia.
2. **Motivo:** por que o veículo passou pelo procedimento. Fica **só no banco privado** (ver 6.3).
3. **Origem e evidência:** tipo de entidade (em cadeia, na v2), carteira (em cadeia), pessoa responsável (banco), data da observação (em cadeia, na v2) e compromisso do comprovante (em cadeia).

### 5.2 Matriz

Nível de evidência:
- **Norma:** coleta da km exigida por norma oficial verificada.
- **Fonte secundária:** indicada por documentação de integrador, não confirmada na fonte oficial.
- **Prática:** depende da entidade.
- **Futuro:** só com integração a construir.

| Entidade | Tipo de leitura (v2) | Motivos típicos (privados) | Evidência | Nível | Situação no KmChain |
|---|---|---|---|---|---|
| Órgão de trânsito | CADASTRO_INICIAL, VISTORIA_IDENTIFICACAO, CORRECAO | primeiro registro, vistoria própria, correção fundamentada | laudo, processo administrativo | Prática | **Simulado** (papel DETRAN) |
| Empresa credenciada de vistoria (ECV) | VISTORIA_IDENTIFICACAO, VISTORIA_CAUTELAR | transferência, mudança de município/UF, regularização, alteração de característica, reprovação | laudo SISCSV / laudo cautelar | Prática: a Res. CONTRAN 941/2022 torna a vistoria obrigatória na transferência e na mudança de município/UF, mas **não exige a km no laudo** | **Simulado** (papel vistoria) |
| Revenda / concessionária | AVALIACAO_COMERCIAL, MOVIMENTACAO_ESTOQUE | compra, troca, entrada e saída de estoque, RENAVE | laudo de avaliação, registro RENAVE | Fonte secundária: integradores indicam "KM e data de medição do hodômetro" na entrada e saída do RENAVE; a página oficial consultada não confirmou | **Futuro** (só na v2) |
| Oficina / concessionária de serviços | REVISAO_MANUTENCAO, VISTORIA_CAUTELAR | revisão, reparo, inspeção pré-compra, intervenção no painel/hodômetro | ordem de serviço, nota fiscal | Prática | **Simulado** (papel oficina) |
| Organismo de inspeção (OIA/Inmetro) | INSPECAO_SEGURANCA | modificação, GNV, regularização | CSV, relatório de inspeção | Prática: a inspeção de GNV é obrigatória (Portaria Inmetro 147/2022); não localizei exigência da km | **Futuro** (só na v2) |
| Seguradora / reguladora | VISTORIA_SEGURO | contratação, renovação, sinistro, recuperação, indenização | laudo de vistoria prévia/sinistro | Prática | **Futuro** (só na v2) |
| Leiloeira / pátio | AVALIACAO_COMERCIAL, MOVIMENTACAO_ESTOQUE | recebimento, avaliação, saída | termo de recebimento, laudo | Prática | **Futuro** (só na v2) |
| Locadora / gestora de frota | CONTROLE_FROTA | entrega, devolução, manutenção interna | check-in/check-out, telemetria | Prática | **Futuro** (só na v2) |
| Inspeção/transporte por categoria | INSPECAO_SEGURANCA | procedimentos próprios da categoria | relatório | Futuro | não mapeado em detalhe |

Na consulta pública, a origem deve ser apresentada como é, por exemplo "leitura informada por oficina", "vistoria realizada por ECV" ou "avaliação de revenda". Uma avaliação comercial **não tem o mesmo grau** que uma vistoria de identificação.

Credenciamento no KmChain **não** equivale a credenciamento pelo Detran, Inmetro ou RENAVE. Nenhuma dessas integrações existe.

**No contrato v1 (em uso)** só existem os papéis DETRAN, vistoria e oficina, e o enum mistura tipo e motivo (TRANSFERENCIA e SINISTRO são motivos). A interface atual continua usando esse enum; a separação depende da v2.

Fontes: [Res. CONTRAN 941/2022](https://www.legisweb.com.br/legislacao/?id=429791) · [consolidada](https://grupootimiza.com.br/legislacao/resolucao-contran-no-941-2022/) · [Manual RENAVE (Serpro), entrada em estoque](https://renave.estaleiro.serpro.gov.br/renave-ws/manual/solicitar-entrada-estoque) · [Linx: VEIC7960 (integrador RENAVE)](https://share.linx.com.br/display/DMS/VEIC7960) · [Res. CONTRAN 1.026/2026 (notícia ANAUTOS)](https://anautos.org.br/2026/07/02/contran-publica-resolucao-no-1-026-2026-e-torna-renave-obrigatorio-em-todo-o-brasil/) · [Portaria Inmetro 147/2022](https://www.legisweb.com.br/legislacao/?id=429566) · [Inmetro: GNV](https://www.gov.br/inmetro/pt-br/centrais-de-conteudo/noticias/informacoes-sobre-instalacao-e-utilizacao-de-sistemas-gnv)

---

## 6. Privacidade

### 6.1 Matriz de dados

| Dado | Finalidade | Quem lê | Onde | Vinculação/reidentificação | Retenção | Correção/eliminação | Na blockchain? |
|---|---|---|---|---|---|---|---|
| Chassi (texto) | Localizar o veículo | quem o informa; DETRAN no banco | banco (`registros_privados`, `documentos`); **transação pública** (o chassi vai em texto no calldata de `cadastrarVeiculo`/`registrarLeitura`) | alta: identifica o veículo; com a placa, o dono | enquanto houver histórico | **não, no calldata público** | [C] v1: sim, no calldata. v2 também (as funções recebem `string chassi`). Ver 6.2 |
| Hash do chassi | Chave do histórico | qualquer um | contrato + eventos | pseudônimo: quem conhece o chassi calcula a chave | permanente | não | sim, necessário para a consulta pública |
| Placa | Identificar o veículo para o DETRAN | DETRAN | banco | alta | enquanto o registro for necessário | sim | não (saiu na v1 atual) |
| Modelo, ano | Conferência pelo comprador | qualquer um | contrato | baixa: o chassi (VIN) já indica fabricante e ano-modelo | permanente | não | [A] aceitável: não é dado pessoal e ajuda a conferir o veículo; pode sair, ao custo de a consulta pública depender do servidor |
| Km | Objeto do sistema | qualquer um | contrato | média: sequência de km e datas revela padrão de uso | permanente | não (só correção anexada) | sim, é a prova |
| Data do bloco | Ordem e momento do registro | qualquer um | contrato | média (idem) | permanente | não | sim |
| Data da observação | Momento real da leitura | qualquer um | só na v2 | média | permanente | não | [A] v2: sim |
| Tipo da leitura | Grau de verificação da leitura | qualquer um | contrato | baixa/média | permanente | não | sim |
| Motivo (transferência, sinistro...) | Contexto para o DETRAN | DETRAN | banco | **alta**: revela venda, acidente, indenização | conforme a finalidade | sim | [A] **não**. Na v1 TRANSFERENCIA e SINISTRO estão no enum público; a v2 retira |
| Carteira da entidade | Autoria verificável | qualquer um | contrato | média: liga todas as leituras de uma entidade; com o banco, liga à pessoa | permanente | não | sim, é a prova de autoria |
| Hash do documento | Integridade da evidência | qualquer um | contrato (v1) | [R] quem possui um documento candidato confirma se ele foi usado | permanente | não | [A] v2: trocar por compromisso com sal |
| CID | Localizar o arquivo cifrado | só o servidor | banco (`documentos`) | baixa (o conteúdo está cifrado) | enquanto o documento for necessário | apagar no banco sim; no IPFS não há garantia | não |
| Metadados IPFS | nenhum necessário | Pinata | Pinata | eram chassi, tipo e hash (antigos) | — | pedir remoção ao Pinata | [C] novos envios: nome aleatório e sem metadados |
| CPF, nome do proprietário | Identificar o proprietário em cadastro e transferência | DETRAN | banco | alta (dado pessoal) | a definir juridicamente | sim (falta tela) | não |
| Nome, e-mail do responsável | Quem, de fato, fez o registro | DETRAN; Admin e DETRAN na lista de contas | banco | alta | enquanto durar a conta + prazo de auditoria | sim | não |
| Trilha de acesso a documentos | Auditoria | ninguém pela interface (só no banco) | banco | média | a definir | sim | não |

### 6.2 O hash do chassi não é anonimização

O contrato usa `keccak256(chassi em maiúsculas)` como chave estável:
- quem conhece o chassi calcula a chave e lê o histórico (é o objetivo da consulta pública);
- o espaço de chassis é estruturado (fabricante, planta, ano, sequencial), então é possível enumerar chaves de uma faixa;
- os eventos são públicos e indexados, o que permite acompanhar o mesmo veículo ao longo do tempo;
- **[C] além disso, o chassi vai em texto puro nos dados de cada transação** (`calldata`), pois as funções recebem `string chassi`. Observado nos testes: a transação bruta de `registrarLeitura` contém `4b4d43…3031`, que é `KMCTESTE000000001` em hexadecimal. Qualquer explorador de blocos mostra.

Portanto, o histórico é **pseudônimo**, não anônimo. Alternativa [A]: enviar só a chave (`bytes32`) calculada no navegador, o que tira o chassi do calldata. Quem conhece o chassi continua consultando; quem só observa a rede passa a ver apenas a chave.

### 6.3 Posição recomendada

Manter em cadeia só o necessário para demonstrar ordem, autoria institucional e integridade: km, data do bloco, data da observação, tipo da leitura, origem, carteira e compromisso da evidência.

**Não** manter em cadeia motivo, placa, dados do proprietário nem hash direto de documento. Modelo e ano são aceitáveis.

CPF é tratado como **dado pessoal que precisa de proteção**, não automaticamente como "dado pessoal sensível" no sentido específico da LGPD.

Esta é uma avaliação técnica, **não um parecer jurídico** (ver seção 10).

---

## 7. IPFS e documentos

**[C] Implementado e testado:**
- Envio só com login e carteira vinculada com papel.
- Tipo detectado pelo conteúdo (PDF, PNG ou JPEG) e limite de 3 MB.
- Cifragem AES-256-GCM no servidor; nome aleatório no Pinata e nenhum metadado.
- CID e remetente só no banco.
- Link de abertura:
  - token aleatório de 256 bits, guardado só como hash;
  - preso à conta;
  - válido por 60 s e de **uso único** (marcado na mesma instrução que confere);
  - sem documento, chave, CPF ou CID.
- Na entrega, o arquivo é baixado e decifrado no servidor e conferido contra o hash em cadeia. A resposta sai com `Cache-Control: private, no-store`, `nosniff` e `no-referrer`.
- Política de acesso:
  - DETRAN abre qualquer comprovante indexado;
  - oficina e vistoria só os que a própria conta enviou;
  - comprovantes antigos, sem índice, só o DETRAN.
- Trilha `acessos_documentos` (emitido ou negado, sem dados do proprietário) e limite de 30 pedidos por conta a cada 10 minutos.
- Rotação da chave: `DOCS_KEY` cifra os novos arquivos; `DOCS_KEYS_ANTIGAS` decifra os anteriores.

**[L] Continua existindo:**
- Revogar um link já emitido: ele expira em 60 s.
- Revogar acesso a um documento específico não tem tela.
- A trilha não é exibida em lugar nenhum.
- Os envios anteriores a esta revisão continuam no Pinata com chassi, tipo e hash nos metadados.
- Nenhuma cópia no IPFS pode ser apagada com garantia: outros nós podem ter replicado. Excluir do Pinata apenas deixa de fixar a cópia.

**[A] Recomendação:**
- Documentos **com dados pessoais** (documento do veículo com nome e CPF, nota fiscal com CPF, laudo de sinistro) não deveriam ir ao IPFS, nem cifrados. A cifra protege hoje, mas o arquivo é permanente, e um vazamento futuro da chave expõe tudo o que já foi publicado. Para esses, armazenamento privado convencional (bucket privado com exclusão real e controle de retenção) é mais adequado. A cadeia continua recebendo só o compromisso.
- O IPFS só se justifica para evidência **sem dado pessoal** e cuja disponibilidade independente seja um objetivo. Isso depende de decisão institucional.

---

## 8. Proposta de evolução do contrato (v2, não implantada)

Arquivo: `contratos/contracts/KmChainRegistryV2.sol`. Testes: `contratos/test/KmChainRegistryV2.test.js` (10 testes).

| Mudança | Por quê | Teste |
|---|---|---|
| `TipoLeitura` (10 procedimentos) separado do motivo; motivo só no banco | motivo expõe fatos da vida do proprietário | `guarda tipo, origem na epoca...` |
| `Origem` gravada na leitura | a consulta deixa de depender da função atual | `a origem gravada nao muda quando a credencial e revogada` |
| Matriz `tiposPermitidos[origem]` configurável pelo admin | cada entidade só registra o que é compatível com sua atuação | `matriz de permissoes...`, `nao aceita declarar uma origem...` |
| CADASTRO e CORRECAO só pelas funções próprias | corrige o defeito nº 3 | `CADASTRO_INICIAL e CORRECAO nunca entram...` |
| `dataObservacao`: não futura, até 30 dias de atraso, não anterior à última | separa observação de registro; o limite diário passa a usar o intervalo entre observações | `recusa data de observacao...` |
| Compromisso `keccak256(sha256(doc), sal)` | o hash do documento sozinho não confirma nada | `compromisso da evidencia...` |
| Leitura em 3 slots (v1: 4) | custo | `custa menos gas...`: **≈113,9 mil contra ≈148,6 mil gas** por leitura (−23%, rede local; varia em poucas unidades conforme o hash) |
| `resumo()` em vez de `conformidade()` | contagens em vez de veredito | `correcao: so orgao de transito...` |
| Eventos mínimos | menos dado indexável por terceiros | — |

**Impactos:**
- **Banco:** colunas `motivo`, `origem_declarada` e `sal_evidencia` em `registros_privados`.
- **Frontend:** leitura de v1 + v2; formulários com tipo, motivo e data da observação; rótulos por origem.
- **Privacidade:** remove motivo e hash direto do documento da cadeia.
- **Testes:** os três testes `LIMITACAO` da v1 continuam descrevendo a v1.
- **Dados já registrados:** não mudam.

**[A] Plano de migração** (exige decisão explícita):
1. Não copiar a v1. Reescrever as leituras antigas mudaria autoria e data, o que seria falsificar a origem.
2. Publicar a v2 com `contratoAnterior = v1`.
3. Conceder papéis na v2.
4. A interface lê a v1 e a v2 e rotula os registros da v1 ("registro do contrato anterior: origem na época não gravada").
5. Revogar os papéis de escrita na v1, que fica só leitura.
6. Um veículo que só existe na v1 precisa ser cadastrado na v2 pelo órgão de trânsito. A primeira leitura da v2 deve ser ≥ à última válida da v1; hoje a interface confere isso, e a v2 poderia receber essa âncora.

Antes de implantar: revisão do contrato por outra pessoa, testes de carga do histórico (o laço de `corrigirLeitura` cresce com o histórico) e a decisão sobre tirar o chassi do calldata (6.2).

---

## 9. Validação experimental reproduzível

Todos rodam com `npx hardhat test` (contrato) e `npm test` (rotas), com dados fictícios e rede local. Para medir custo real: `npx hardhat run scripts/medirGas.js --network sepolia`.

| Cenário | Resultado esperado | Evidência observável | Onde |
|---|---|---|---|
| Evolução normal | leitura aceita; `ultimaKm` atualizada | teste `aceita leitura maior...` | v1 |
| Km regressiva | reverte `QuilometragemRegressiva` | revert com os dois valores | v1, v2 |
| Erro de digitação | reverte `LeituraAtipica(avanço, limite, dias)` sem confirmação | revert; a tela mostra os números do contrato | v1, v2 |
| Avanço atípico legítimo | aceito com confirmação e marcado `atipica` | flag no histórico e aviso público | v1, v2 |
| Correção | original `contestada`, nova leitura CORRECAO, evento com autoridade | `LeituraCorrigida(...)` | v1, v2 |
| Correção forjada (v1) | aceita pelo contrato, sinalizada pela interface | teste `LIMITACAO...` + `origem.test.mjs` | v1 |
| Revogação de credencial | novas leituras recusadas; antigas permanecem | teste de revogação | v1, v2 |
| Evidência alterada | hash diferente; entrega recusada com 409 | teste "comprovante adulterado" | API |
| Acesso não autorizado | 401/403 com código | testes de contas, consulta privada, upload e documento | API |
| Falha parcial cadeia × banco | transação confirmada, registro privado pendente; reenvio sem duplicar | testes de idempotência; tela "Tentar de novo" | API + UI |
| Transação de outro contrato, que falhou ou de outra carteira | 422/422/403 | testes do `registrar` | API |
| Custo de gas | v2 < v1 por leitura | linha `gas registrarLeitura` no teste: v1 ≈148,6 mil, v2 ≈113,9 mil | v1 × v2 |
| Entidades diferentes | cada origem só grava os tipos permitidos | teste da matriz | v2 |
| Desempenho da consulta | tempo de `getHistorico` e resposta da API | **não medido**; sugestão: medir com 10, 100 e 1.000 leituras | — |

---

## 10. Limitações e decisões que exigem orientação

**O protótipo não demonstra:**
- que a leitura inicial era verdadeira;
- que o hodômetro não foi adulterado antes do primeiro registro ou entre registros;
- a identidade física de quem assinou (a carteira prova a posse de uma chave; o login, o conhecimento de uma senha);
- a participação real de Detran, ECVs, oficinas, RENAVE ou Inmetro (os papéis são simulados);
- conformidade com a LGPD.

**[L] Limitações técnicas que continuam:**
- Na v1, a função da carteira na época só é garantida para cadastro e correção, e não há data da observação.
- A sessão (cookie de 7 dias) não é revogável no servidor antes de expirar.
- O login não tem limite de tentativas.
- O chassi aparece no calldata público.
- O endereço da entidade é público e permite correlação.

**Precisam de validação jurídica e institucional antes de qualquer dado real:**
- base legal para tratar CPF e nome do proprietário, e o controlador desses dados;
- prazo de retenção de dados pessoais e da trilha de auditoria;
- publicar km e datas de um veículo identificável por chassi para qualquer pessoa;
- permanência em blockchain frente aos direitos de correção e eliminação (a correção anexada não apaga);
- uso de IPFS para documentos;
- quem opera o papel Admin e com que governança;
- política de acesso a comprovantes (finalidade de cada entidade).

---

## 11. Pendências que dependem de você

1. ~~Carteira em duas contas~~: resolvido. A carteira `0x3abc…ea0f` ficou só na sua conta; a do Rui ficou sem carteira vinculada. Sem duplicatas, o índice único de carteira será criado na próxima migração.
2. **Token de bypass da Vercel** gerado por engano pelo `vercel curl`: revogue em Settings → Deployment Protection.
3. **Banco real:** ao primeiro login com este código (local ou publicado), a migração cria as tabelas e colunas novas. É aditiva e não altera dados existentes.
4. **Metadados antigos no Pinata:** os envios anteriores têm chassi, tipo e hash nos metadados. Posso listar os afetados; a limpeza depende de você.
5. **Deploy do site e decisão sobre a v2:** nada foi publicado.

---

## 12. Texto para o TCC

> O KmChain é um protótipo que registra leituras de hodômetro em uma blockchain pública (rede de testes Sepolia), feitas por carteiras credenciadas por um administrador. O protótipo demonstra que, uma vez gravada, uma leitura não pode ser alterada nem apagada; que o histórico de cada veículo tem ordem verificável e é consultável por qualquer pessoa, sem cadastro; que cada registro é atribuído a uma carteira que tinha credencial no momento, e que a revogação impede novos registros sem apagar os anteriores; que leituras regressivas são recusadas e avanços atípicos exigem confirmação explícita e ficam sinalizados; e que correções são anexadas ao histórico, preservando a leitura original. Quando há comprovante, o hash registrado em cadeia permite verificar que o arquivo apresentado é o mesmo usado no registro. Dados pessoais (placa, nome e CPF do proprietário, identidade de quem executou o serviço) ficam fora da blockchain, em banco com acesso controlado.
>
> O protótipo não comprova que a quilometragem registrada era verdadeira: uma leitura falsa, informada por entidade credenciada ou anterior ao primeiro registro, é gravada com a mesma integridade que uma verdadeira. A assinatura prova a posse de uma chave, não a identidade física de quem a usou. As funções de DETRAN, centro de vistoria e oficina são simuladas; não há integração com Detran, RENAVE, Inmetro ou oficinas reais. A identificação do veículo por hash do chassi é pseudônima, não anônima. A adequação à LGPD e a governança do credenciamento exigem avaliação jurídica e institucional antes de qualquer uso com dados reais. A contribuição do trabalho é, portanto, tornar os registros feitos por entidades identificadas mais rastreáveis, verificáveis e resistentes a alterações posteriores. Não é eliminar a fraude de odômetro.

---

## 13. Segunda etapa: identificador, cadastro e dados em cadeia

### 13.1 Implementado e testado

| Item | Onde | Evidência |
|---|---|---|
| Chassi (VIN) como identificador: regra única de normalização, validação (17 caracteres, sem I, O e Q) e chave `keccak256(chassi normalizado)` | `web/src/lib/chassi.js` (usada pela tela, pelas rotas, pelo QR e pelos testes) | a chave calculada pela tela é igual à do contrato v1 para o chassi em minúsculas, com espaços ou com hífen |
| QR Code: o mesmo módulo gera o link da etiqueta e lê o link na câmera | `EtiquetaQr.jsx`, `LeitorQr.jsx` | teste: ida e volta do link; QR de outro site ou com chassi inválido é recusado |
| Cadastro em três seções (identificação; primeira leitura; proprietário na data do cadastro) | `CadastroVeiculo.jsx` | build e lint; regras testadas no servidor |
| Seletor de marcas com busca, lista padronizada fora do componente, `id` estável + nome | `src/dados/marcas.json`, `ui/SeletorMarca.jsx`, `lib/veiculo.js` | teste: lista pública com `volkswagen` |
| Marca ausente: proposta controlada (igual → recusada; parecida → sugestão e confirmação; nova → pendente; só o admin aprova ou recusa; recusada não volta) | `api/marcas.js` (GET lista, POST propõe, PATCH revisa), `MarcasPropostas.jsx` | 6 testes |
| Modelo em texto livre validado; nada deduzido do chassi | `lib/veiculo.js` | teste de validação |
| Ano de fabricação e ano-modelo (o ano-modelo é o de fabricação ou o seguinte) | `lib/veiculo.js` | teste de validação |
| UF de registro na data do cadastro, informada (nunca pela placa), só no banco | `veiculo_ufs` | teste do cadastro completo |
| Data e hora da observação, separada da data do bloco | `registros_privados.observada_em` | teste: as duas datas diferem e são guardadas separadas |
| Validação no servidor ANTES da assinatura e de novo depois dela | `api/veiculo.js` (POST), `api/_cadastro.js` | teste: 10 campos inválidos com mensagem por campo |
| Conferência: modelo e ano gravados em cadeia = os validados | `api/privado/registrar.js` | teste: divergência → 422 e nada gravado |
| Placa, UF e proprietário **datados**; mudança = linha nova; histórico preservado | `veiculo_placas`, `veiculo_ufs`, `veiculo_proprietarios`, `api/privado/alterar.js` | testes: placa, UF, proprietário (alteração e transferência); data anterior à vigente recusada |
| Consulta privada com o histórico datado e "Registrar alteração" | `ConsultaPrivada.jsx` | build; rota testada |

### 13.2 Apenas proposta (v2, não implantada)

`contratos/contracts/KmChainRegistryV2.sol`, com 14 testes:
- as funções recebem a **chave** (`bytes32`) em vez do chassi. Teste: nem o calldata nem os logs de cadastro, leitura e correção contêm o chassi (em contraste, a v1 contém);
- os quatro fluxos (cadastro, leitura, correção e consulta) usam a mesma chave, inclusive com o chassi digitado em minúsculas, com espaço ou com hífen. O teste importa a mesma `web/src/lib/chassi.js`;
- sem marca, modelo nem anos em cadeia;
- eventos só com chave e índice;
- chave vazia recusada (`ChaveInvalida`); chassi inválido nunca vira chave;
- ≈113,9 mil gas por leitura (v1: ≈148,6 mil).

**A chave é um pseudônimo, NÃO anonimização.** Quem conhece o chassi calcula a chave e localiza o histórico público, e isso é intencional: é assim que a consulta pública funciona. A v2 só evita que o chassi fique em texto nos dados de cada transação.

### 13.3 O que fica na blockchain e o que fica no banco

| Dado | Contrato em uso (v1) | Proposta v2 | Banco privado |
|---|---|---|---|
| Chassi em texto | **sim**, no calldata | não | sim |
| Chave do chassi | sim (estado e eventos) | sim (estado e eventos) | sim (`veiculos.chave`) |
| Marca e modelo | sim: "Marca Modelo" num texto só (estado, evento, calldata) | não | sim (`marca_id`, `marca_nome`, `modelo`) |
| Ano de fabricação | não | não | sim |
| Ano-modelo | sim | não | sim |
| Placa | não | não | sim, datada |
| UF de registro | não | não | sim, datada |
| Nome e CPF do proprietário | não | não | sim, datados |
| Km | sim | sim | sim (cópia conferida no evento) |
| Data do bloco | sim (estado) + na própria transação | sim (mesmo slot, sem custo extra) | sim (`registrado_em_cadeia`) |
| Data da observação | não | sim | sim (`observada_em`) |
| Tipo | enum que mistura procedimento e motivo | tipo da leitura (procedimento) | sim |
| Motivo (transferência, sinistro...) | sim, no enum público | não | parcial: hoje só o tipo v1 |
| Origem (tipo de entidade na época) | não | sim | não |
| Carteira que assinou | sim (estado) + remetente da transação | sim (estado) + remetente | sim |
| Evidência | SHA-256 direto do comprovante | compromisso `keccak256(sha256, sal)` | hash, CID, remetente |
| Quem, pessoa, fez o registro | não | não | sim |

**Por que a entidade e a data do bloco continuam no estado da v2, mesmo estando na própria transação:** com elas no estado, o histórico é legível por uma única chamada `getHistorico`. Sem elas, seria preciso ler logs e transações antigas, que os nós não são obrigados a guardar para sempre. A data do bloco divide o mesmo slot com a km, então não custa nada a mais; a carteira custa um slot.

### 13.4 Limitações que continuam

- **Contrato em uso (v1):**
  - o chassi vai em texto no calldata;
  - "Marca Modelo" e o ano-modelo ficam públicos;
  - a data da observação só existe no banco;
  - o enum público inclui TRANSFERENCIA e SINISTRO.
- **Dados:**
  - o dígito verificador do VIN não é conferido (não é obrigatório em todos os mercados);
  - a lista de marcas é curada para o protótipo e não é fonte oficial;
  - não há catálogo de modelos (texto livre);
  - veículos cadastrados antes desta etapa não têm identificação privada: a consulta privada avisa.
- **Operação:**
  - a mudança de placa, UF ou proprietário é registrada pelo DETRAN do protótipo sem comprovante próprio;
  - nenhuma integração com Detran ou RENAVE confirma essas mudanças.

## 14. Afirmações do TCC a revisar

O texto do TCC não está no repositório nem na pasta Documentos; não o li. A lista abaixo parte do que a documentação anterior do projeto afirmava, que é o provável ponto de partida do texto. Para cada afirmação, confira se ela aparece e troque pelo que o protótipo sustenta.

| Se o TCC afirma... | O protótipo sustenta... |
|---|---|
| "Registro à prova de adulteração da quilometragem" | Os registros não podem ser alterados depois de gravados; a quilometragem informada pode ser falsa. |
| "Só o DETRAN e as entidades por ele credenciadas gravam leituras" | Só carteiras credenciadas pelo **administrador do contrato** gravam; as funções DETRAN, vistoria e oficina são **simuladas**. Uma carteira DETRAN não credencia outras. |
| "Integrado ao Detran / RENAVE / oficinas" | Não há integração; a coleta documentada de km é de prática das entidades (ver seção 5). |
| "O veículo é identificado pela placa" | O identificador é o **chassi**; placa, UF e proprietário são informações **datadas** no banco privado. |
| "O hash do chassi anonimiza o veículo" | É pseudônimo: quem conhece o chassi encontra o histórico. Na v1, o chassi ainda vai em texto no calldata. |
| "Nenhum dado do veículo vai para a blockchain" ou "só a km" | Na v1 vão também marca + modelo (um texto), ano-modelo, tipo de evento (inclusive transferência e sinistro), carteira e hash do comprovante. |
| "A data registrada é a da leitura" | A blockchain guarda a data do **bloco**; a data da observação fica no banco (v1) e só vai para a cadeia na proposta v2. |
| "O selo de conformidade atesta o histórico" | Indica apenas que os registros após o cadastro têm comprovante anexado. |
| "Correções só pelo DETRAN" | Correções reais só pelo DETRAN; mas a v1 aceita registros do tipo "correção" e "cadastro" de qualquer credenciada, e a interface os sinaliza. |
| "Documentos ficam no IPFS de forma segura ou privada" | Ficam cifrados (AES-256-GCM); o IPFS é público e permanente; o acesso é por link de uso único, regra por função e auditoria. |
| "Conformidade com a LGPD" | Avaliação técnica apenas; requer validação jurídica e institucional. |
| "O sistema impede a fraude de odômetro" | Torna os registros de entidades identificadas rastreáveis, verificáveis e resistentes a alteração posterior; não impede leitura falsa nem adulteração fora dos registros. |
| Cadastro com "proprietário atual" | O cadastro registra o **proprietário na data do cadastro**; mudanças posteriores entram como novas informações datadas. |
| Contrato "otimizado" ou "definitivo" | A v1 está em uso; a v2 é proposta testada (−23% de gas por leitura), não implantada. |

## 15. Identificação pública do veículo (decisão do projeto)

**Decisão:** a consulta pública por chassi mostra marca, modelo, ano de fabricação, ano-modelo, placa e UF de registro **vigentes**. Esses dados vêm do banco, pela rota `GET /api/veiculo`, **e não da blockchain**. O proprietário (nome e CPF), o histórico de placas e UF e quem fez cada registro continuam **só para o DETRAN**.

**Consequências:**
- **Vantagem:** placa e UF podem ser corrigidas ou atualizadas (informação datada) sem ficar gravadas para sempre em cadeia.
- **Risco aceito:** a placa pública ligada ao chassi e ao histórico facilita cruzar dados sobre o veículo. Ela não identifica o proprietário sozinha, mas pode ajudar a chegar nele combinada com outras fontes. Esta é uma decisão que precisa de validação jurídica antes do uso com dados reais.
- **Dependência do servidor:** a consulta pública passa a depender do servidor para exibir esses campos. Se ele estiver fora do ar, o histórico em cadeia continua aparecendo, só sem a identificação.

**Completar identificação:** um veículo que está em cadeia sem identificação no banco pode ser completado pelo DETRAN (`POST /api/privado/alterar` com `campo: "identificacao"`). O servidor lê o veículo no contrato e só aceita se "marca + modelo" e o ano-modelo forem exatamente os gravados em cadeia. Placa e UF valem a partir da data do cadastro em cadeia, e o proprietário é opcional. Isso atende veículos cadastrados antes da identificação privada existir e cadastros cujo registro privado se perdeu.

**Testes:** 4 cenários:
- a rota pública não devolve o proprietário e mostra a placa e a UF vigentes;
- um veículo sem identificação aparece como nulo;
- o complemento é recusado quando diverge da blockchain, aceito quando confere e recusado na segunda vez;
- chassi fora da blockchain é recusado.

Total: 60 testes das rotas.
