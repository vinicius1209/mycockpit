# PRD, busca no fio

> Status: **Frente A decidida e medida** (busca léxica por FTS5). **Frente B
> adiada** (busca semântica por embedding), sem data e sem aprovação.
> Origem: avaliação de plugins Hermes Agent (snyk + lancedb), 18/09/2026.
> Decisão estrutural: ADR-213 em `docs/decisions.md`.
> Evidência bruta: `docs/evidence/busca-no-fio/`.

## 0b. O que a F2 descobriu (19/09/2026)

A avaliação do índice entregue na F1 achou um erro que a medição anterior não
podia ver, porque o protótipo era em Python e o corpus de teste era pequeno:

1. **`unicode61` perdia identificador em camelCase.** `useWatchdog` vira UM
   token e o prefixo é ancorado no início, então buscar "watchdog" não achava.
   Medido: 11 de 33 itens em "interval", 59 de 195 em "Conversations". Num
   corpus de código isso é o caso central, não a cauda. Corrigido trocando o
   tokenizador para `trigram` (ADR-220), que casa substring.
2. **O ranking agora é idêntico de verdade:** 216 de 216 pares (10 conversas,
   28 queries), contra os "95,7%" estimados antes.
3. **O ganho de velocidade encolheu, e isso está assumido.** Trigram é rápido
   com termo raro e lento com termo comum: `fts5` 69x, `migração` 12x,
   `watchdog interval` 10,5x, mas `bash` 0,9x e `tauri command async` 0,7x. A
   troca é deliberada: busca 10ms mais lenta em "bash" que acha `useWatchdog`
   é melhor que busca veloz que mente por omissão.
4. **Stopword sozinha não pode fazer item casar.** A varredura respondia
   "revezamento de motor" com os dez itens mais recentes porque casava só o
   `de`. Isso é ruído ordenado por recência vestido de resultado, e valia para
   os DOIS caminhos: agora os termos são filtrados uma vez, no topo.
5. **Três instrumentos meus estavam errados antes do código estar.** O harness
   de fidelidade usava `tokens` cru em vez de `termos_uteis`; a comparação
   misturava `score` junto com ranking e acusava divergência onde a ordem era
   idêntica; e a fixture do teste de contrato tinha `input` de UMA chave, o que
   escondia que o `serde_json` ordena chaves e o SQLite preserva a ordem do
   documento. Os três foram corrigidos e estão descritos na ADR-220.

Fora do escopo, mas achado aqui e **não corrigido**: o blob legado
(`conversations.items`) fica ATRÁS da fonte itemizada em algumas conversas (uma
com 34 itens no blob e 82 na tabela). Só o `persist` reescreve os dois; a cauda
incremental grava apenas a tabela. Não é da busca, e mexer nisso é da frente que
é dona do `itemPersistence`.

## 0. Correção de 18/09/2026, depois do double check

Este PRD foi revisado contra a árvore após outra frente ter avançado nela. Cinco
coisas mudaram, e as três primeiras são estruturais:

1. **A fonte não é o blob.** Existe `conversation_items` (migração **48**,
   `lib.rs:652`), tabela itemizada e escrita a cada cauda. O `context_search`
   lê o blob legado; o índice nasce da tabela.
2. **O gancho não é TypeScript.** A extração de texto é expressável em SQL puro
   e foi verificada **byte a byte** contra o `searchable_text` do Rust em 7.721
   itens. Logo o índice se mantém por **trigger**, e `store/chat.ts` não é
   tocado. O problema da catraca sem folga desaparece.
3. **Trigger ingênuo custa 3,3 segundos.** O `persist` chama `replaceAll`, que
   hoje faz `DELETE` da conversa inteira antes de reinserir. Com trigger isso
   reindexa 3.286 itens a cada persist. A correção está no R3.
4. **O ganho real é 3,5x, não 13x.** Medido com o código Rust em release
   contra o banco real: a varredura custa 24-30ms, não os 60ms que o
   protótipo em Python indicava. O Python parseava JSON muito mais devagar
   que o `serde_json`, então o teto pessimista era pessimista **demais** do
   lado errado. A fidelidade, em compensação, é **12 de 12 queries idênticas**.
