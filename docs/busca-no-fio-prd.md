# PRD, busca no fio

> Status: **Frente A decidida e medida** (busca léxica por FTS5). **Frente B
> adiada** (busca semântica por embedding), sem data e sem aprovação.
> Origem: avaliação de plugins Hermes Agent (snyk + lancedb), 18/09/2026.
> Decisão estrutural: ADR-213 em `docs/decisions.md`.
> Evidência bruta: `docs/evidence/busca-no-fio/`.

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
| itens de transcript, total | 11.421 (11.353 com texto indexável) |
| maior conversa | 3.199 itens, blob de 5,0MB |
| média por conversa | 696KB |

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

> Medições em Python, ou seja, teto pessimista dos dois lados da comparação. Em
> Rust ambos caem. O que carrega a decisão é a **razão**, não o absoluto.

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

### 2.5 O desenho medido: FTS5 como filtro, score atual preservado

`MATCH` estreita de 3.199 itens para N candidatos; **a função de score que já
existe** rankeia os candidatos. O blob nunca é aberto.

Varredura do limite de candidatos (3 maiores conversas, 12 queries):

| candidatos | fidelidade do top-10 | latência p95 |
|---|---|---|
| 50 | 71% | 5,5ms |
| 100 | 80% | 5,7ms |
| 200 | 86% | 7,3ms |
| 400 | 91% | 11,2ms |
| **800** | **97%** | 15,3ms |
| 2000 | 97% | 15,9ms |
| ilimitado | 97% | 17,1ms |

800 é o joelho: acima disso a fidelidade não sobe mais. Na maior conversa, com
esse corte:

| | hoje | híbrido | |
|---|---|---|---|
| mediana | 61,5ms | **4,3ms** | 14x |
| pior caso | 66,4ms | **15,9ms** | 4x |
| melhor caso | 59,4ms | **0,67ms** | 89x |
| fidelidade do top-10 | (referência) | **97%** | |

### 2.6 Os 3% que o FTS5 não alcança, e por quê

O score atual casa por **substring** (`lower.contains(t)`), então acha o termo no
meio da palavra. Um índice de tokens não faz isso nem com prefixo, que é sempre
ancorado no início. Com candidatos ilimitados a perda estabiliza em 3%, ou seja,
é o piso estrutural da técnica, não um parâmetro mal escolhido.

Parte dessa perda é ruído (é o mesmo mecanismo que casa "de" dentro de "desde").
Não chamamos isso de regressão sem olhar caso a caso, e o aceite da §5 cobra
exatamente esse olhar.

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

### R1 · O índice existe e é canônico quanto à sua própria cobertura

- **Aceite:** tabela virtual FTS5 criada por `Migration` em
  `app/src-tauri/src/lib.rs`. A versão máxima real hoje é **51**
  (`lib.rs:682`), logo a nova é a **52**, conferida no arquivo no momento de
  escrever, não presumida deste texto.
- **Double check:** subir o app com banco pré-existente e confirmar que a
  migração roda uma vez e é idempotente numa segunda abertura.

### R2 · A escrita acontece onde a cauda já é confirmada

- **Aceite:** a indexação pendura em `flushItems` (`app/src/store/chat.ts:1345`),
  que já confirma "a cauda incremental pendente antes de um novo envio". **Não**
  se usa trigger em `conversations`: o trigger reextrairia todos os itens a cada
  persist, que é exatamente o custo que a frente existe para matar.
- **Aceite:** item que ainda está mudando não é indexado. Itens de streaming
  mutam no lugar e a cauda é reescrita (`chat.ts:838` descarta o último
  `result`), então o gatilho é a finalização, nunca o append.
- **Double check:** rodar um turno com streaming e confirmar que o item entra no
  índice uma vez, com o texto final.

### R3 · O ref devolvido resolve no item certo

- **Aceite:** o índice guarda o `id` estável do item (os itens já têm uuid
  próprio, verificado no blob real), e a posição é resolvida na leitura. Guardar
  só `item_index` é proibido: `/compactar` reescreve o transcript e as posições
  andam, e um ref velho passaria a apontar para outro conteúdo.
- **Double check:** indexar, rodar `/compactar`, buscar, e confirmar que o
  `context_read` do ref devolvido traz o item que o `summary` prometeu.

### R4 · A busca fica mais rápida sem mudar o que devolve

- **Aceite:** fidelidade do top-10 contra a implementação atual **≥ 95%** no
  corpus de 12 queries da §2.5. Abaixo disso a frente não entrega.
- **Aceite:** mediana **< 10ms** e p95 **< 20ms** na conversa de 3.199 itens.
- **Aceite:** os 3% de divergência são inspecionados um a um e classificados
  como ruído ou como perda real, por escrito.
- **Double check:** o teste compara os dois caminhos sobre o MESMO corpus, com
  fixture de payload real colhido do banco (ADR-016), nunca inventada.

### R5 · O gateway não escreve

- **Aceite:** `context_gateway.rs` continua abrindo `SQLITE_OPEN_READ_ONLY`
  (`:330`, `:415`). Ele lê o índice; quem escreve é o app.
- **Aceite:** índice ausente ou vazio para aquela conversa cai na varredura
  atual, sem erro e sem aviso na tela.
- **Double check:** apagar o índice com o app rodando e confirmar que a busca
  continua respondendo, mais devagar e com os mesmos resultados.

### R6 · A query não tem caso patológico

- **Aceite:** nenhuma query do corpus de teste passa de 20ms p95, incluindo as
  que só têm stopword e termo curto.
- **Aceite:** stopwords vivem em uma lista só, gêmea entre Rust e TS, com teste
  de contrato (`recall.ts:31` é a fonte).
- **Double check:** query de uma letra, query só de stopwords e query vazia
  respondem sem varrer o corpus inteiro.

### R7 · Ninguém configura nada

- **Aceite:** não há controle novo nas Configurações nesta frente. O índice se
  constrói sozinho e se mantém sozinho.
- **Aceite:** primeira execução em banco cheio constrói o índice sem travar a
  interface (0,58s medidos para 11.353 itens, mas o gesto não bloqueia o fio).
- **Double check:** abrir o app com banco de 36MB sem índice e confirmar que a
  primeira busca responde, mesmo que pela varredura, enquanto o índice enche.

## 6. Fases

### F1 · Índice e leitura

Migração 52, escrita em `flushItems`, leitura em `context_gateway.rs` com
fallback. Testes de R1 a R5.

**Saída:** `context_search` responde em milissegundos, devolvendo o mesmo que
hoje.

### F2 · Qualidade da query

Stopwords gêmeas, prefixo condicional, `remove_diacritics 2`, corpus de teste e
a inspeção escrita dos 3%. Testes de R6.

**Saída:** nenhum caso patológico, e a divergência contra o caminho antigo está
explicada por escrito.

### F3 · Retrofit e reconstrução

Bancos que já existem ganham o índice sem gesto do usuário; reconstrução por
gesto explícito quando o índice estiver inconsistente. Testes de R7.

**Saída:** a frente vale para banco velho, não só para banco novo.

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
- `app/src/store/chat.ts:1345` · `flushItems`, o gancho de escrita
- `app/src/store/chat.ts:838` · a cauda sendo reescrita, motivo do R2
- `app/src/lib/recall.ts:31` · as stopwords pt-BR/en já calibradas
- `docs/autonomy.md:177` · arte prévia: o Hermes faz recall episódico com FTS5
- `docs/decisions.md` · ADR-213, a decisão estrutural desta frente
- FTS5: <https://www.sqlite.org/fts5.html>
