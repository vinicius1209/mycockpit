# Estudo: Waku e GPUI — vale trocar de substrato?

> 13/08/2026. Estudo pedido como "duas frentes de tecnologia". **A premissa
> estava errada e isso é o achado principal**: `waku.sh` não é framework
> nenhum — é um **concorrente direto nosso**, com 13 dias de vida, escrito em
> Rust+GPUI. As duas frentes são uma só pergunta: *um concorrente trocou o
> webview por GPU nativa; devíamos também?*
>
> Método: web (fontes linkadas) + leitura do NOSSO código com file:line.
> Resposta curta, na abertura, porque o resto é fundamentação:
> **não. Nem GPUI, nem RSC. O que nos morde é algoritmo nosso, não substrato
> de render — e trocar de substrato não conserta algoritmo.**

---

## 1. Desambiguação: existem TRÊS "Waku", e o pedido apontava pro terceiro

| Nome | O que é | Relação conosco |
|---|---|---|
| **waku.gg** | O framework React minimalista de RSC do daishi kato (autor do Zustand — que **nós usamos**). 1.0 alpha após ~3 anos. | Nenhuma. Ver §2. |
| **waku.org** | Protocolo P2P de mensageria (sucessor do Whisper, libp2p GossipSub, usado por Status/WalletConnect). | Nenhuma. |
| **waku.sh** ⬅ | **"One native app for all your coding agents."** Rust + GPUI, `egoist/waku`, GPL-3.0. | **Concorrente direto.** |

O site vivo em `waku.sh` diz, verbatim:

> "Waku drives the agent CLIs you already have — sessions, transcripts, tool
> activity, and checkpoints in one fast graphite window, entirely on your
> machine."
>
> "Instant launch, smooth scrolling through years of transcript, no Electron."
>
> "Each agent is connected over its strongest native interface — stream-json,
> JSON-RPC, live events"

