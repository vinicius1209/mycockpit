# Fluidez do fio: catraca, perfil e virtualização (plano)

> Status: **F1 ✅ · F2 ✅ (09/09/2026)** · **F3 ✅ (29/09/2026, ADR-291: a
> maior fala real reparsa 166 caracteres por token, contra 5.299 antes)** ·
> F4 aberto. Nasce do reestudo do GPUI
> pedido nesta data: o bloqueio de licença do GPUI caiu em 01/09/2026 (8 dias atrás), e a
> pergunta "trocar de substrato?" voltou. A resposta continua **não**, mas por
> custo/benefício, e não mais por impedimento. Este plano existe porque a
> resposta honesta a "então melhora o que temos" precisa de um documento.
>
> Ele fecha os três itens que a `perf-fio-plan.md` deixou explicitamente em
> aberto (§4 e §5 de lá): o medidor nunca foi commitado, o perfil do estado
> atual nunca foi levantado, e P4 (virtualização) nunca foi entregue.
>
> **CORREÇÃO DE PROJETO (09/09/2026, feita durante o F1 e mandando sobre o
> texto original do §3).** O plano previa catraca de TEMPO (`perf-baseline.json`
> com ms por token). Ao implementar ficou claro que isso não podia funcionar: o
> CI não é o M1 Pro onde a frente foi medida, e o próprio `perf-fio-plan.md`
> registra `buildNodes` oscilando 0,58 → 0,82 ms sem nenhuma mudança de código.
> Uma guarda de tempo daria falso positivo e seria desligada em duas semanas.
>
> O que foi entregue no lugar são **contadores determinísticos**, idênticos em
> qualquer máquina, que medem as invariantes que a frente anterior comprou em
> vez do relógio: quantos nós ganham identidade nova por token, quantas
> entradas do mapa de selos renascem, de onde a dobra recomeça, e quantos itens
> as derivações escopadas varrem. O tempo de parede continua sendo medido, mas
> só para PERFILAR (F2), nunca para reprovar build. É guarda mais forte, não
> mais fraca: asserção exata em vez de "não piorou muito".

## 0. A decisão em uma frase

**Catraca antes de otimização, e desacoplamento antes de virtualização.** A
frente de 13-14/08 baixou o custo por token de 1,028 ms para 0,223 ms e não
deixou nada que impeça isso de voltar; virtualizar por cima de um transcript
que ainda navega por `getElementById` seria trocar um penhasco conhecido por
três regressões silenciosas.

## 1. A dor

Três dores, e **só uma é de render**. Isso importa porque a tentação é atacar
a terceira primeiro.

### 1.1 Os ganhos de perf não têm catraca (a mais cara)

Toda a frente anterior foi medida com um harness que roda 200 `text_delta`
sobre um fio real de 665 KB e divide. **Esse harness não está no repositório.**
O que foi commitado são as provas de CORREÇÃO (`messageNodes.chave.test.ts`,
`messageNodes.incremental.test.ts`, `messageNodes.identidade.test.ts`,
`threadWindow.test.ts`), que garantem que a dobra incremental diz a mesma coisa
que a dobra inteira, mas **não medem nada**.

Consequência prática: uma prop que volte a nascer com identidade nova por token
não quebra teste nenhum. Ela volta como "parece que ficou lento", seis meses
depois, sem número, e a discussão sobre substrato reabre exatamente como
reabriu hoje. Os 13 lints do `bun run check` guardam o design; **nada guarda a
fluidez**.

### 1.2 O perfil atual é desconhecido

`perf-fio-plan.md` §4 registra, com todas as letras: *"Depois da Etapa B
ninguém remediu o share de cada passe. Quem for atacar o próximo gargalo mede
primeiro."* As tabelas de lá são o A/B de cada etapa, medidas em réguas
diferentes e não comparáveis entre si. Hoje ninguém sabe o que é 100% do frame.

Há duas dívidas nomeadas esperando esse número:

- **`firstDiff` é O(n) por frame** (`nodesMemo.ts`): compara `prev.items[i] ===
  items[i]` do índice 0 até divergir. No streaming normal (só o último item
  muda) isso varre o fio inteiro por token. É barato (comparação de ponteiro,
  zero alocação) e some no ruído hoje; num fio 10× maior é o próximo gargalo.
- **`taskPlansOf` e `pendingDeferred` seguem O(N) por token**, de propósito:
  escopá-los à janela produziria teatro de estado ("não há trabalho diferido"
  porque o item saiu da janela). Só caem virando derivação incremental.

Nenhuma das duas deve ser tocada antes de (1.2) dizer quanto elas custam.

### 1.3 O penhasco do `showAll`

`useStableNodes.ts:20` define `CHAT_WINDOW = 150`, e `JANELA_INICIAL = 40`
cobre a primeira pintura (a cauda é o que importa: você aterrissa no fim). Isso
é um **cap**, não uma janela deslizante: `MessageList.tsx:1657-1659` corta com
`nodes.slice(hiddenCount)`, e o botão "Mostrar N itens anteriores" põe
`showAll = true` (`:1655`), que **desliga o cap permanentemente na visita** e
monta o fio inteiro num commit. Num fio de 3,18 MB são 547 nós de uma vez, cada
nó de prosa passando por `react-markdown` + `remark-gfm` + `rehype-highlight`.

É o único ponto onde o argumento "scrolling through years of transcript" nos
ganha de verdade.

## 2. O que NÃO está em jogo: o teto de frames

Registrado aqui para não voltar como pedido: **"quanto mais frame melhor" tem
um teto físico, e nesta máquina ele é 60 Hz.**

- Display principal medido: **DELL E2225HSM, 1920x1080 @ 60,00 Hz,
  `Main Display: Yes`**. O painel ProMotion (Liquid Retina XDR, 120 Hz) é o
  **secundário**.
- Logo: nenhum substrato de render, GPUI incluído, entrega mais que 60 fps na
  tela onde o app vive hoje.
- O cap de 60 fps que o WKWebView impunha ao `requestAnimationFrame` **foi
  removido no macOS 26**; esta máquina roda **26.3**. O argumento "webview
  trava em 60" não se aplica mais aqui. (Plano B para máquinas em macOS 13-15:
  `tauri-plugin-macos-fps`, 0.1.0, mar/2026. Não é necessário nesta.)

**Portanto o objetivo correto não é "mais frames", é "não perder os que
existem".** Com 60 Hz o orçamento é **16,7 ms por frame**, e o nosso próprio
detector já define hitch como frame acima de **50 ms** (`lib/fleet/perf.ts`,
`PERF_HITCH_MS`), ou seja, três frames perdidos. Fluidez aqui é reduzir
trabalho por frame. É o que este plano faz.

## 3. F1 — O medidor entra no repo e vira guarda ✅

> Entregue em 09/09/2026. Ver a correção de projeto no cabeçalho: contadores
> determinísticos no lugar da catraca de tempo.

**O que existe agora:**

- **`app/src/test/fio-real.json`** — o fio REAL de **1.885 itens** (2,23 MB), o
  mesmo do `perf-fio-plan.md`. Extraído por **`scripts/extrair-fio-real.mjs`**,
  que é a proveniência: sem ele o arquivo seria um blob que ninguém sabe
  refazer. Payload real não é preciosismo aqui — `continuesProse`
  (`messageNodes.ts:171`) decide a costura de prosa lendo o CONTEÚDO do texto
  (último caractere, caixa da primeira letra, marcador de markdown), então
  prosa fabricada mudaria a contagem de nós e a guarda passaria a medir outra
  coisa (ADR-016).
- **`app/src/components/chat/fio.bench.ts`** — o medidor. Roda a cadeia de
  derivação do `MessageList` por N tokens, com os mesmos memos que o React
  guardaria em `useRef`. Usa o **reducer real** (`reduceItems`), não uma
  imitação: metade do contrato protegido é dele.
