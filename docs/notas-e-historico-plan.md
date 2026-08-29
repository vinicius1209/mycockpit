# Notas, coluna larga e histórico do fio — plano

> **Correção de direção (29/08/2026, ADR-123):** a paleta continua existindo,
> mas a tinta cheia da frente P saiu. Cor de nota virou marcador categórico; a
> folha voltou a ser neutra e a gaveta de uma nota cresceu para privilegiar o
> editor. Este bloco manda sobre as propostas de "papel vivo" abaixo.

> Status (29/08/2026, build t310, tudo na `main`):
>
> | frente | estado |
> |---|---|
> | **R** — régua por container query | ✅ ADR-111 |
> | **N1–N3** — gaveta A + B, escopo explícito | ✅ ADR-112, com débito nomeado |
> | **N5** — a nota chega no agente pelo `@` | ✅ ADR-114 |
> | **N6** — anexo na nota | ✅ ADR-116 |
> | **N7.1/7.2** — `@` ranqueado + índice | ✅ ADR-115 |
> | **M** — a máquina na faixa de status | ✅ ADR-118 |
> | **P** — categoria de nota | ✅ ADR-123 revisa ADR-117 (paleta como marcador) |
> | **N7.3/7.4** — símbolo e menção resolvida | proposta |
> | **L** — bloco largo escapa da coluna | proposta |
> | **H** — o trilho vira histórico do fio | proposta (a de maior valor) |
>
> Entregáveis de desenho que este plano consome:
> `docs/mocks/notas-apple.html` (5 variantes) e `docs/mocks/notas-README.md`.
>
> **Fora deste plano, mas da mesma leva:** ADR-119 (review do "Adicionar
> projeto") e ADR-120 (a pasta do projeto pode sumir).
>
> **Frentes vivas que este plano NÃO toca** e das quais só depende por leitura:
> MISSÃO (`components/mission/*`), envio (`lib/fleet/send`), motores
> (`adapters.rs`). Onde precisa de algo delas, descreve o **contrato**.

---

## 0. Resumo executivo

1. **A gaveta de notas vai pro desenho A com B como degradação**, não A puro.
   A lista+folha é o único desenho onde busca e "primeira linha vira título"
   cabem; mas com ≤2 notas a lista é moldura vazia, e aí sobra a folha. Painel
   de 1 nota tem tamanho de 1 nota (§5).
2. **O gatilho fica na barra de título.** O escopo das notas é MISTO
   (`selectNotesFor`, `stickyNotes.ts:92`: nota da conversa OU global do
   projeto). Pendurar na aba "Conversa" prometeria escopo de conversa e
   mentiria para as globais — e a gaveta é host global, existe em Painel e
   Features, onde aquela aba não existe. O escopo entra DENTRO da gaveta, em
   seções, que é a regra que Configurações já aplica.
3. **A prosa do fio não cresce em tela larga; o que não é prosa, sim.** A linha
   já mede ~95 caracteres (teto confortável é 75), e o zoom de leitura
   (`conversationScale.ts`, 0,8→1,6) já é o botão de "crescer" — a 1,3× a
   coluna entrega ~73 caracteres, ou seja, o zoom **corrige** a medida. Quem
   sofre preso em 760px é bloco de código, tabela e diff, que rolam na
   horizontal com 500px de gutter vazio ao lado.
4. **Fonte fluida por viewport está fora.** O §3 é escala fechada com guarda
   (`check-type-scale.mjs`); tamanho novo exige ADR e linha na tabela. E
   densidade que muda sozinha entre monitores é imprevisibilidade, não conforto.
5. **O histórico do fio é MENOR do que parecia, e o motivo é bom:** o resumo de
   turno por modelo **já existe e está em produção** (`lib/turnReceipt.ts`, 17
   testes) — prompt, prazo de 3s, `null` como desfecho de primeira classe,
   `helperModel: null` = desligado. Ele só não é GUARDADO: nasce no fim do turno
   de background, vai pro `useNotifs` e morre ali. O trilho-histórico é
   sobretudo **persistir e mostrar** o que já se calcula, e a linha do tempo
   determinística nem modelo precisa.

**Fechado pelo ADR-123:** a saturação deixa de disputar o corpo da nota. A cor
permanece inteira apenas no ponto e no seletor, onde funciona como categoria.

---

## Frente N — a gaveta de notas (A + B)

O que ela ERA quando esta frente abriu (ADR-112 fechou): `fixed right-4 top-14
bottom-16 w-84`, altura cheia sempre, ancorada em nada, e por ser `fixed`
abrindo por cima do painel de contexto.

Decisões posteriores que o plano registra pra não serem refeitas: a aba "Notas"
ao lado de "Conversa" foi **descartada** (aba é por conversa, e a nota pode ser
de projeto), e o post-it arrastável continua sendo a frente P, não a gaveta.

### N1 — a gaveta cabe no que tem dentro
- Sai `fixed … bottom-16`; entra popover **ancorado no chip** (`TitleBar.tsx:175`),
  alinhado à direita do gatilho, `max-h` com teto de viewport, altura do
  conteúdo. Fecha com Esc e clique fora (hoje só fecha no ✕ e no gatilho).
- Deixa de ser `fixed` sobre o layout: convive com o `ContextPanel` em vez de
  cobri-lo.
- **DoD:** com 1 nota o painel tem altura de 1 nota; com 20, rola por dentro; o
  painel nunca cobre o painel direito; Esc fecha; teste de que `open=false`
  renderiza `null` continua valendo.

### N2 — lista + folha (o desenho A)
- Duas colunas dentro da gaveta: lista (214px) + folha. **Primeira linha da
  nota vira título** (negrito) e o resto vira preview de uma linha — regra pura
  e testável (`tituloEPreview(content)`), não formatação na marra no JSX.
- Seções por tempo: **Fixadas · Hoje · Anteriores**, derivadas de `updatedAt`.
  A ordenação de `selectNotesFor` (fixadas primeiro, depois `updatedAt`) já
  entrega a base; o agrupamento é função pura ao lado.
- Busca por texto na lista (filtra, não navega).
- **DoD:** núcleo puro com teste (título/preview de nota vazia, de uma linha, de
  várias, com markdown); nenhuma nota some do agrupamento (soma das seções ==
  total filtrado).

### N3 — degradação para B, e o escopo explícito
- **≤2 notas: a lista some** e a gaveta é só a folha, com `‹ 1/2 ›`. O limiar
  é constante nomeada e testada, não número solto no JSX.
- **Escopo na cara:** as seções separam "Desta conversa" de "Do projeto", e a
  nota nova nasce com escopo visível no rodapé (hoje `handleCreateNote` decide
  `convId: activeId` em silêncio, `StickyNotesDock.tsx:189`).
- **DoD:** nota global e nota da conversa nunca aparecem misturadas sem rótulo;
  trocar de conversa muda a seção "Desta conversa" e não mexe na "Do projeto".

### N4 — o que NÃO entra agora
Arrastar nota, canvas, cor por conteúdo, nota escrita por agente. Cada uma é
outra tese; a primeira que pedir passagem passa por mock.

---

## Frente N5 — a nota CHEGA no agente ✅ (28/08/2026)

**Decisão do humano:** nada de gatilho automático. A nota viaja quando você a
**endereça** — pelo `@` do composer ou pelo botão da própria nota, que insere o
mesmo endereço. Entregue.

- `@nota/<slug>` no mesmo idioma dos arquivos do projeto (`@src/lib/agents.ts`).
  No envio, o endereço é trocado pelo **conteúdo atual** da nota, emoldurado
  como direção do humano (mesma moldura de `lib/notes.ts`).
- O botão da nota insere o endereço, **não o texto**: colar congelava uma cópia
  que envelhecia em silêncio. Um mecanismo, duas portas.
- Menção que não resolve **não é apagada**: o agente lê um endereço que não
  achou (a verdade) em vez de receber um texto a menos sem ninguém notar.
- Sem `@nota/` no texto, o envio nem toca na lista de notas.

### N5.1 — o agente LER as notas sem elas irem no prompt (proposta)
O que fica de fora: o `renderTranscript` (memória plena, usada por fork,
handoff e pelo arquivo `.mycockpit/context/<id>.md`) não conhece as notas. Uma
seção "Notas do humano" ali dá **pull** — o agente consulta quando quiser, sem
custo por turno. É a metade barata da integração e a que sobrevive a troca de
motor.

## Frente N6 — anexo na nota ✅ (28/08/2026, ADR-116)

Você quer colar imagem na nota. O app já sabe fazer isso: `saveAttachment` grava
o blob em `app_data_dir/attachments/<convId>/<hash>.<ext>` e **só o metadado
trafega no JS** (path, nome, mime, bytes); a imagem aparece por object URL com
cache e revogação (`lib/attachments.ts`).

**A armadilha, e ela apaga dados:** `gc_attachments` varre a pasta e remove
**toda pasta cujo nome não seja de uma conversa viva**. Anexo de nota guardado
como `attachments/<noteId>/` some no próximo boot, em silêncio. Nota é de
conversa, de projeto ou de todos — `convId` não serve de chave pras duas
últimas. Então: **raiz própria** (`notes/<noteId>/`) com GC alimentado pelos ids
de nota, no mesmo molde do `ConvRef`.

**O que NÃO pode acontecer, e é regra, não preferência:**
- **Byte nunca entra na store.** A gaveta persiste em `localStorage` (cota ~5MB,
  guarda string). Base64 ali estoura a cota e serializa megabytes de forma
  síncrona na thread principal a cada mudança.
- **Object URL só da nota ABERTA**, revogado ao trocar — senão cada imagem vista
  fica pendurada na memória até fechar o app.
- **A lista nunca resolve URL.** Ela mostra "1 imagem", não a imagem.
- **Miniatura vem do Rust**, como a evidência já faz; o front não redimensiona.
- O teto de 10 MB por arquivo já existe no backend e vale aqui.

## Frente N7 — o "@" à altura de uma ADE (1 e 2 ✅ ADR-115; 3 e 4 propostas)

Hoje o `@` já tem três seções (Especialistas · Notas · Arquivos), pill atômico e
serialização estável. O que falta pra ele ser ferramenta de verdade:

1. **Ranqueamento, não substring.** O menu filtra a lista crua. Numa ADE o que
   importa é: casar primeiro no **nome do arquivo**, depois no caminho; e pôr na
   frente o que a conversa **tocou** (`files_touched` do handoff já existe) e o
   que você abriu recentemente. Hoje `@send` mostra tudo que tem "send" em
   qualquer segmento, na ordem do disco.
2. **O custo está medido e tem teto:** `list_project_files` corta em **8000**
   arquivos e a listagem inteira vai pra memória do renderer na montagem. Num
   repo grande isso é um array de milhares de strings filtrado a cada tecla.
   Ranquear sem indexar piora; o caminho é índice na montagem (mapa por
   basename) e filtro sobre o índice.
3. **Símbolo, não só arquivo.** `@parseFileTarget` levando à função, não ao
   arquivo. É o salto de "editor" para "ambiente" — e é o item caro: precisa de
   índice (o Xirp usa `rg` + Postgres embarcado; ver `docs/competitors-xirp.md`).
4. **Menção que sobrevive ao envio.** Hoje `@caminho` viaja como texto. Podia
   viajar como **referência resolvida** (caminho absoluto + linha), que é o que
   o agente precisa pra abrir sem adivinhar.

Ordem sugerida: (1) e (2) juntos — são a mesma passada e resolvem o incômodo
diário; (4) depois; (3) só com demanda provada.

## Frente M — a máquina, na faixa de status ✅ (28/08/2026, ADR-118)

O cockpit é cego para o que ele não spawnou. Medido em 28/08/2026 na máquina
do autor: **~500 MB parados** em três sessões de CLI esquecidas (11 dias, 7
dias e uma pilha do Xirp de 17 dias com o `tmux` **órfão**, `ppid=1`, segurando
um worktree). Nenhuma queimava CPU — e uma delas **reverteu um arquivo no meio
do trabalho**, que é o custo que ninguém mede.

**O que o app já faz certo, e não é isto:** o que ele spawna, ele mata.
`RunRegistry` mapeia `run_id → pid`, `kill_all()` roda na saída (Cmd-Q no meio
de um run deixaria claude/codex editando o repo headless) e o `RunGuard` é um
`Drop`, então limpa em erro e panic também. O buraco não é de gestão do que é
dele — é de **visão** do que não é.

**Por que a faixa inferior é a casa certa, pela régua dela mesma**
(`lib/statusBar.ts`): a faixa é AMBIENTE — "o que é verdade enquanto você
trabalha". Processo estranho rodando é exatamente isso, e a lista já hospeda
`worktree`, que é o mesmo gênero: **recurso deixado para trás**.

**As três regras que o desenho tem que respeitar, e elas vêm do módulo:**

1. `STATUS_BAR_KINDS` é lista **FECHADA**. O cabeçalho do arquivo é explícito:
   sinal novo entra "por decisão explícita, não por conveniência de quem tem um
   dado sobrando e uma faixa vazia na frente". Então `processos` entra por ADR,
   com linha na lista — não de contrabando.
2. **A faixa não pede nada e não pisca.** O indicador mora lá; MATAR mora atrás
   de um clique que abre painel (padrão que a faixa já usa). Nunca em lote,
   nunca automático, e com o que vai morrer dito na cara — matar processo alheio
   é destruir trabalho de alguém sem saber.
3. **Sem nada estranho, a zona não desenha NADA.** Nem "0 processos", nem
   divisor órfão — a mesma regra que o custo já segue abaixo de 2 turnos.

**O que conta como "estranho":** motor conhecido (`claude`, `codex`, `agy`,
`opencode`) + um dos dois sinais duros — `ppid=1` (órfão) ou parado há dias.
Ambos são fato, não heurística de humor.

**Não fazer:** limpeza no boot (app que mata processo sozinho ao abrir é pior
que o problema), adotar processo alheio como "gerenciado", ou esconder o que
não entendeu.

## Frente P — post-it como MODO (tinta ✅ ADR-117; a MESA continua proposta)

Decisão tomada: **papel vivo de verdade**, na referência de post-it clássico
(amarelo-ouro, limão, verde, rosa-choque, coral) — não a tinta surda do
ADR-109. Comparável no mock em `#d` (sóbria 22%) × `#d,forte` (papel 48%) ×
`#d,vivo` (post-it), nos dois temas.

Isso **altera o ADR-109** e pede linha nova no §2 do STYLEGUIDE. A ADR sai
quando P for implementada (a casa escreve ADR de coisa entregue, não de
intenção), e ela precisa carregar as três regras abaixo — as duas primeiras
apareceram no mock, não no raciocínio:

1. **Papel vivo carrega TINTA PRÓPRIA DE TEXTO.** `--note-x` ganha par
   `--note-x-fg` (molde de `--brass`/`--brass-fg`): a letra é quase-preta
   (`#1c1a14`) nos DOIS temas. Sem isso, no tema escuro a letra clara some no
   papel claro. A nota deixa de ser superfície que herda o tema e vira **ilha
   invertida**, exatamente como o botão brass já é.
2. **O papel do tema escuro NÃO é o claro escurecido — é o claro com menos
   CROMA.** Escurecer parecia óbvio (neon em tela preta cega) e reprova na
   medida: o rosa escurecido cai a **3,61:1** contra a tinta, abaixo do mínimo
   pra corpo de texto. Tirando **28% de croma** com a luz quase intacta, o
   brilho de neon some e a tinta continua legível.
3. **Contraste é medido, não julgado no olho.** Metadado e ícone a 62% do preto
   reprovam (3,10:1 no rosa); a 82% o pior papel dá 4,79:1. E o botãozinho do
   rodapé deixa de ser preto translúcido (que come o papel) e vira **etiqueta
   clara** (branco 62% sobre o papel), 11,76:1 no pior caso.

| | claro | corpo | meta | escuro | corpo | meta |
|---|---|---|---|---|---|---|
| sol | `#ffb020` | 9,51 | 6,47 | `#daa23a` | 7,63 | 5,49 |
| limão | `#d8df2a` | 12,02 | 7,69 | `#bec341` | 9,17 | 6,30 |
| verde | `#93c523` | 8,49 | 5,93 | `#8db03c` | 6,96 | 5,09 |
| rosa | `#ff63a6` | 6,28 | 4,79 | `#da6c98` | 5,45 | 4,22 |
| coral | `#ff7a59` | 6,78 | 5,05 | `#da7b62` | 5,79 | 4,44 |

O rosa da referência (`#ff4e9b`) subiu meio tom: no original o metadado batia
4,45:1 e o papel escuro reprovava. Comparável no mock em `#d,vivo` e
`#d,vivo,dark`.

4. **A contenção que salva o §2: cor viva só existe na MESA.** Na gaveta
   (frente N) a nota continua com a bolinha surda de hoje; o papel vivo aparece
   só no modo post-it, que é uma superfície que o usuário CONVOCA. Assim o
   chrome do app segue quieto e o vocabulário de estado (`st-*`) não passa a
   disputar atenção com rótulo de papel.

O custo do desenho continua de pé e não some com a cor: quatro post-its já
tapam duas frases do fio, e a mesa não tem como degradar. Por isso P é **modo**,
nunca o desenho principal.

---

## Frente L — a coluna do fio em tela larga

### L1 — bloco largo escapa da coluna
- A coluna de prosa continua em 760px (`MessageList.tsx:2137`). O que ganha
  largura é o que **não é prosa**: `pre` de código (`Markdown.tsx:69`), tabela
  (`:94`) e diff (`MessageList.tsx:178`), que hoje rolam na horizontal presos.
- Mecanismo: o bloco largo estoura a coluna até um teto (ex.: 1100px) **e só
  quando há espaço** — medido por **container query**, nunca por viewport (ver
  frente R, é o mesmo erro).
- Guardas do zoom: o `zoom` do fio já mordeu uma vez (ADR-082, porcentagem
  resolve contra o contentor já ajustado). Qualquer largura nova aqui nasce com
  teste e2e que **mede a tinta** (`elementFromPoint`), não `getBoundingClientRect`.
- **DoD:** com janela estreita nada muda; com janela larga o bloco de código
  cresce e a PROSA não; o e2e do ADR-082 continua verde e ganha um caso novo.

---

## Frente R — a régua × o trilho ✅ (28/08/2026, ADR-111)

`TurnScrubber.tsx:279` decide aparecer por `lg:` — breakpoint de **viewport** —
enquanto o espaço de que ela precisa é o do **contêiner**. Tela larga com painel
direito aberto passa no `lg` e mesmo assim não sobra gutter: a régua pinta por
cima do texto. Conserto no molde que o painel direito já usa (`TabBtn` +
`@min-[…]` em `contextPanelChrome.tsx`).
- **DoD:** com o painel direito aberto numa janela larga a régua some (ou recua),
  sem tocar no caso hoje correto.

---

## Frente H — o trilho vira histórico do fio

A variante E do mock. Não é a gaveta com outro conteúdo: é outra feature no
mesmo espaço. E começa mais perto do fim do que parece.

### H1 — a linha do tempo SEM modelo nenhum
Marcos derivados do próprio fio, determinísticos e de graça: seu pedido, turno
do agente com contagem de ferramentas e arquivos, falha e retomada, pendência,
turno concluído com duração e custo (`turn_costs` já existe). Função pura sobre
`ChatItem[]`, testada, no espírito de `deriveTurnTicks`.
- **Invariante inegociável:** o fio é a verdade. Clicar no marco **rola até o
  turno** (a régua já sabe fazer isso). O histórico nunca substitui o transcript.
- **DoD:** com `helperModel: null` o trilho é 100% útil. Nenhum marco sem âncora
  clicável.

### H2 — a frase do turno passa a ser GUARDADA
`turnReceipt` já produz a frase (`lib/turnReceipt.ts`), mas ela morre no
`useNotifs`. Persistir no fio (campo no item de fim de turno — o fio é blob
JSON em `conversations.items`, **zero migração**, mesmo padrão de `reactions?`)
e o trilho passa a mostrar o que o aviso já dizia.
- **Regra que vem de graça e precisa continuar valendo:** frase só existe pra
  turno de background (no primeiro plano você viu acontecer) e `null` é
  desfecho de primeira classe.
- **DoD:** turno antigo sem frase não quebra o trilho; a frase no trilho é
  IDÊNTICA à do aviso (uma fonte, não duas).

### H3 — "onde estamos" (a síntese da conversa)
Uma frase sobre a conversa INTEIRA, não sobre o último turno: o cabeçalho do
trilho. Mesmo motor (`suggest` + prazo + `null` honesto), mesmo knob, prompt
próprio. Recalcula com parcimônia (fim de turno, com debounce) — nunca por
token.
- **O rodapé DIZ quem escreveu.** Resumo sem autor declarado é a UI falando
  pelo agente.
- **DoD:** desligado (`helperModel: null`) o cabeçalho some e o trilho segue
  inteiro; o custo aparece onde custo já aparece.

### H4 — on-device (opcional, depois, com fallback)
Sidecar Swift com Apple Foundation Models no molde do ditado
(`src-tauri/stt/main.swift`, ADR-034), **com fallback no helper**. É otimização
de custo e privacidade, nunca ponto de partida: miramos Linux também
(`docs/competitors-maestri.md`, M2).

---

## Ordem e time

| Ordem | Frente | Quem | Por quê nessa ordem |
|---|---|---|---|
| 1 | **R** (régua × trilho) | dev + tester | Bug de hoje, 1 arquivo; e é pré-requisito conceitual de L1 (mesma regra: contêiner, não viewport) |
| 2 | **N1–N3** (gaveta A+B) | dev + tester → reviewer | Decisão já tomada e mock aprovado |
| 3 | **L1** (bloco largo escapa) | dev + tester → reviewer | Mexe no fio sob auditoria de densidade: entra sozinha, não junto da gaveta |
| 4 | **H1–H2** (histórico) | dev + tester → reviewer | Depende de nada novo; H2 reusa `turnReceipt` |
| 5 | **H3–H4 · P** | a decidir | H3 pede knob de custo; P pede a decisão do §2 |

- **`mycockpit-dev`** implementa por story, lendo este plano inteiro.
- **`mycockpit-tester`** escreve os testes pt-BR de cada DoD (núcleos puros
  primeiro: `tituloEPreview`, agrupamento por tempo, marcos do histórico).
- **`mycockpit-reviewer`** é o gate de fim de frente: bate a DoD e as guardas da
  casa (fail-closed, humano-only, agnosticismo, catraca de tamanho, §2/§3/§4).

**Uma frente por vez no mesmo arquivo.** N e H tocam superfícies distintas e
poderiam correr em paralelo; R e L1 não — L1 depende da regra que R estabelece.

---

## O que este plano NÃO faz

Canvas infinito (ADR-037 é a aposta oposta) · nota escrita por agente · quarto
canal de aviso · fonte fluida por viewport · alargar a PROSA · histórico que
substitui o fio · delegação agente-a-agente.