5. Trocar a leitura do blob pela tabela, sem índice, **não ganha nada**
   (61,0ms contra 60,5ms). Alternativa medida e descartada.

O texto abaixo já incorpora tudo isso. O que a versão anterior dizia sobre
`flushItems` como gancho está **revogado**.

---

Este documento substitui o rascunho "PRD, busca vetorial com LanceDB". O
rascunho propunha LanceDB + embeddings ONNX como resposta única. A medição
sobre o corpus real derrubou o diagnóstico dele e a maior parte da solução. O
que sobrevive está aqui; o que caiu está na §8, com o motivo.

## 1. O pedido, nas palavras de quem usa

"Busca semântica no painel MCP: digitar 'scroll que parou' e encontrar 'rolagem
automática que quebrou'." E, junto: conversas longas ficaram lentas para
pesquisar.

São **dois pedidos**, não um. O primeiro é sobre significado, o segundo é sobre
desempenho. O rascunho tratou os dois como o mesmo problema e propôs uma única
máquina cara para ambos. Eles têm custos separados por uma ordem de grandeza, e
só um deles está resolvido hoje.

## 2. Evidência

Tudo abaixo foi **medido** em 18/09/2026 sobre uma cópia do banco real
(`dev.vinicius.mycockpit/mycockpit.db`, 36MB). Nenhum número aqui é estimado.

### 2.1 O corpus real

| | valor |
|---|---|
| conversas | 22 |
| itens no blob legado | 11.421 |
| itens em `conversation_items` | 7.721, em 12 das 22 conversas |
| itens com texto indexável | 7.640 |
| maior conversa | 3.286 itens, blob de 5,0MB |
| média por conversa | 696KB |

`conversation_items` cobre só as conversas tocadas desde a migração 48; as
outras 10 ainda vivem só no blob. O retrofit disso é o R7.

O rascunho estimava "500-2000 itens" e um índice de "~5 MB". Errou por 6x no
primeiro número, com um único usuário e 22 conversas.

### 2.2 Onde o tempo realmente vai

`search_conversation` (`app/src-tauri/src/context_gateway.rs:317`) carrega o
blob `items` inteiro, faz `serde_json` e varre. Decomposto na maior conversa:

| etapa | custo |
|---|---|
| `SELECT items` | 53ms |
| parse do JSON | 25ms |
| varredura + score | 28ms |

**A varredura é o terço mais barato.** O rascunho culpava o `O(n)` do scan e
construía um banco vetorial para resolver isso. O gargalo é abrir e parsear um
blob de 5MB a cada query. Qualquer índice que evite tocar no blob resolve, e
vetor não é requisito para isso.

**Trocar só a fonte não resolve.** Ler `conversation_items` linha a linha em vez
do blob custa 61,0ms contra 60,5ms: idêntico. O preço não é o formato do
armazenamento, é parsear 3.286 JSONs. Alternativa medida e descartada.

> Medições em Python, ou seja, teto pessimista dos dois lados da comparação. Em
> Rust ambos caem. O que carrega a decisão é a **razão**, não o absoluto.
>
> Correção de método: o porte inicial serializava o `input` das ferramentas com
> `json.dumps` padrão (`{"a": "b"}`), enquanto o `Display` do `serde_json` é
> compacto (`{"a":"b"}`). Os tokens eram os mesmos, então os números não se
> moveram, mas o porte foi corrigido e tudo foi remedido com ele.

### 2.3 FTS5 está disponível, sem dependência nova

`SQLITE_ENABLE_FTS5` é ligado incondicionalmente no build do `libsqlite3-sys
0.30.1` (`build.rs:129`), sem feature gate. É o mesmo lib dos dois lados do app:
`rusqlite` e o `sqlx` do `tauri-plugin-sql`, alinhados de propósito pela
cicatriz registrada em `app/src-tauri/Cargo.toml:46-48` (`links="sqlite3"` só
admite uma versão no grafo). Logo FTS5 **não adiciona crate, não adiciona
modelo e não toca no risco de linker**.