- **`app/src/components/chat/fio.fluidez.test.ts`** — a guarda, 9 casos.
- **`bun run check:fluidez`**, dentro de `bun run check` e como **passo próprio
  na CI**, antes da suíte inteira. Falha de fluidez precisa ser legível como
  tal, não enterrada em 3.656 testes — a mesma razão que já justifica o job
  separado das guardas de estilo.

**Os alvos fixados (fio real, 201 tokens):**

| contador | JANELA | showAll | o que protege |
|---|---|---|---|
| nós visíveis com identidade nova por token | **1** | **1** | P1 (era 149/149) |
| entradas de `attReads` renascidas | **0** | **0** | P1, o `memo` do MessageItem |
| `rebuiltFrom` (de 395 nós) | **≥ 392** | ≥ 392 | Etapa B (faixa de 3 nós) |
| itens varridos pelas derivações escopadas | **≤ 562** | 1886 | Etapa A (era 1.885) |

**A guarda foi PROVADA, não só escrita.** Duas regressões deliberadas, aplicadas
e revertidas:

| regressão | efeito medido |
|---|---|
| reducer volta ao `items.map` (desfaz P3) | nós novos **1 → 91** (janela) e **1 → 299** (showAll); `rebuiltFrom` **392 → 0** |
| `attachmentReadsByItem` ignora o mapa anterior (desfaz P1) | entradas renascidas **0 → 1206** (janela) e **0 → 2412** (showAll) |

Sem essa prova a guarda seria decorativa: a asserção de `attReads`, por
exemplo, era vazia até o contador `attReadsEntradas` entrar (o fio tem 15
anexos, 6 dentro do sufixo varrido; sem checar isso, "0 novos de 0 entradas"
passaria para sempre).

## 4. F2 — Perfil do estado atual ✅

> Entregue junto com o F1 (o medidor já devolve os tempos). **M1 Pro,
> mediana de 201 tokens sobre o fio real. Régua desta medição; não comparar
> com as tabelas do `perf-fio-plan.md`, que são de outras.**

**Total por token: 0,2568 ms na janela · 0,3209 ms com `showAll`.** Coerente
com os 0,223 / 0,340 ms que a Etapa B mediu, o que dá confiança no medidor.

| passe | ms/token (janela) | share |
|---|---|---|
| **`taskPlansOf`** | **0,1149** | **45%** |
| `feedbackTextByResult` | 0,0318 | 12% |
| `buildNodes` | 0,0306 | 12% |
| **`pendingDeferred`** | **0,0290** | **11%** |
| `attReads` | 0,0223 | 9% |
| `tsForGroups` | 0,0147 | 6% |
| `groupByAuthor` | 0,0066 | 3% |
| `windowStartIndex` | 0,0039 | 2% |
| `reducer` | 0,0021 | 1% |
| `reuseNodes` | 0,0008 | <1% |
| `visibleThreadItems` | 0,0002 | <1% |

**A resposta que o F2 existia para dar, e ela contraria a expectativa do plano
anterior:** o próximo gargalo **não é `firstDiff`**. São `taskPlansOf` +
`pendingDeferred`, juntos **56% do frame** — exatamente as duas derivações que
o `perf-fio-plan.md` §4 declarou não-escopadas **de propósito** (escopá-las à
janela produziria teatro de estado: "não há trabalho diferido" só porque o item
saiu da janela). Elas continuam O(N) por token.

Consequência para a fila: **não mexer em `firstDiff`** (a dívida que parecia
óbvia custa 1% do frame e o conserto acopla store e render). Se alguém for
atacar custo por token de novo, o alvo é derivação incremental dessas duas,
preservando o escopo do fio inteiro que a corretude exige.

Ressalva honesta: 0,2568 ms por token, num orçamento de 16,7 ms por frame
(§2), é **1,5%**. O custo por token não é onde a fluidez se perde hoje — é o
que o F4 ataca (montagem e scroll) — e, principalmente, o markdown da bolha
viva, que este perfil NÃO mediu (ver §4.1). O valor do F1 não é acelerar, é **impedir a
volta** dos 1,028 ms.

