# Frota — instruções para quem trabalha neste repositório

Leia isto inteiro antes de escrever a primeira linha. É curto de propósito: o
que está aqui é o que **já custou retrabalho**. O resto mora nos documentos
apontados, e o ponteiro só vale se você seguir quando o assunto for o dele.

Este arquivo é a fonte única. `CLAUDE.md` é um symlink para cá, e os agentes de
`.claude/agents/` apontam para cá. Regra nova de repositório entra **aqui**, não
em três cópias.

Blocos com regra própria têm um `AGENTS.md` ao lado do código. Eles não repetem
o que está aqui: carregam a lei daquela camada e a cicatriz que a gerou. Leia o
do bloco ANTES de mexer nele.

| bloco | quando ler |
|---|---|
| `app/src-tauri/src/AGENTS.md` | nascimento do turno, plano de MCP, sondas, cache, comando Tauri |
| `app/src/components/chat/AGENTS.md` | composer, `handleSend`, o que a pessoa vê entre o Enter e a bolha |
| `app/src/lib/tasks.AGENTS.md` | derivação dos planos e terminalidade nas três superfícies de etapas |

Regra que vale nos DOIS lados sobe pra cá. Bloco novo só ganha arquivo quando
já custou retrabalho — não se abre camada por precaução.

## O que é

**Frota** (nunca "MyCockpit" em texto que o usuário lê ou que vai num prompt),
app Tauri 2 + React 19 + TypeScript, SQLite via `@tauri-apps/plugin-sql`,
zustand, vitest. Backend Rust em `app/src-tauri`. Compra única, Mac e Linux,
local-first. É um **cockpit de decisão**: a UI mostra o estado real da frota e
pede a próxima decisão.

| onde | o quê |
|---|---|
| `README.md` | visão atual do produto e caminho de entrada para gente nova |
| `docs/architecture.md` | mapa vivo de superfícies, donos de estado e fronteiras Rust/TS |
| `docs/agent-runner.md` | contrato normalizado e histórico de evidência dos adapters; capabilities atuais moram no registry |
| `docs/STYLEGUIDE.md` | design canônico. Consulte ANTES de mexer em UI |
| `docs/decisions.md` | as ADRs. Toda decisão estrutural vira uma |
| `docs/*-plan.md` | o plano da frente. Blocos de correção no topo mandam sobre o texto original |
| `scripts/lints/` | as guardas automáticas do guia |

Planos registram a evolução da frente e podem conservar alternativas antigas.
Eles não substituem o código atual nem uma ADR posterior: primeiro leia o bloco
de correção/status no topo, depois confira `docs/decisions.md` e os call sites.

## As leis

- **Agnosticismo é mecanismo.** Código genérico **nunca** compara nome de motor
  (`agent === "claude-code"`). Pergunte ao registry de `Capabilities`
  (`src-tauri/src/adapters.rs`, espelho TS `src/lib/agents.ts`). Capability nova
  entra nos dois lados, com teste-gêmeo e teste de contrato. Na dúvida,
  `false` e degradação honesta.
- **Estado real, nunca teatro.** Nada de atividade inventada. "Rodando" falso é
  proibido; replay e restart marcam interrompido ou órfão. Custo e estado
  derivam de fonte única. O app não sintetiza uma resposta que o motor não deu.
- **Fail-open no render, fail-closed no efeito.** Evento desconhecido nunca
  quebra a tela (vira `Unknown`); efeito com pré-condição faltando aborta.
- **A decisão é humana.** Nada de despacho automático, nada de delegação livre
  entre agentes, nada de daemon fora do app. O agente pode PEDIR o gesto; quem
  confirma é a pessoa.
- **Migrações** só via `Migration` em `src-tauri/src/lib.rs`, um statement por
  migração, e **confira a versão máxima real no arquivo** antes de numerar.
  Tabela nova de frontend: `ensure*Tables(db)` + `addColumn` de
  `src/lib/db/schema.ts` (re-exportado por `src/lib/db.ts`).
- **Árvore compartilhada.** Outra frente pode estar em andamento na working
  tree. Toque só no que é da sua tarefa, nunca reverta o que não é seu, e
  **nunca afrouxe um teste existente** — se ele quebrou, o refactor está errado.

## Padrões de código

- **Stores**: zustand `create<X>((set, get) => ...)`, padrão de `store/fusion.ts`.
  Store que o watchdog ou a bandeja precisam enxergar hidrata no BOOT.
- **Watchdog**: um ticker único em `src/lib/watchdog.ts` (subscribe coalescido +
  interval). Estender, nunca duplicar. Um aviso por episódio, via `Map` de
  módulo.
- **Chat**: `useChat` é estado operacional e transcript; texto e anexos ainda
  não enviados pertencem a `useComposerDrafts`, persistidos por conversa em
  `conversation_drafts`. Nada de reintroduzir `drafts` no chat ou limpar anexo
  ao trocar de conversa. O scroll observa o wrapper real do transcript via
  `contentRef`; não volte a inferi-lo com `firstElementChild` nem use
  `scrollIntoView` em superfícies flexíveis (ADR-122).