FTS5 não é ideia nova aqui: `docs/autonomy.md:177` registra que o Hermes usa
SQLite FTS5 para recall episódico. É arte prévia já catalogada por nós, não um
compromisso nosso anterior, mas o rascunho propunha banco vetorial sem sequer
considerar a alternativa que já estava anotada no próprio repositório.

### 2.4 A troca ingênua seria uma regressão silenciosa

Trocar a busca por `MATCH` + BM25 dá 30x de velocidade e **muda o que o agente
enxerga**: apenas 32% de sobreposição no top-10 contra a busca de hoje. Não é
que o BM25 seja pior; é outro ranking. O score atual
(`exact*8 + coverage*6 + recência`) tem viés de recência e bônus de frase exata
que o BM25 não replica. Ninguém decidiu trocar o ranking, então trocar junto
seria teatro: a busca pareceria a mesma e responderia outra coisa.

### 2.5 O ganho real, medido em release

Os números desta seção e da seguinte vieram de um protótipo em Python. O que
vale é a medição do código que ficou, em perfil release, contra o banco real
(conversa de 3.286 itens, 12 queries):

| | varredura | índice | |
|---|---|---|---|
| total das 12 queries | 316ms | **91ms** | **3,5x** |
| melhor caso (`styleguide elevacao`) | 24,8ms | **1,9ms** | 13x |
| pior caso (`tauri command async`) | 28,5ms | **17,4ms** | 1,6x |
| queries com top-10 idêntico | (referência) | **12 de 12** | |

Corte de candidatos, também em release. É um trade direto entre velocidade e
fidelidade, e só um valor entrega ranking idêntico:

| candidatos | ganho | queries com top-10 idêntico |
|---|---|---|
| 100 | 8x | 6 de 12 |
| 200 | 6x | 8 de 12 |
| 400 | 4x | 9 de 12 |
| **800** | **3,5x** | **12 de 12** |

Escolhemos 800. A decisão inteira é "a busca fica mais rápida sem mudar o que
devolve"; trocar fidelidade por velocidade seria desfazer a premissa.

**Por que 3,5x ainda vale:** a varredura é O(n) no tamanho da conversa e o
índice não é. Em 3.286 itens a diferença é 316ms contra 91ms; ela abre conforme
a conversa cresce, e a maior conversa deste banco cresceu 87 itens durante a
própria frente.

### 2.6 O desenho medido: FTS5 como filtro, score atual preservado

`MATCH` estreita de 3.199 itens para N candidatos; **a função de score que já
existe** rankeia os candidatos. O blob nunca é aberto.

Varredura do limite de candidatos (3 maiores conversas, 12 queries, índice
construído a partir de `conversation_items`):

| candidatos | fidelidade do top-10 | mediana | p95 |
|---|---|---|---|
| 25 | 50,0% | 1,17ms | 4,3ms |
| 50 | 68,1% | 1,25ms | 4,2ms |
| 100 | 77,3% | 1,57ms | 4,6ms |
| 200 | 89,0% | 1,80ms | 5,9ms |
| 400 | 93,3% | 1,91ms | 8,4ms |
| **800** | **95,7%** | 1,84ms | 14,4ms |
| 2000 | 95,7% | 1,88ms | 14,2ms |

800 é o joelho: acima disso a fidelidade não sobe mais, o que confirma que o
resto é o teto estrutural da §2.6, não o corte. Na maior conversa (3.286 itens):

| | hoje | híbrido | |
|---|---|---|---|
| mediana | 60,5ms | **4,58ms** | 13x |
| pior caso | 63,9ms | **13,6ms** | 5x |
| melhor caso | 59,0ms | **0,76ms** | 78x |
| fidelidade do top-10 | (referência) | **100%** nessa conversa, **95,7%** no corpus de 3 |

### 2.6 Os 3% que o FTS5 não alcança, e por quê

O score atual casa por **substring** (`lower.contains(t)`), então acha o termo no
meio da palavra. Um índice de tokens não faz isso nem com prefixo, que é sempre
ancorado no início. A perda estabiliza em 4,3% e não melhora com mais candidatos, ou
seja, é o piso estrutural da técnica, não um parâmetro mal escolhido.