## 4.1 REVISÃO (09/09/2026): o perfil do F2 estava incompleto, e isso reordena a fila

**Correção do que eu mesmo concluí no F2.** O medidor do F1 roda a cadeia de
DERIVAÇÃO (store + memos + escopo). Ele não roda o render do React, e portanto
**não mede o parse de markdown** — que acontece dentro do `<Markdown>` e é
custo POR TOKEN igual aos outros. Concluir "0,2568 ms por token = 1,5% do
orçamento" com esse dado foi medir metade do frame e falar do frame inteiro.

### O que a medição faltante diz

`Markdown` é `memo` com prop única `text: string` (`Markdown.tsx:370`), então
bolha assentada não reparsa — isso está certo e é o que segura a tela hoje.
**Mas a bolha VIVA reparsa o texto acumulado inteiro a cada token**, e não há
caminho de texto puro durante o streaming: o nó de prosa entra em
`<Markdown text={n.text} />` (`MessageList.tsx:1435`) a todo delta.

Medido na mesma cadeia que o `react-markdown` roda (remark-parse + remark-gfm +
remark-rehype + rehype-highlight), sobre as bolhas REAIS do fio de referência,
com delta de 4 caracteres:

| bolha (real) | tamanho | hoje, ms/token | com memo por bloco | ganho |
|---|---|---|---|---|
| p50 | 250 | **0,748** | 0,316 | 2,4× |
| p90 | 1.883 | **1,028** | 0,224 | 4,6× |
| p99 | 5.484 | **2,578** | 0,200 | 12,9× |
| máxima | 10.395 | **4,531** | 0,380 | 11,9× |

Comparação que importa: **a cadeia de derivação inteira custa 0,2568 ms/token.
O parse da bolha viva custa de 0,75 a 4,5 ms/token** — de 3× a 18× mais que
tudo o que a frente de 13-14/08 otimizou. No orçamento de 16,7 ms por frame
(§2), a bolha máxima come **27% do frame sozinha**, antes de reconciliação,
layout e paint.

E é **O(len²) acumulado**: transmitir a mensagem de 10 KB custa 11,8 segundos
de parse somados ao longo dos 2.598 tokens.

Nota de método, para não superinterpretar: medi o pipeline unificado, não o
`react-markdown` (que ainda soma `toJsxRuntime`) nem a reconciliação. **Os
números acima são piso, não teto.** Delta de 4 caracteres é suposição; o que
não depende dela é a forma O(len²).

### Um negativo útil

Testei se `rehypeHighlight { detect: true }` era o culpado: **não é**. Sem
highlight nenhum o custo é o mesmo (2,65 vs 2,49 ms). **Ressalva honesta: as
duas bolhas medidas têm ZERO cercas de código**, então esse teste é
inconclusivo para mensagens com código, que é justamente o que um agent
escreve. Não use isto para descartar `detect` sem medir de novo com cercas.

### Três itens do estudo de 13/08 que ficaram órfãos

A revisão foi atrás do rastro e achou perda documental, não só técnica:

1. **"Markdown por blocos na mensagem viva" nunca foi entregue.** Ele existe
   como recomendação P3 em `study-waku-gpui.md:381`, e **em nenhum outro
   lugar**: nem plano, nem ADR, nem código. O `perf-fio-plan.md` reusou o
   rótulo "P3" para outra coisa (o reducer). **O item se perdeu na
   renumeração** — é a lição de processo desta revisão, e a razão de o item
   abaixo NÃO reusar rótulo.
2. **"F12" continua órfão.** Dois comentários no código (`Markdown.tsx:369`,
   `MessageList.tsx:1137`) citam um achado numerado que não existe em lugar
   nenhum. A recomendação #9 do estudo mandava registrá-lo; não foi feito.
3. **P6 (checkpoint por git ref oculto, fila×esteira no teclado, Sparkle com
   delta binário)** não aparece em `roadmap.md` nem em `packaging.md`.