Isso é a nossa sinopse de produto, palavra por palavra — incluindo
**stream-json** e **JSON-RPC**, que são exatamente os nossos dois adapters.
Fonte: [waku.sh](https://waku.sh/) · [github.com/egoist/waku](https://github.com/egoist/waku)

### 1.1 O que o concorrente é, medido (não estimado)

Dados da API do GitHub em 13/08/2026:

| | Waku (egoist) | MyCockpit |
|---|---|---|
| criado | **2026-07-31** (13 dias) | 2026-06-25 (~7 semanas) |
| linguagem | Rust 3,35 MB · **Swift 152 KB** · TS 123 KB | TS/TSX 62,5k LOC · Rust 29,9k LOC |
| licença | **GPL-3.0** | proprietária (compra única) |
| stars / forks | 738 / 67 | — |
| issues abertas | **41** | — |
| releases no GitHub | **0** (distribui por Sparkle no site) | builds próprios |
| mantenedores | 1 (`subscribers_count: 2`) | 1 |

Três leituras honestas disso:

1. **~95k LOC de Rust em 13 dias** (3,35 MB ÷ ~35 B/linha) não é digitação
   humana — é código gerado por agente em volume. O `AGENTS.md` deles confirma
   o pipeline: watcher que "rebuilds, signs and relaunches the debug app", e a
   regra *"A successful Rust build alone is insufficient"*. Ou seja: **eles
   também não escrevem Rust à mão.** Isso corta parte do argumento "Rust é
   lento de iterar" — mas ver §5, porque corta menos do que parece.
2. **Swift no bundle.** Browser embutido e computer-use são macOS-only *e* em
   Swift. GPUI não cobriu; caíram pra AppKit. Uma migração nossa herdaria a
   mesma cratera.
3. **GPL-3.0.** Não podemos ler o código deles pra copiar nada — e é o mesmo
   vírus que reaparece no GPUI (§3.3). Para um produto de **compra única**,
   copyleft não é detalhe jurídico, é impedimento.

### 1.2 O que ele tem que nós não temos (a parte útil do estudo)

Ignorando o substrato, três features dele merecem entrar na fila, e **nenhuma
delas exige GPUI**:

- **Checkpoint por prompt em git ref oculto**: *"Every prompt checkpoints your
  working tree under a hidden git ref"* — rollback do código **e** da conversa
  juntos. Nosso R4 (worktree por sessão) resolve isolamento; isso resolve
  *rewind*, que é outra coisa. Barato: é `git`.
- **`⏈` enfileira follow-up enquanto o agente trabalha, `⌘⏈` esteira no meio
  do turno.** Nós temos steering, mas não a distinção fila×esteira no teclado.
- **Sparkle com deltas binários, assinado e notarizado.** Nosso `packaging.md`
  não tem auto-update com delta.

---

## 2. Frente 1 respondida: RSC/Waku(.gg) faz sentido aqui?

Respondo mesmo sendo premissa errada, porque a pergunta "RSC num app desktop"
é legítima e vale ficar registrada.

**Não, e por um motivo estrutural, não de gosto:** RSC precisa de um
**servidor que renderiza**. Nós somos local-first, sem servidor, e o nosso
"backend" é Rust no mesmo processo, falando por IPC do Tauri — não por HTTP.
Um Server Component teria que rodar em Node, o que significa **embarcar um
runtime Node** no bundle. É literalmente reintroduzir o custo do Electron
(processo extra, dezenas de MB) para ganhar streaming de HTML que a gente não
usa, num app onde **não existe latência de rede entre UI e dados**. É o caso
de manual de "solução procurando problema".

Dois lugares onde caberia, e a avaliação de cada um:

- **Landing / site do produto** — cabe tecnicamente ("sweet spot: mostly-static
  sites with some dynamic routes"). Mas é um site de marketing: Astro ou HTML
  estático resolvem com menos peça móvel, e adotar um framework em `1.0 alpha`
  pro nosso canal de vendas é risco sem retorno. **Não.**
- **Companion Web** — aqui o argumento é mais forte *na teoria* (é web de
  verdade, com servidor). Mas a arquitetura do Companion (`docs/companion-plan.md`,
  R3 no roadmap) é **cliente fino falando WS com o desktop**, com E2EE de
  aplicação e transcript binding. RSC exigiria um servidor de render no meio
  do canal criptografado — exatamente o intermediário que a ADR do Companion
  existe pra não ter. **Não.**

Ironia registrada: já usamos o melhor trabalho do daishi kato — `zustand`
(`app/package.json`). O Waku dele não acrescenta.

Fontes: [waku.gg](https://waku.gg/) · [wakujs/waku](https://github.com/wakujs/waku) ·
[InfoQ, 02/2026](https://www.infoq.com/news/2026/02/waku-react-framework)

---

## 3. Frente 2: GPUI, sem entusiasmo

### 3.1 O que é, de fato

Do README oficial, verbatim:

> "GPUI is a hybrid immediate and retained mode, GPU accelerated, UI framework
> for Rust, designed to support a wide variety of applications."
>
> "GPUI is still in active development as we work on the Zed code editor, and
> is **still pre-1.0. There will often be breaking changes between versions.**"

Mecânica real (do [post "Leveraging Rust and the GPU"](https://zed.dev/blog/videogame)):
não é uma lib de gráficos genérica — são **shaders customizados para
primitivas de UI** (retângulo, sombra, texto, ícone, imagem). Layout
"heavily inspired by Flutter" (constraints descem, tamanhos sobem — **não é
Taffy/flexbox**, é modelo próprio). Texto: shaping pelo **CoreText** do SO com
cache de pares texto-fonte, rasterização de glifo na CPU pelo SO (só canal
alfa, até 16 variantes sub-pixel), glifos empacotados por bin-packing num
**atlas de textura na GPU**. A composição de texto *"approximates the bandwidth
of the GPU, as we are literally copying bytes from one texture to the other"*.

É engenharia séria e o resultado é real. Nada aqui é marketing vazio.

### 3.2 Maturidade fora do Zed

| Eixo | Estado |
|---|---|
| crate | `gpui` **0.2.2**, Apache-2.0 declarada, **7 versões publicadas**, ~200k downloads |
| docs | *"the best way to learn about these APIs is to read the Zed source code or drop a question in the Zed Discord"* — a própria equipe admite |
| forks de necessidade | existem `gpui-ce` e `gpui-unofficial` ("not maintained by the Zed team") — **sintoma clássico de crate que ainda não é consumível como dependência** |
| acessibilidade | **inexistente**. AccessKit é *plano*, não entrega. Zed é "absolutely inaccessible for screen reader users on Windows"; no macOS faltam affordances básicas via VoiceOver |
| ecossistema real | **`gpui-component`** (Longbridge, Apache-2.0, **12,7k stars**, 2.035 commits) — 60+ componentes inspirados em shadcn/ui, ícones Lucide, **Markdown nativo**, **List/Table virtualizados**, code editor. Em produção no Longbridge Pro |
| outros em produção | Zedis, OpenLogi (8,4k), tty7, GitComet, Loungy (dormant), Codux |

Crédito onde é devido: **`gpui-component` é melhor do que eu esperava**. Ele
sozinho derruba o argumento preguiçoso de "não tem componente". Tem Markdown,
tem lista virtualizada, é inspirado em shadcn — que é *a nossa base*
(`blocks.so`/shadcn). Se a decisão fosse só "existe com que construir", a
resposta seria sim.

### 3.3 O bloqueio que ninguém menciona: a licença não é o que diz ser

[Issue #55470 do Zed, ABERTA](https://github.com/zed-industries/zed/issues/55470):

> "`gpui`'s Apache-2.0 license is contaminated by GPL-3.0 transitive deps via
> `sum_tree` → `ztracing`"

Cadeia: `gpui → sum_tree → ztracing → zlog + ztracing_macro`, os dois últimos
GPL-3.0-or-later. Linkagem estática de objeto GPL-3.0 cria obra derivada:
**qualquer binário proprietário que dependa de `gpui` herda obrigação de
GPL-3.0** (disponibilização de fonte + share-alike), apesar do crate anunciar
Apache-2.0. O relator até ofereceu PR de 3 linhas. **A issue segue aberta, sem
resposta de mantenedor.**

Para o MyCockpit — **produto proprietário de compra única** — isso não é uma
ressalva, é um **impedimento**: a alternativa a resolver essa questão é abrir
o código do produto que a gente vende. Não é coincidência que o `egoist/waku`
seja **GPL-3.0**: é o desfecho natural de quem constrói sobre GPUI hoje.

Esse é o fim da discussão sozinho. O resto abaixo é para o caso de a issue
fechar amanhã.

### 3.4 "Instant launch, no Electron" — quanto disso já é nosso de graça?

Todo. O discurso do Waku é contra **Electron**, e nós não somos Electron.

| | Electron (Xirp, Orca) | **MyCockpit (Tauri/WKWebView)** | GPUI (Waku) |
|---|---|---|---|
| bundle | Xirp: **474 MB** (medido em `competitors-xirp.md`) | **21 MB** (`builds/test/latest/Frota.app`, medido) | binário Rust; sem release público pra medir |
| RAM na abertura | ~450 MB (benchmarks 2026) | ~85 MB (classe Tauri) | menor |
| motor | Chromium + Node embarcados | **WKWebView do SO** (zero embarcado) | Metal direto |

Ou seja: **21 MB contra 474 MB do concorrente do Spotify.** A parte do pitch
do Waku que diz "no Electron, instant launch" já é nossa, e foi paga há
tempos. O único delta real que GPUI ofereceria sobre nós é o teto de frame
(120 fps garantido vs. o que o WKWebView entrega) — e é aí que a análise vira
contra o argumento, na §4.

---

## 4. O que nos morde de verdade — e por que GPUI não conserta

> **Ressalva de método.** Procuramos o "laudo de perf" em `docs/`, `.mycockpit/`,
> `spikes/` e no histórico: **ele não existe como documento no repo.** Há três
> vestígios — o commit `0475406` ("janela de renderização em conversas longas",
> 1 arquivo, +20/-3), dois comentários citando um item **"F12"** órfão
> (`Markdown.tsx:173`, `MessageList.tsx:1985`) e o ADR-035, que fala de FPS mas
> do *Escritório*/Pixi, não do chat. **Então o diagnóstico abaixo foi
> re-derivado do código, com file:line** — e saiu pior do que a memória dizia.
> Registrar aqui é o que impede o "F12" de ficar órfão de novo.
>
> Medições reais que existem: **665 KB de items** já observados num fio
> (mensagem do commit `0475406`) e **1,9 MB / 1.476 itens** na maior conversa
> real desta máquina (`docs/companion-plan.md:107-119`).

### 4.1 A causa raiz: o array renasce a cada token

O gatilho é o reducer de `text_delta`: **`store/chat.ts:882` faz
`c.items.map(...)`**, realocando o array inteiro **a cada token**. A partir daí
toda memoização a jusante que dependa de `[items]` é invalidada em todo delta.

Cascata medida — **10 varreduras O(N) sobre o fio inteiro, mais uma O(N²), por
token**:

| # | Passe | file:line |
|---|---|---|
| 1 | `c.items.map(...)` no reducer (a origem) | `store/chat.ts:882` |
| 2 | `useMemo(deriveTaskPlans(items))` | `ChatPanel.tsx:214` |
| 3 | `items.findLast(...)` — **sem memo** | `ChatPanel.tsx:215` |
| 4 | `useMemo(buildNodes(items))` — reconstrói todo o modelo de nós | `MessageList.tsx:2637` |
| 5 | `deriveTaskPlans(items)` — **duplicado do #2** | `MessageList.tsx:2638` |
| 6 | `items.findLast(...)` — **sem memo, duplicado do #3** | `MessageList.tsx:2639` |
| 7 | `feedbackTextByResult(items)` | `MessageList.tsx:2648` |
| 8 | `pendingDeferred(items)` | `MessageList.tsx:2652` |
| 9 | `items.forEach` → `attachmentRead(items, i, …)`, que varre de `i` até o fim (`lib/attachmentRead.ts:43`) — **O(N×A), pior caso O(N²)** | `MessageList.tsx:2656-2668` |
| 10 | `new Map(items.map(...))` (tsById) | `MessageList.tsx:2685` |
| 11 | `groupByAuthor(visible)` — **sem memo nenhum** | `MessageList.tsx:2679` / `messageGroups.ts:85` |

Dois desses passes são **trabalho literalmente duplicado** entre pai e filho
(#2/#5 e #3/#6). E dentro de cada `ToolGroup` há mais O(N²) locais:
`MessageList.tsx:739` (`nodes.filter(… !activeNodes.includes(…))`), `:744`, e
`:2270` (`ctx.taskPlans.find(...)` por nó de plano).

**A janela de 150 não corta nada disso** — ela corta o *render*, não o
*cálculo*: os 11 passes correm sobre `items` completo, antes do slice.

### 4.2 Os dois `memo` do MessageList não funcionam

Este é o achado mais desconfortável, porque o código **documenta a intenção
certa e entrega o oposto**:

- **`MessageItem`** (`MessageList.tsx:1986`, memo'd) recebe
  `reads={ctx.attReads}` (`:2341`, `:2360`). `attReads` é um **objeto novo a
  cada token** (`:2656`). `memo` compara raso → **todo `MessageItem`
  re-renderiza a cada token**. O comentário em `:1993-1995` diz que `reads` vem
  pronto justamente "pra não matar a memoização"; o efeito é exatamente o
  contrário.
- **`ToolLine`** (`:309`, memo'd) recebe `node` derivado de `buildToolForest`
  (`:910`, dep `[tools]`), e `tools` é array novo a cada `buildNodes` →
  **memo quebrado por token também**.
- **`GroupRow`** (`:2479`) **não é memoizado** e recebe `ctxBase`, objeto
  literal recriado a todo render (`:2688`).

Placar do arquivo: **2 `memo`** (ambos inertes na prática), **10 `useMemo`**
(quase todos invalidados por token), **0 `useCallback`**, em **2.755 linhas**.

### 4.3 Markdown: melhor do que se supunha, mas a bolha viva ainda paga

Aqui a memória estava **errada e a favor do código**: `common/Markdown.tsx:174`
é `memo(...)` com prop única `text: string`, e string compara por valor. Logo
**blocos de prosa já assentados NÃO reparsam**, mesmo com `buildNodes`
recriando a string via `seg.texts.join("")` (`messageNodes.ts:222`). O que
segura a tela hoje é esse memo — é ele que compensa os memos quebrados da §4.2.

O que resta: **a bolha em streaming reparsa e re-highlighta o texto acumulado
inteiro a cada token** (O(len²) na mensagem viva), e com
`rehypeHighlight { detect: true }` (`Markdown.tsx:184`) cada passada ainda roda
auto-detecção de linguagem em todo bloco de código.

### 4.4 O penhasco dos 150

`MessageList.tsx:94` — `const CHAT_WINDOW = 150`; `:2673-2674` cortam para os
últimos 150 nós. Três consequências:

- **Não temos virtualização.** Confirmado em `package.json` **e** em `bun.lock`:
  zero ocorrências de `react-window`/`react-virtuoso`/`@tanstack/react-virtual`/
  `virtua`. `CHAT_WINDOW` é um *cap*, não janela deslizante.
- **É limite de nós** (pós-`buildNodes`), não de itens.
- **`showAll` é um penhasco de mão única.** O botão "Mostrar N itens
  anteriores" (`:2695`) desliga a janela **permanentemente na visita** e
  derruba a única proteção existente — monta todos os nós de uma vez, sem
  virtualização. É exatamente o cenário que o Waku vende ("scrolling through
  years of transcript") e o único onde a comparação nos é desfavorável de fato.

### 4.5 O argumento decisivo

**Um port ingênuo para GPUI com esses mesmos 11 passes O(N) por token seria
igualmente travado.** GPUI acelera *rasterizar pixels*; nenhuma das nossas
faturas está na rasterização — estão em derivação de dados (§4.1), memoização
quebrada (§4.2) e parse de markdown (§4.3), que em Rust seriam O(N²) do mesmo
jeito. Aliás, em Rust seriam *piores de descobrir*: `memo` quebrado por
identidade de objeto é um bug que o React DevTools mostra e o profiler do
navegador cronometra — em GPUI, sem esse ferramental, o mesmo defeito vira
"parece lento". O `AGENTS.md` do
próprio Waku admite isso ao proibir *"row builders executing per-frame"* de
tocar FS/rede/subprocesso: eles precisaram escrever a regra porque **GPUI não
protege de trabalho por frame**. A moldura só fica rápida se o conteúdo for
barato.

Corolário incômodo: se consertarmos §4.1-4.4 e continuar travado, aí sim o
substrato é o suspeito. Enquanto não consertarmos, culpar o WKWebView é
diagnóstico preguiçoso — **temos dois `memo` escritos que não memoizam nada**;
esse é o estado da arte da nossa otimização hoje.

---

## 5. O custo de migrar — inviável, com os números

**É inviável.** Não "caro": inviável, e o motivo é composto.

| Peça | O que existe hoje | O que a migração exige |
|---|---|---|
| Renderer | **62.506 LOC** em **215 arquivos** TS/TSX (sem testes) | reescrever em Rust. Calibração honesta: o Waku gastou **~95k LOC de Rust** pra fazer *menos* que nós |
| Composer | Lexical + `lexical-beautiful-mentions` (**ADR-027**: o composer virou um só, textarea aposentado, cutover feito **há 4 commits**) | não existe equivalente com menção atômica em GPUI. Reescrever editor rich-text é projeto próprio |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` | `gpui-component` tem Markdown, mas não os nossos 20+ `mdComponents` customizados (`Markdown.tsx:100-170`) |
| Design system | **STYLEGUIDE.md** (regras decidíveis) + shadcn/blocks.so + Tailwind 4 + radix-ui + `index.css` como fonte de verdade dos tokens | `gpui-component` é *inspirado* em shadcn, não compatível. Retraduzir o guia inteiro para outro sistema de tokens |
| Grafo / motion / dicebear | `@xyflow/react`, `motion`, `@dicebear/*` | sem equivalente. Reimplementar |
| Testes | 2 specs Playwright + suíte vitest pt-BR (R10 no roadmap prevê expandir) | Playwright **não existe** fora do navegador. A estratégia de teste de UI vai a zero |
| A11y | herdada do WebKit (VoiceOver funciona) | **regressão total** (§3.2) |
| Licença | proprietário, compra única | **§3.3 exige abrir o código** |

Some-se: **jogar fora 414 commits de trabalho** para chegar, na melhor das
hipóteses, ao *mesmo produto* com frame budget melhor — enquanto o problema
real (§4) continua não resolvido, porque ele viaja junto com a gente.

E o item que ninguém contabiliza: **o loop com agentes**. Não é que agente não
escreva Rust — o Waku prova que escreve. É que o nosso loop hoje é
`vite` HMR em milissegundos + specs em segundos; o deles é *"rebuilds, signs
and relaunches the debug app"* a cada mudança, com a regra explícita de que
compilar não é evidência. Trocar iteração sub-segundo por rebuild-assinar-
relançar em um projeto de um mantenedor é o tipo de imposto que não aparece na
planilha e mata o cronograma.

---

## 6. O caminho do meio — existe, é barato, e é o que resolve

Ranqueado por (valor / custo). **P1+P2 juntos são ~1 dia e atacam a causa
raiz.**

### P1 — Consertar os `memo` que já existem (altíssimo / baixíssimo)
**Comece por aqui: é o melhor retorno por linha do repo inteiro.** Dois memos
já estão escritos, documentados e inertes (§4.2). Consertá-los é estabilizar
a identidade de duas props:
- **`attReads`** (`MessageList.tsx:2656`) mata o memo de `MessageItem`. Ou vira
  `Map` estável mutada por append, ou o `MessageItem` passa a receber só a
  entrada que lhe diz respeito (`reads.get(item.id)`), que é primitivo/estável.
- **`tools`** mata o memo de `ToolLine` pela mesma via.
- **`GroupRow` (`:2479`) ganha `memo`**, e `ctxBase` (`:2688`) sai de literal
  recriado para `useMemo` com deps estáveis.

Isso não muda arquitetura, não muda comportamento e não tem risco de regressão
visual — só faz o código entregar o que o comentário dele já promete.

### P2 — Matar a churn de identidade nas derivações (altíssimo / baixo)
As 11 varreduras da §4.1 não precisam rodar por token. Quatro táticas, em
ordem de retorno:
- **Deduplicar pai×filho**: `deriveTaskPlans` e `findLast` rodam **duas vezes**
  (`ChatPanel.tsx:214-215` **e** `MessageList.tsx:2638-2639`). Uma das duas
  sai, de graça. Os `findLast` ainda ganham memo (hoje não têm nenhum).
- **Atacar a origem**: `store/chat.ts:882` realoca o array inteiro por token
  para atualizar **um** item. Um reducer que troque só o último elemento
  (mantendo o prefixo por referência) derruba metade da cascata sozinho.
- **Derivar no store, não no render**: `feedbackTextByResult`, `pendingDeferred`,
  `attReads` e `tsById` são acumuladores — atualizar incrementalmente no append
  custa O(1) por item contra O(N) por token. `buildNodes` merece o mesmo: só o
  último segmento muda durante o stream.
- **`attachmentRead` (`lib/attachmentRead.ts:43`) é o O(N²)** — é o único item
  da lista cujo custo *explode* com o tamanho do fio, então é o que mais
  importa depois da origem.

### P3 — Markdown por blocos na mensagem viva (alto / baixo)
O `memo` de `Markdown.tsx:174` já protege as irmãs e está correto (§4.3);
falta proteger *dentro* da mensagem que cresce. Padrão consolidado (usado pelo
AI SDK): lexar o markdown em blocos (`marked.lexer` → `token.raw`) e renderizar
**um `memo` por bloco** — blocos `0..N-1` têm `raw` idêntico ao frame anterior,
`memo` retorna true, e o token novo só reparseia **o último bloco**. Transforma
O(len²) em O(len) na bolha viva. Avaliar de quebra restringir
`rehypeHighlight { detect: true }` a blocos **fechados**: durante o stream o
último bloco de código ainda não fechou, e auto-detectar linguagem a cada token
é trabalho integralmente jogado fora.

### P4 — Virtualizar e aposentar o penhasco (alto / médio)
Trocar o cap `CHAT_WINDOW = 150` por lista virtualizada de verdade, e então
**remover o botão "revelar histórico"** — com virtualização ele deixa de ter
razão de existir, e o fio inteiro fica navegável sem cliff. `react-virtuoso`
tem componente específico para conversa humano/IA (altura variável sem medição
manual, scroll de baixo pra cima, prepend de mensagens antigas, resize
automático). Ressalva honesta: altura dinâmica + reverse scroll é a área com
bugs conhecidos de flicker (existe `skipAnimationFrameInResizeObserver` como
mitigação) — por isso vem **depois**: P1-P3 reduzem a pressão e podem até
tornar esta etapa opcional. Trocar o penhasco por uma dependência nova antes de
consertar o cálculo seria pagar risco por sintoma.

### P5 — Benchmark como portão, não como sensação (alto / baixo)
O roadmap R10 já prevê "benchmarks com orçamento numérico falhando o CI" com a
regra do Orca (tecla ≤75ms mediana). **Isto vem antes de qualquer decisão de
substrato**: sem número, "está travado" é opinião, e a discussão GPUI volta a
cada seis meses. Orçamento sugerido: custo de render por token num fio de 1.000
nós, medido antes e depois de P1-P4 — e temos fios reais para o fixture
(665 KB de items; 1,9 MB / 1.476 itens).

### P6 — Colher do Waku o que não custa substrato (médio-alto / baixo)
Checkpoint por prompt em git ref oculto; fila×esteira no teclado; Sparkle com
delta binário (§1.2).

**Custo/benefício contra a migração:** P1-P5 são **dias** de trabalho em código
que já entendemos, com testes que já rodam, reversíveis por commit, sem tocar
em licença, acessibilidade ou design system — e P1 é literalmente estabilizar
duas props. A migração é *meses*, irreversível, exige abrir o código, e **não
resolve §4.1-4.3**. Não é um trade-off — é uma comparação de um lado só.

---

## 7. Comparativo de stack: os quatro estudados

| | Stack | Substrato de UI | Bundle | Veredito |
|---|---|---|---|---|
| **Orca** (stably.ai) | Electron + React, daemon próprio, 15 entry points | webview (Chromium) | grande | webview |
| **Xirp** (Spotify) | Electron + React, daemon Node, tmux | webview (Chromium) | **474 MB** | webview |
| **Buzz** (Block) | **Tauri 2 + React** + 28 crates Rust + Flutter | **webview** | — | webview |
| **MyCockpit** | Tauri 2 + React 19 | webview (WKWebView) | **21 MB** | webview |
| **Waku** (egoist) | Rust + GPUI (+ Swift) | **GPU nativa** | — | 13 dias de vida |

### "Alguém abandonou o webview?"

**Só o de 13 dias.** Três produtos com times reais atrás — incluindo o
**Spotify** e o **Block** — mantiveram webview. O Block é o caso mais duro de
ignorar: eles são uma casa de **Rust** (28 crates, 6.506 testes Rust, specs
formais em TLA+ e Tamarin). Ninguém tinha mais capacidade de escrever a UI em
Rust do que o Block. **E escolheram Tauri 2 + React** — mesmo substrato nosso.

O que isso diz, sem romantismo: **numa UI de agentes, o gargalo não é
rasterização — é protocolo, estado e evidência.** Quem tem escala gasta a
capacidade de Rust no *backend* (adapters, eventos, persistência, prova) e
deixa a UI onde a iteração é barata. Waku é a exceção que ainda não teve tempo
de virar evidência: **0 releases, 41 issues abertas em 13 dias, 1 mantenedor.**
Voltar a olhar em 6 meses é razoável; migrar por causa dele, não.

### O que Buzz faz de performance de UI que nós não fazemos

Buzz é o vizinho de porta (Tauri 2 + React, `docs/study-buzz.md`) e a resposta
honesta é: **não é técnica de render, é guarda de CI.** O que eles têm e nós
não:

- **Lints como ratchet** (`check-file-sizes-core.mjs` com `allowedLineCount`:
  arquivo novo respeita o teto, legado congela onde está). Aplicado aqui, isso
  teria impedido o **`MessageList.tsx` de chegar a 2.755 linhas** — que é
  precisamente onde as 11 varreduras da §4.1 e os dois `memo` inertes da §4.2
  se esconderam. A regra deles é explícita: *"se a guarda disparar, divida o
  arquivo — nunca suba o limite"*.
- **`dead-token-guard`**: job que grepa API morta e falha se voltar.
- 134 specs Playwright contra os nossos 2.

Ou seja, a lição de performance do vizinho mais próximo **não é "troque de
framework"**, é "ponha portão no que apodrece". Isso reforça P5 e o R6 do
roadmap.

---

## 8. Recomendação final, ranqueada

1. **Não adotar GPUI.** Impedimento de licença (§3.3: Apache-2.0 anunciada,
   GPL-3.0 na prática, issue aberta sem resposta) num produto proprietário de
   compra única; pre-1.0 com breaking changes assumidos; docs = "leia o fonte
   do Zed"; acessibilidade inexistente; e — o argumento que vale por todos —
   **não conserta nenhuma das nossas quatro faturas de performance**, porque
   elas são algorítmicas, não de rasterização.
2. **Não adotar Waku(.gg)/RSC.** Nem no app (exigiria embarcar Node, ou seja,
   reintroduzir o custo do Electron), nem no Companion (o servidor de render
   é justamente o intermediário que a arquitetura evita). Na landing, cabe —
   mas Astro/estático resolve com menos peça móvel. Já usamos o melhor do
   mesmo autor: `zustand`.
3. **Fazer P1 hoje** (horas, não dias): estabilizar `attReads` e `tools` para
   que os dois `memo` já escritos voltem a funcionar, e memoizar `GroupRow`.
   É o melhor retorno por linha do repo, sem risco de regressão visual.
4. **P2 + P3 na sequência** (~1 dia): deduplicar o trabalho pai×filho, atacar
   `chat.ts:882` na origem, derivar acumuladores no store, e memo por bloco de
   markdown. Isso é a diferença entre "está travado" e "está fluido", sem
   trocar uma linha de substrato.
5. **P5 antes de P4**: instrumentar com orçamento numérico no CI (R10), usando
   como fixture os fios reais já observados. Sem número, essa discussão volta
   em seis meses com os mesmos argumentos e nenhum dado.
6. **P4 (virtualização) por último**, e aí sim **matar o `showAll`** — o
   penhasco da §4.4 é o único ponto onde "years of transcript" nos ganha hoje,
   e é o único item da lista que traz dependência e risco novos.
7. **P6**: colher do concorrente o que é de graça (checkpoint por git ref
   oculto, fila×esteira no teclado, Sparkle com delta).
8. **Adotar o ratchet de tamanho de arquivo do Buzz (R6).** `MessageList.tsx`
   com 2.755 linhas foi o esconderijo do problema. Guarda barata, permanente.
9. **Registrar o "F12" que ficou órfão.** Dois comentários no código citam um
   achado numerado que não existe em lugar nenhum (§4). Ou o item vira linha
   em `decisions.md`, ou os comentários param de referenciar fantasma.
10. **Revisitar GPUI em ~6 meses**, com dois gatilhos objetivos, não por
    entusiasmo: (a) issue #55470 fechada **e** `gpui` ≥1.0; (b) P1-P4
    entregues e o benchmark de P5 ainda estourando o orçamento. Se (b) não
    acontecer — e a aposta honesta é que não vai — a pergunta morre por falta
    de sintoma.

### O que este estudo entrega de mais útil
Não é a avaliação de duas tecnologias: é a descoberta de que **`waku.sh` é um
concorrente direto**, nascido em 31/07/2026, vendendo a nossa sinopse com as
nossas duas integrações (stream-json e JSON-RPC). Merece entrada própria em
`docs/competitors-*.md` quando amadurecer. O que dele importa **não é o GPUI**
— é o checkpoint por prompt e o auto-update com delta.

---

## Fontes

- [waku.sh](https://waku.sh/) · [github.com/egoist/waku](https://github.com/egoist/waku) · [AGENTS.md deles](https://github.com/egoist/waku/blob/main/AGENTS.md)
- [waku.gg](https://waku.gg/) · [wakujs/waku](https://github.com/wakujs/waku) · [InfoQ 02/2026](https://www.infoq.com/news/2026/02/waku-react-framework)
- [waku.org — protocolo P2P](https://docs.waku.org/learn/waku-vs-libp2p) (homônimo, sem relação)
- [GPUI README](https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md) · [gpui.rs](https://www.gpui.rs/) · [crates.io/crates/gpui](https://crates.io/crates/gpui)
- [Zed — Leveraging Rust and the GPU to render UIs at 120 FPS](https://zed.dev/blog/videogame)
- [**Issue #55470 — contaminação GPL-3.0 do gpui**](https://github.com/zed-industries/zed/issues/55470)
- [awesome-gpui](https://github.com/zed-industries/awesome-gpui) · [gpui-component (Longbridge)](https://github.com/longbridge/gpui-component)
- [Zed — acessibilidade (discussion #6576)](https://github.com/zed-industries/zed/discussions/6576) · [issue #41138](https://github.com/zed-industries/zed/issues/41138)
- [AI SDK — Markdown chatbot with memoization](https://ai-sdk.dev/cookbook/next/markdown-chatbot-with-memoization)
- [react-virtuoso](https://github.com/petyosi/react-virtuoso) · [flicker em reverse scroll (#1083)](https://github.com/petyosi/react-virtuoso/discussions/1083)
- Internas: `docs/competitors-orca.md`, `docs/competitors-xirp.md`, `docs/study-buzz.md`, `docs/STYLEGUIDE.md`, `docs/roadmap.md`
- Evidência de perf (§4), lida no código: `app/src/components/chat/MessageList.tsx`, `app/src/components/chat/messageGroups.ts`, `app/src/components/common/Markdown.tsx`, `app/src/lib/attachmentRead.ts`, `app/src/store/chat.ts`, `app/src/components/chat/ChatPanel.tsx`; commit `0475406`; `docs/companion-plan.md:107-119`
</content>