Parte dessa perda é ruído (é o mesmo mecanismo que casa "de" dentro de "desde").
Não chamamos isso de regressão sem olhar caso a caso, e o aceite da §5 cobra
exatamente esse olhar.

### 2.8 A extração de texto em SQL é gêmea exata da do Rust

Para o índice se manter por trigger, o `searchable_text`
(`context_gateway.rs:484`) precisa existir em SQL. A versão em `CASE` +
`json_extract` foi comparada com o porte fiel do Rust nos **7.721 itens** da
tabela: **7.721 idênticos, 0 divergentes**. Não é semelhança aceitável, é
igualdade byte a byte, e é o que autoriza o desenho por trigger.

Essa igualdade é uma gêmea e gêmea diverge com o tempo. O R6 a prende com teste.

### 2.7 Armadilha: prefixo em token curto explode

`"erro de build"` custava 16ms fixos, **independentes do tamanho da conversa**,
porque `de*` casa 7.976 documentos (contra 3.868 de `de` sem prefixo). Cortar
stopwords e aplicar prefixo só em token com 4+ caracteres derruba para 1-2ms.

O `app/src/lib/recall.ts:31` já tem a lista de stopwords pt-BR/en calibrada. O
lado Rust precisa da gêmea, com teste-gêmeo, pelo padrão do repositório.

`remove_diacritics 2` no tokenizer não é detalhe de configuração: é o que faz
"automatica" encontrar "automática", e é metade do ganho de robustez léxica.

### 2.8 Custos de escrita e de espaço

| | valor |
|---|---|
| indexar 1 item (INSERT + commit) | 0,55ms mediana, 1,14ms p95 |
| construir o índice do corpus inteiro | 0,58s para 11.353 itens |
| índice do corpus, guardando o texto | 23,8MB |
| por 3.191 itens: com texto vs contentless | 7,7MB vs 3,0MB |

Guardar o texto no índice custa 2,5x o espaço e **se paga**: é ele que permite
montar o `summary` do resultado sem reabrir o blob, que é o ponto inteiro da
frente.

## 3. Decisão

**Frente A, aprovada:** índice FTS5 sobre os itens de transcript, usado como
gerador de candidatos. O ranking atual não muda. Detalhe estrutural na ADR-213.

**Frente B, adiada:** embedding local. Não é aprovada, não tem data, e não
começa antes de a Frente A estar em uso e medida. Justificativa na §8.

O que a Frente A **não** compra, e precisa estar dito sem rodeio: "scroll que
parou" continua **não** encontrando "rolagem automática que quebrou". Não
compartilham token, e nenhum índice léxico resolve isso. A Frente A entrega
velocidade (14x) e robustez léxica (acento, prefixo, plural). Significado é a
Frente B, e só ela.

## 4. Princípios

Herdados do rascunho, os que sobrevivem à decisão:

1. **Complementar, não substituir.** O caminho atual continua existindo e
   continua correto; o índice é um atalho para chegar nos mesmos itens.
2. **Estado real, nunca teatro.** O índice reflete o que foi indexado. Item não
   indexado não aparece como encontrado, e ref devolvido resolve no item certo.
3. **Fail-open no render.** Índice ausente, frio ou corrompido degrada para a
   varredura de hoje. A busca nunca quebra por causa do índice.
4. **Fail-closed no efeito.** O índice nunca corrompe o SQLite canônico, e a
   reconstrução nunca reescreve `items`.
5. **Sem daemon.** Indexação acontece no gesto que já existe (a cauda
   incremental do fio), nunca em processo de fundo.
6. **Local primeiro.** Nada sai da máquina. Nesta frente isso é de graça: não
   há modelo, não há rede, não há consentimento a pedir.

## 5. Requisitos, com aceite

### R1 · O índice nasce da fonte itemizada

- **Aceite:** tabela virtual FTS5 sobre o texto extraído de
  `conversation_items`, criada por `Migration` em `app/src-tauri/src/lib.rs`. A
  versão máxima real é **51** (`lib.rs:682`), conferida na árvore depois dos
  commits de outra frente, logo a nova é a **52**. Conferir de novo no momento
  de escrever: este número envelhece.