### A fila revisada

**F3 passa a ser o markdown; a virtualização vira F4.** A justificativa é
puramente de evidência: o markdown é 3× a 18× o custo de tudo o que já foi
otimizado, é uma mudança local e reversível, e não depende de desacoplar nada.
A virtualização continua valendo (o penhasco do `showAll` é real, e é de
MONTAGEM), mas ela é a peça cara, com dependência nova e três acoplamentos a
desfazer antes.

## 5. F3 — Markdown por blocos na bolha viva ✅

> Entregue em 29/09/2026 (ADR-291). `blocosDaMensagem` corta em blocos de
> topo e o `MarkdownRico` é `memo` por bloco, só na bolha viva. A cerca aberta
> segura o resto no mesmo bloco (a primeira armadilha abaixo), e o corte é
> feito sobre o texto do NÓ, que é o que o `Markdown` recebe (a segunda). O
> medidor é `Markdown.fluidez.test.tsx`, dentro do `check:fluidez`: conta os
> caracteres que passam pelo pipeline por token, e reprova com 5.299 quando a
> divisão é desligada.

> **Era o "P3" de `study-waku-gpui.md:381`, perdido quando `perf-fio-plan.md`
> reusou o rótulo.** Não reusar rótulo é regra desta frente daqui pra frente.

Lexar o markdown em blocos e renderizar **um `memo` por bloco**: os blocos
`0..N-1` têm conteúdo idêntico ao frame anterior, o `memo` corta, e o token
novo só reparsa **o último bloco**. Transforma O(len²) em O(len) na bolha viva.
É o padrão consolidado do AI SDK.

**DoD:** o custo por token da bolha viva para de crescer com o tamanho da
mensagem (medido com a máquina do F1, estendida para cobrir o parse); zero
mudança visual; blocos assentados continuam sem reparsar.

**Duas armadilhas a checar antes de fechar:**

- **Bloco de código ainda ABERTO durante o stream.** A cerca não fechou, então
  o último bloco muda de natureza a cada token. Medir se vale suprimir o
  highlight enquanto a cerca está aberta (e ver a ressalva do negativo acima:
  falta medir com cercas de verdade).
- **A costura de prosa.** `buildNodes` junta itens de texto num nó só via
  `continuesProse`. O corte em blocos tem que ser feito sobre o texto do NÓ,
  não do item, senão o memo por bloco desalinha do que a tela pinta.

## 6. F4 — Virtualização, em três etapas

**Valor: alto. Custo: médio. Não começa antes de F1 verde e F3 entregue.**

O que impede virtualizar hoje **não é o React nem o webview**: são cinco
acoplamentos nossos, e três deles são de COMPORTAMENTO, não de performance.
É por isso que "instalar `react-virtuoso`" não é um plano.

| # | Acoplamento | Onde | Por que quebra |
|---|---|---|---|
| 1 | Régua navega por DOM | `TurnScrubber.tsx:322-325` (`getElementById` + `scrollIntoView`) e `:286-316` (`IntersectionObserver` sobre nós montados) | nó desmontado = pip que não navega e destaque de turno ativo que some |
| 2 | Ancoragem mede `scrollHeight` real | `useChatScroll.ts` (`ro.observe(contentEl)`, `scrollTo({top: el.scrollHeight})`) | com virtualização a altura é ESTIMADA; a política de seguir e o virtualizador brigam pela mesma medida |
| 3 | Altura muda DEPOIS de montar, e é a regra | linha de ferramenta cresce quando o resultado volta, diff abre, imagem mede | altura dinâmica + scroll reverso é a área com flicker conhecido em qualquer virtualizador |
| 4 | Zoom do transcript | `ScaledMessageList.tsx` (`zoom` CSS, não `transform`) | cache de altura em px precisa invalidar inteiro quando a escala muda |
| 5 | Busca e seleção nativas | não temos busca própria no fio (conferido) | Cmd+F do WebKit só acha o que está montado; seleção do começo ao fim se parte |