- **Testes**: vitest ao lado do código, casos em pt-BR descrevendo
  comportamento, `now` injetável, reset de módulo no `beforeEach` (padrão de
  `watchdog.test.ts`). **Fixture com payload REAL**, colhido de stream ou
  incidente: fixture inventada esconde bug, e já escondeu (ADR-016).

## Antes de escrever UI

Toda mudança visível segue `docs/STYLEGUIDE.md`. Estas seis são as que mais
se erram, então estão inline:

1. **Nunca importe `radix-ui` cru fora de `components/ui/`.** Se falta uma
   primitiva, ela se cria em `components/ui/` e passa a ser a única porta. Foi
   assim que a gaveta de notas e o painel da faixa acabaram com **dois idiomas
   para o mesmo gesto**: um puxou Popover direto do Radix, o outro vestiu
   `DropdownMenu` de painel e teve que desarmar o foco de menu na mão.
   Consequência da regra: **duas superfícies que fazem a mesma coisa semântica
   de jeitos diferentes significam que uma delas está errada.** Antes de montar
   superfície nova, procure quem já faz esse gesto e use a mesma primitiva.
2. **Componente usado com `asChild` precisa repassar `className`, `ref` e o
   resto das props** (`{...resto}` antes do `className` próprio). Se ele
   engolir, nada quebra no compilador e tudo quebra na tela: o gatilho não
   abre, ou o painel fica transparente.
3. **Duas escalas fechadas, e nenhuma se contorna localmente.** Fonte (§3):
   11, 12, 13, 14 de corpo, mais 20/30/38 de exceção declarada; meio-pixel não
   existe; ênfase acima de 14 se faz com peso. Controle (§13): quatro degraus
   com nome, `chip` 24px · `compacto` 28px · `padrao` 32px · `destaque` 36px,
   via `<Button size>` ou `controle("chip")` de `components/ui/controle`.
   Nunca encolha fonte ou padding de um controle pra ele caber: ou o degrau
   certo é outro, ou está faltando, e degrau novo entra por ADR.
4. **Três elevações, não invente a quarta.** `shadow-md/lg/xl/2xl` são
   proibidos em componente do app. E o filete tem só dois papéis: `border`
   (aresta de superfície) e `border-border/40` (divisor interno). Opacidade
   intermediária é deriva, não decisão.
5. **Alinhe pelo GLIFO, não pela caixa** (§14). Escolha os trilhos a partir do
   conteúdo e segure os mesmos em todas as linhas do cartão; área de clique
   cresce pra fora, nunca move o conteúdo; e se o ajuste foi óptico, escreva no
   código que foi óptico, senão o próximo "corrige" pro valor redondo.
6. **Copy em pt-BR, sem travessão "—".** Use vírgula, ponto, parênteses; "·" e
   "→" são permitidos. Rótulo descreve o resultado para a pessoa, não o alvo
   interno ("Mostrar na pasta", nunca "Mostrar no Finder": também somos Linux).

## As guardas

`cd app && bun run check` roda os lints do guia, e a CI roda o mesmo job. Quando
uma guarda dispara, a saída diz o arquivo, a linha e o alvo.

- **Guarda de tamanho de arquivo disparou? DIVIDA o arquivo.** Nunca suba o
  teto, nunca edite `scripts/lints/file-size-baseline.json` à mão, nunca
  adicione exceção. A baseline **só desce**.
- **Tamanho de fonte novo exige ADR e linha no §3**, não exceção no script.
- Guardas são nossas e podem mudar, mas **por decisão escrita**, nunca por
  conveniência do momento. Somos donos do produto: mude a régua num ADR, não no
  arquivo de exceções.

## Antes de entregar

1. Suítes completas, rodadas de verdade: `cd app && bun run test`,
   `bunx tsc -b --force` a partir de `app/`, e `cargo test` a partir de
   `app/src-tauri`. **`tsc --noEmit` não substitui `tsc -b`**: o build usa `-b`,
   e já passou erro por essa fresta (teste importando `node:fs`, que o
   `tsconfig` de `src/` não conhece; para ler fonte em teste, use
   `import.meta.glob(..., { query: "?raw", import: "default", eager: true })`).
2. Grep dos call sites de tudo que mudou; liste os caminhos que mudam estado.
3. Nenhum `catch` silencioso onde alguém espera resultado.
4. Se a mudança é estrutural, escreva a ADR em `docs/decisions.md`.

## Nunca

- Comparar nome de fornecedor em código genérico.
- Despachar trabalho sem gesto humano, ou criar daemon fora do app.
- Introduzir TanStack Query em superfície que segue store + efeito.
- Mexer em número de migração sem conferir a máxima real no `lib.rs`.
- Editar uma baseline de catraca pra cima (`file-size`, `geometria`).
- Escrever "MyCockpit" em string que a pessoa lê ou que vai num prompt.
- Commitar sem que a pessoa tenha pedido.