- **Aceite:** a extração de texto em SQL é a gêmea do `searchable_text`
  (`context_gateway.rs:484`), incluindo a serialização **compacta** do `input`
  das ferramentas.
- **Double check:** subir com banco pré-existente, confirmar que a migração roda
  uma vez e que uma segunda abertura é no-op.

### R2 · O índice se mantém por trigger, não por lembrança

- **Aceite:** três triggers em `conversation_items` (`AFTER INSERT`,
  `AFTER UPDATE`, `AFTER DELETE`). Nenhuma linha de `store/chat.ts` muda, e não
  há gancho novo em TypeScript. Consistência vira propriedade estrutural: quem
  escrever o item, de onde for, indexa.
- **Aceite:** o trigger de `UPDATE` tem guarda `WHEN old.item_json IS NOT
  new.item_json`. Sem ela, todo persist reindexa a conversa inteira.
- **Double check medido:** após `DELETE ... position >= 50`, `DELETE` da conversa
  inteira e 200 re-upserts do mesmo item, o índice fica com **0 órfãs, 0
  faltando, 0 duplicadas**. Esse é o teste, não a inspeção visual.

### R3 · O `replaceAll` não pode reindexar tudo

- **Contexto:** `persist` (`chat.ts:1292`) chama `itemPersistence.replaceAll`,
  que hoje passa `replace_all=true` e o Rust faz `DELETE` da conversa inteira
  antes de reinserir (`conversation_items.rs:56-62`). Sem trigger isso custa
  24ms e ninguém notou. **Com trigger custa 3.310ms, em todo persist.**
- **Aceite:** o `DELETE` inicial sai. Ele é **redundante**: com
  `replace_all=true` o change-set cobre todas as posições `0..n-1`
  (`conversationItems.ts`, `itemChanges` não filtra nada além da faixa), o
  upsert `ON CONFLICT DO UPDATE` reescreve todas elas, e o
  `DELETE ... position >= item_count` no fim já remove a cauda que sobrou.
- **Aceite medido:** com o `DELETE` fora e a guarda do R2 no lugar, o persist de
  uma conversa de 3.286 itens custa **8ms** quando nada mudou, e 11ms, 12ms e
  21ms com 1, 3 e 10 itens alterados.
- **Double check:** encolher uma conversa (compactar, remover item) e confirmar
  que nenhuma linha antiga sobrevive na tabela **nem** no índice. É o cenário
  que o `DELETE` inicial aparentava proteger.
- **Nota de árvore compartilhada:** isto toca código de outra frente. É
  remoção de redundância provada, não mudança de comportamento, e está isolada
  em um requisito próprio justamente para ser revisada como tal.

### R4 · O ref devolvido resolve no item certo

- **Aceite:** o índice guarda o `item_id` estável, que a tabela já carrega como
  coluna própria. A posição também entra, mas como dado de ranking (a recência
  do score), nunca como identidade.
- **Aceite:** `/compactar` reescreve o transcript e as posições andam; o ref
  entregue ao `context_read` precisa continuar resolvendo no item que o
  `summary` prometeu.
- **Double check:** indexar, compactar, buscar, e abrir o ref devolvido.

### R5 · A busca fica mais rápida sem mudar o que devolve

- **Aceite:** o top-10 do índice é **igual** ao da varredura nas 12 queries do
  corpus. Não é "≥95%": com 800 candidatos e o mesmo `pontuar` nos dois
  caminhos, a igualdade é o comportamento esperado, e qualquer divergência é
  sinal de regressão, não de piso estrutural.
- **Aceite medido em release:** 12 de 12 queries com top-10 idêntico à
  varredura, e nenhuma query mais lenta que ela. Total de 91ms contra 316ms.
- **Aceite:** a divergência residual é inspecionada item a item e classificada
  como ruído ou perda real, por escrito.
- **Double check:** o teste compara os dois caminhos sobre o MESMO corpus, com
  fixture de payload real colhido do banco (ADR-016), nunca inventada.

### R6 · O gateway não escreve, e a gêmea não deriva