### F4a — Desacoplar a régua do DOM

`TurnScrubber` passa a se orientar por **índice de nó e offset conhecido**, não
por `getElementById`. Ganho imediato, **antes de qualquer virtualização**: hoje
a régua cobre só a janela de 150 (documentado no cabeçalho dela como degradação
honesta); desacoplada, ela pode cobrir o fio inteiro, que é o que um minimapa
deveria fazer.

**DoD:** navegar para um turno fora da janela funciona; o destaque do turno
ativo continua correto; teste cobrindo turno não montado.

### F4b — Busca no fio

Virtualizar sem busca própria é **regressão de função**, não otimização: hoje o
Cmd+F do WebKit acha em toda a janela pintada. A busca precisa existir **antes**
de a virtualização desmontar nós, e é feature que uma ADE quer de qualquer
jeito.

**DoD:** busca acha em item fora da janela e navega até ele; realce sobrevive à
troca de janela.

### F4c — Virtualizar, atrás de flag

Só aqui entra a dependência. `react-virtuoso` tem componente específico para
conversa (altura variável sem medição manual, scroll de baixo pra cima, prepend
de histórico), e é o que tem a superfície mais próxima do nosso caso.

- Entra **atrás de flag**, com o caminho atual intacto ao lado.
- F1 prova o antes/depois nos quatro cenários que a Etapa B já usa (JANELA,
  showAll, MISTO, e o piso adversarial).
- `useChatScroll` é adaptado, **não reescrito**: a política "quem manda é a
  intenção, não a posição" é ADR-122 e continua valendo. O que muda é de onde
  vem a medida do fim.
- **Só depois de estável a flag some e o `showAll` é removido** — com
  virtualização o botão "Mostrar N itens anteriores" perde razão de existir, e
  é aí que o penhasco de §1.3 morre.

**DoD:** fio de 3,18 MB navegável do início ao fim sem cliff; F1 verde;
nenhuma regressão nos e2e de coluna do fio (`coluna-do-fio.spec.ts`); zero
mudança visual.

## 7. Fora de escopo (declarado)

- **Trocar de substrato de UI.** GPUI não é adotável em pedaço: ele é dono da
  janela, do event loop e do ciclo de vida (`Application::new().run(...)`), o
  que elimina qualquer estratégia incremental. E não conserta nenhuma das três
  dores de §1, que são de derivação e acoplamento, não de rasterização.
- **Perseguir 120 fps.** §2: teto físico de 60 Hz no display principal.
- **Mexer em `firstDiff`, `taskPlansOf` ou `pendingDeferred`** antes de F2 dar
  o número.

## 8. Guardas da frente

- **Zero mudança visual é requisito**, não efeito colateral, em F1, F2, F3 e F4a.
  F4c pode mudar comportamento de scroll, e por isso entra atrás de flag.
- Toda função escopada **degrada para o fio inteiro** quando não reconhece a
  chave, nunca para uma fatia curta. Errar para menos é dado sumindo da tela,
  que é pior que lentidão. (Invariante da Etapa A; continua valendo.)
- `MessageList.tsx` está em **1.788 linhas** e a baseline do ratchet **só
  desce**. Crescer exige extrair, como a Etapa A fez ao criar `threadWindow.ts`.
- A invariante de key (`messageNodes.chave.test.ts`) é a licença de tudo que
  escopa por sufixo. Nenhuma etapa daqui pode mudá-la sem esse teste falhar.

## 9. Riscos

| Risco | Mitigação |
|---|---|
| Guarda de tempo com falso positivo é desligada e some | F1 mede passe determinístico, não frame; margem generosa; teste da própria guarda no DoD |
| F4c traz flicker de altura dinâmica | flag; F1 como juiz; `showAll` só morre depois de estável |
| Virtualizar quebra seleção contínua do transcript | F4b entrega busca antes; seleção parcial é aceita e declarada |
| F4a/F4b crescem sem F4c acontecer | os dois têm valor sozinhos (régua cobrindo o fio inteiro, busca no fio) |