- **Aceite:** `context_gateway.rs` continua abrindo `SQLITE_OPEN_READ_ONLY`
  (`:330`, `:415`). Ele lê o índice; quem escreve é o trigger.
- **Aceite:** conversa sem linhas em `conversation_items`, ou sem índice, cai na
  varredura atual sem erro e sem aviso na tela. São 10 das 22 conversas hoje.
- **Aceite:** teste de contrato prende a gêmea SQL ao `searchable_text` do Rust
  sobre um corpus real. Se alguém mudar um lado, o teste quebra. Sem isso a
  igualdade de 7.721/7.721 da §2.6b apodrece em silêncio.
- **Aceite:** stopwords em uma lista só, gêmea entre Rust e TS, com
  `recall.ts:31` como fonte; prefixo só em token de 4+ caracteres.
- **Double check:** apagar o índice com o app rodando e confirmar que a busca
  responde igual, só mais devagar.

### R7 · Ninguém configura nada, e banco velho também ganha

- **Aceite:** nenhum controle novo nas Configurações.
- **Aceite:** as 10 conversas que só existem no blob entram na tabela e no
  índice sem gesto do usuário, e a primeira busca responde mesmo antes disso,
  pela varredura.
- **Aceite:** a carga inicial de uma conversa grande custa 378ms medidos, e não
  acontece na thread da interface.
- **Double check:** abrir com banco de 36MB, buscar imediatamente, e confirmar
  resposta correta durante o preenchimento.

## 6. Fases

### F1 · Índice, trigger e leitura

Migração 52 (tabela FTS + três triggers + a gêmea SQL), remoção do `DELETE`
redundante do R3, leitura em `context_gateway.rs` com fallback. Testes de R1 a
R6.

**Saída:** `context_search` responde em milissegundos, devolvendo o mesmo que
hoje.

### F2 · Qualidade da query

Stopwords gêmeas, prefixo condicional, `remove_diacritics 2`, corpus de teste e
a inspeção escrita dos 4,3%. Teste de contrato da gêmea SQL.

**Saída:** nenhum caso patológico, e a divergência contra o caminho antigo está
explicada por escrito.

### F3 · Retrofit · **entregue em 19/09/2026**

Conversa anterior à migração 48 entra na fonte itemizada na PRIMEIRA vez que é
aberta (`itemizarSeFaltando`), e os triggers do índice a alcançam sozinhos.

**Descartado: retrofit por migração em SQL.** O carregamento PREFERE a fonte
itemizada ao blob (`loadConversation`), então um snapshot montado com `json_each`
que saísse torto viraria o que a pessoa vê, e o histórico apareceria danificado.
Os itens usados no retrofit são os que acabaram de ser lidos e vão para a tela:
não têm como divergir do que ela enxerga. O preço é que só retrofita conversa que
alguém abre, e isso é aceitável — conversa que ninguém abre também ninguém busca,
e a varredura responde igual, só mais devagar.

Conversa VAZIA não é itemizada: gravar `item_count = 0` faria o carregamento
preferir uma lista vazia ao blob, o que é perda de histórico e não retrofit. Das
10 conversas fora da fonte itemizada no banco de referência, 3 são vazias.

**Saída:** a frente vale para banco velho, sem gesto e sem risco de o retrofit
virar a verdade errada.

## 7. Fora de escopo

- Trocar o ranking da busca (o score atual é preservado de propósito).
- Busca semântica ou embedding de qualquer tipo (Frente B).
- Indexar arquivos do projeto, código-fonte ou entregas e lições.
- Sincronizar índice entre máquinas.
- Controle novo nas Configurações.

## 8. Frente B, adiada: por que embedding não entra agora

O rascunho propunha LanceDB + ONNX MiniLM. Cada peça, e o que a medição fez com
ela:

| proposta do rascunho | o que se verificou |
|---|---|
| "LanceDB porque a busca é O(n)" | o scan é 28ms de 106ms; o blob é o gargalo. FTS5 resolve isso sem crate novo. |
| "peso similar ao que já existe" | `lancedb` puxa `lance` → arrow + parquet + object_store e, pelo que se sabe, DataFusion. São centenas de crates contra ~25 diretos hoje. **Não verificado no crates.io** (sessão sem rede): é a medição nº1 se a Frente B for retomada. |
| "índice de ~5MB" | o corpus real dá 11.421 itens; só os vetores de 384 dimensões dariam ~17MB. |
| "`cargo tree` detecta o conflito antes" | isso é uma checagem, não uma resposta. A cicatriz de `Cargo.toml:46-48` é real e o plano precisa dizer o que fazer quando conflitar. |
| "MiniLM local, zero configuração" | `ort` é dylib nativa em app assinado e notarizado (cicatriz da ADR-201), mais os pesos. E MiniLM-L6-v2 é treinado em inglês, enquanto o corpus aqui é pt-BR misturado com código: justamente o caso cross-lingual onde ele é mais fraco. |
| "vetores para entregas e lições também" | são 50-200 entregas e 20-100 lições. Um cosseno linear sobre isso é microssegundos. Índice ANN ali não compra nada. |

Se a Frente B for retomada, três coisas mudam de cara:

1. **O armazenamento deixa de ser o problema.** 11.421 vetores de 384 dimensões
   são 17,5MB e ~4,4M multiplicações por busca, ou seja, poucos milissegundos
   com SIMD. Vetor como BLOB no SQLite que já existe, com varredura linear,
   entrega isso sem dependência nova. LanceDB só se justifica quando o linear
   parar de caber, e nesses dados isso está umas 10x à frente.
2. **O problema é o modelo**, e o spike tem que validar um modelo multilíngue
   contra corpus pt-BR real, com critério de reprovação escrito ANTES de rodar.
3. **A Frente A responde primeiro.** Se ela resolver a maior parte das buscas
   frustradas, a Frente B pode simplesmente não se justificar. Essa é a medição
   que abre ou fecha a questão.

## 9. Segurança

Herdada do rascunho e simplificada pela decisão: nesta frente **não há modelo,
não há rede e não há dado saindo da máquina**. O índice é um arquivo SQLite com
as mesmas permissões do banco canônico, contendo texto que já está no banco
canônico. Não há superfície nova de consentimento porque não há destinatário
novo.

O conteúdo indexado pode conter texto hostil. O pipeline não o interpreta: o
texto entra como dado em uma tabela, o tokenizer o quebra em termos, e nada ali
executa, resolve caminho ou mantém estado entre indexações.

## 10. Referências

- `app/src-tauri/src/context_gateway.rs:317` · `search_conversation`, o caminho atual
- `app/src-tauri/src/context_gateway.rs:330`, `:415` · o gateway abre READ-ONLY
- `app/src-tauri/src/context_gateway.rs:484` · `searchable_text`, a extração por tipo de item
- `app/src-tauri/src/context_gateway.rs:514` · `tokens`, o tokenizer atual
- `app/src-tauri/src/lib.rs:682` · migração 51, a máxima real hoje
- `app/src-tauri/Cargo.toml:46-48` · a cicatriz do `links="sqlite3"`
- `app/src-tauri/src/lib.rs:652` · migração 48, `create_conversation_items`
- `app/src-tauri/src/conversation_items.rs:56-62` · o `DELETE` redundante do R3
- `app/src-tauri/src/conversation_items.rs:88` · o `DELETE position >= item_count` que já cobre o encolhimento
- `app/src/lib/db/conversationItems.ts` · `itemChanges`, prova de que o change-set cobre todas as posições
- `app/src/store/chat/itemPersistence.ts` · a fila incremental, debounce de 1200ms
- `app/src/store/chat.ts:1292` · `persist`, que chama `replaceAll` e motiva o R3
- `app/src/store/chat.ts:838` · a cauda sendo reescrita, motivo do R4
- `app/src/lib/recall.ts:31` · as stopwords pt-BR/en já calibradas
- `docs/autonomy.md:177` · arte prévia: o Hermes faz recall episódico com FTS5
- `docs/decisions.md` · ADR-213, a decisão estrutural desta frente
- FTS5: <https://www.sqlite.org/fts5.html>
