# Concorrente: Paseo — anatomia e provocações

> Estudo de 29/08/2026, por leitura do CÓDIGO (o repo é AGPL-3.0 e está clonado
> em `~/projetos/paseo`, v0.4.0) e da documentação interna deles. Nada foi
> copiado: o que se absorve são **regras**. Os `file:line` de `packages/…` são
> deles; os de `app/…` são nossos, e apontam onde cada lição encosta no Frota.

## O que o Paseo é

Monorepo com **daemon local** (`packages/server`) que orquestra os agentes e
serve WebSocket + MCP, e vários **clientes** que só conversam com ele: desktop
Electron, app Expo (iOS/Android/web), CLI e um SDK TypeScript. Relay E2E
opcional pro celular; Docker pra rodar o daemon num servidor. Sem telemetria,
sem login obrigatório, AGPL.

Uma frase do README que resume a tese deles: *"Everything you can do in the
app, you can do from the terminal."*

**Duas correções de premissa que a leitura do código impôs a este estudo:** o
desktop deles é **Electron**, não Tauri; e o cliente é **um único app Expo/React
Native** que roda em desktop, web, iOS e Android — no desktop é RN-Web dentro do
Electron. Essa é a decisão mais cara do repo, e volta no §5.

Comercialmente não nos ameaça na nossa (compra única, Mac/Linux, local-first);
a diferença é de **arquitetura**, e é dela que vêm as provocações.

---

## 1. A convergência de doutrina — e as três lacunas que ela expõe

O `docs/design.md` deles poderia ter sido escrito aqui. Amostra:

> *"Every visual decision serves either **act on this** or **understand this** —
> never **look at this**."*

É a nossa tese do §1 com outras palavras. Também batem: hierarquia por **peso e
cor, não tamanho** (nosso §3); um CTA de acento por superfície (nosso orçamento
de brass); *"destructive is a color, not a click — red appears after the user
has indicated intent"* (foi exatamente o conserto do ✕→lixeira do ADR-117); e
*"when two surfaces do the same semantic thing in two different ways, one of
them is wrong"* (foi o `PainelDaFaixa` da ADR-118, três dias depois).

**Dois times independentes convergiram.** Isso é evidência de que o guia não é
idiossincrasia nossa — é o padrão emergente da categoria. Onde eles estão à
frente, e nós temos lacuna:

### Lacuna 1 — falta a tabela de "qual superfície usar"
O §6 deles resolve com cinco primitivas e um critério explícito (número de
opções, precisa buscar?, como ancora), condensado numa linha:

> *"Three themes is DropdownMenu. Thirty hosts is Combobox. A label and a value
> is AdaptiveModalSheet. 'Are you sure?' is confirmDialog."*

Nosso guia tem cor (§2), tipografia (§3), elevação (§4) e o menu do sistema
(§11) — **não tem essa régua**. E a ausência cobrou caro em 28/08: o painel de
processos nasceu como dialog porque copiei o `WorktreesDialog`, enquanto o
`UsagePill` subia popover. Dois idiomas pro mesmo gesto, e a diferença não tinha
decisão por trás.

### Lacuna 2 — falta geometria de controle fechada
Eles definem tamanho de controle UMA vez (`control-geometry.ts`): `xs` = 28px
com fonte `sm`, `sm` = 32px com `base`, `md`/`lg` = 44px. E a regra que fecha:

> *"Never shrink a control's font or padding locally to fit a context — if the
> context needs a smaller control, the size tier is missing or the wrong one is
> in use."*

Nós temos escala tipográfica fechada com guarda automática, e **nenhuma régua de
altura/padding de controle**. Por isso `h-6 px-2 text-[11px]` aparece escrito à
mão nos painéis novos.

### Lacuna 3 — falta a régua de ALINHAMENTO
O §8 deles não tem paralelo no nosso guia:

> *"Things align to their glyphs, not to their boxes… Optical alignment beats
> arithmetic when a glyph disagrees with its bounding box… **One row off the
> rail makes the whole card look unconsidered.**"*

E a regra operacional: escolha os trilhos a partir do CONTEÚDO (a aresta
esquerda do ícone, a direita do último glifo) e segure os mesmos em todas as
linhas do cartão; área de clique cresce pra fora, nunca move o conteúdo; e
quando o ajuste for óptico, deixe comentado que é óptico.

### Lacuna 4 — a regra de borda pode ficar mais afiada
Nosso §4 proíbe cartão-em-cartão por borda aninhada. O deles vai além:

> *"Single-thing borders are wrong; a single bordered element is either a card
> with one row (use the card) or it does not need a border."*

É um teste mais fácil de aplicar em review do que o nosso.

---

## 2. As cinco provocações estruturais

### P0 — Superfície de LEITURA × superfície de TRABALHO
O §7 deles separa o que a gente vinha discutindo por intuição:

> *"Settings detail pages… sit inside a centered, max-width **720** column…
> **Workspace and chat surfaces use the full width — these are working
> surfaces, not reading surfaces.** The composer carries `MAX_CONTENT_WIDTH` to
> keep lines readable while letting the workspace pane fill the rest."*

É a mesma conclusão a que a medição nos levou em 28/08 (a prosa já está em ~95
caracteres, acima do teto confortável; quem sofre preso em 760px é bloco de
código, tabela e diff) — mas com um nome melhor e uma consequência mais clara:
**a medida protege a LEITURA, não a superfície.** O composer manter teto próprio
enquanto o painel enche a tela é exatamente a frente L do plano das notas.

E eles resolvem o tamanho de fonte de um jeito que eu não tinha oferecido: uma
preferência **Base size** que escala a rampa inteira proporcionalmente (14px no
desktop, 15px no nativo). Nosso zoom do fio escala só o transcript; o deles é
ergonomia do app todo. Vale como terceira opção naquela decisão que ficou aberta.

### P1 — O daemon é dono dos agentes; no Frota, o app é
Eles têm um processo separado que sobrevive ao fechamento da janela; nós
matamos tudo na saída (`RunRegistry::kill_all`, e o comentário do
`agent.rs:19-21` explica por quê: Cmd-Q no meio de um run deixaria claude/codex
editando o repo headless). **As duas decisões estão certas para produtos
diferentes** — a nossa protege quem fecha a tampa; a deles habilita celular,
web, CLI e servidor.

O que muda de verdade se um dia quisermos isso: o `Companion` já é meio caminho
(pareamento por aceite via LAN), mas ele fala com a JANELA. Um daemon exigiria
mover o dono do processo, e aí `kill_all` deixa de ser proteção e vira bug.
**Não é feature: é troca de tese.** Registrar, não fazer por impulso.

### P2 — Providers entram por CONFIG, não por release
`~/.paseo/config.json` aceita provider novo, binário custom, endpoint
OpenAI-compatível, múltiplos perfis do mesmo provider, desabilitar provider —
e **agentes ACP quaisquer** (`docs/custom-providers.md`).

Nosso registry é compilado (`adapters.rs` + espelho `agents.ts` + testes-gêmeos)
e isso **compra o que o deles não tem**: contrato de capacidade verificado. Mas
o custo é que agent novo = release.

**A ideia que sobrevive à nossa doutrina:** já temos ACP (ADR-107/108). ACP é
protocolo com contrato descoberto em runtime — então um **provider ACP definido
pelo usuário** não fura o agnosticismo, ele o usa. Os quatro de primeira classe
seguem compilados; o quinto entra por JSON, com as capacidades vindas do
handshake e não de um chute do usuário.

### P3 — "Importar sessão": adotar a MEMÓRIA, não o processo
Primeiro a correção: eu tinha suposto attach num processo vivo. **Não é.**
`listImportableSessions()` lê a persistência NATIVA do provider — no Claude, os
JSONL de `~/.claude/projects/<dir-codificado>` — e `importSessionFromPersistence`
monta um handle sintético, chama `resumeSession` e **drena `streamHistory()`
inteiro** pra reconstruir a timeline. Mesmo caminho pra Codex, OpenCode e ACP.

Ou seja: você adota uma conversa do terminal **depois que ela parou**. É "adote
a memória", não "adote o processo". E isso é mais fácil do que eu tinha
desenhado, não mais difícil.

Detalhe de rigor que vale copiar: pra achar o diretório, eles **portaram
verbatim o algoritmo de codificação do SDK da Anthropic** — cap de 200 chars e
hash de sufixo inclusos — depois de ler a função minificada no bundle. Nós não
precisamos disso: **os hooks já nos entregam o `session_id` de bandeja**
(`hook_sessions.rs:54-66`). Chegamos ao mesmo lugar por uma porta que eles não
têm.

O menu deles tem `Importar sessão`. Nós já **vemos** sessões externas — os hooks
mantêm `agent`, `session_id`, `cwd`, `status`, `tool`
(`app/src-tauri/src/hook_sessions.rs:54-66`) — e o comentário do
`app/src/lib/externalSessions.ts:7-9` diz: *"o app OBSERVA, não dirige… não
temos como parar/mandar mensagem"*.

**Esse "não temos como" envelheceu.** `sessionResume` já é capability do
registry (`agents.ts:73`) e o próprio app já usa `claude -p --resume <sid>`
(`adapters.rs:373`). Se temos o `session_id` e o `cwd`, adotar uma sessão do
terminal é o MESMO mecanismo que já usamos pra retomar as nossas.

E isso encaixa no que acabamos de construir: o painel "sessões fora do app"
(ADR-118) hoje só sabe **encerrar**. O gesto que falta é **adotar** — e ele só
aparece para motor com `sessionResume`, que é exatamente o que o registry
responde.

### P4 — As capacidades do app viram SKILL do agente
Eles publicam skills (`npx skills add getpaseo/paseo`) que ensinam o agente a
orquestrar o próprio Paseo: `/paseo-handoff` (passar trabalho entre agentes),
`/paseo-advisor` (segunda opinião sem delegar) e `/paseo-committee` (dois
agentes contrastantes fazendo análise de causa raiz).

Olhe a lista de novo: **isso é o nosso handoff, os nossos Especialistas e a
nossa disputa do Fusion.** A diferença é de superfície: os nossos são **gestos
que o humano aperta**; os deles são **ferramentas que o agente invoca**. É o M4
do estudo do Maestri ("o app se oferece como ferramenta AO agente"), que
seguimos sem fazer — e agora tem dois concorrentes provando em produção.

A guarda que a casa exige, se isso andar: nada de delegação livre
agente-a-agente (ADR-021/030 e o estudo do Maestri já recusaram). O agente pode
PEDIR o gesto; quem confirma continua sendo o humano.

### P5 — Paridade CLI/SDK
`paseo run`, `paseo ls`, `paseo attach <id>` (streama a saída ao vivo),
`paseo send <id> "..."`, `--host workstation.local:6767`, e um SDK TS
(`@getpaseo/client`) pra criar agente programaticamente. Isso transforma o
produto em plataforma.

Nós temos o inverso: o app é a plataforma e o terminal é onde os agentes moram.
Nem precisamos copiar — mas **`attach` é a ideia forte**: poder acompanhar um
run do Frota de fora dele. Guardar.

---

## 3. O "olho": como eles fazem de verdade

Isto responde direto a pergunta do estudo da margem
(`docs/margem-do-fio-plan.md`). O harness de captura deles
(`docs/browser-capture-harness.md`) descreve a implementação real:

- **`<webview>` residente e "parqueada"**: o guest fica vivo e **pintável**
  fora da tela, empilhado, com *background throttling desligado no attach* —
  senão o compositor para de pintar e a captura vem preta.
- **Duas capturas**: `capturePage` (viewport) e **CDP full-page**.
- **Contrato de ref por árvore de acessibilidade**: snapshot tipo ARIA com
  refs que sobrevivem a `pushState` e ficam obsoletos em rerender de mesma URL.
  É a MESMA regra do nosso B1/ADR-029 (o agente lê a árvore, não pixels) e a
  do Maestri.
- **Fronteira de teclado guest↔host**, testada com sentinela: o Enter da página
  não pode submeter o composer do app.
- **Sessão persistente** compartilhando cookies/localStorage entre abas e
  **entre reinícios do processo**.

Três presentes pro nosso B2.3, que ainda não foi feito: (a) desligar throttling
no attach, (b) a fronteira de teclado, (c) perfil persistente entre reinícios —
os três são bugs que a gente descobriria na marra.

---

## 4. O modelo de ciclo de vida que vale roubar inteiro

`docs/agent-lifecycle.md` define `closed` como **estado persistido e
resumível**: o agente perde o runtime mas mantém identidade, timeline,
workspace, rótulos, título, uso, atenção e parentesco; `ensureAgentLoaded()`
retoma a sessão durável **sob o mesmo id**, sem re-anexar histórico que a
timeline canônica já tem.

Duas frases de honestidade que eu queria ter escrito:

> *"between turns nothing is watching, so the agent sits at `idle` looking
> healthy while its background work is gone."*

> *"Synthesizing a local cancellation without provider acknowledgment creates a
> **split-brain session**."*

A segunda é a nossa lição do ADR-099 (o app não pode inventar uma recusa que o
motor não deu) com um nome melhor. A primeira é um buraco que **nós também
temos**: shell de background e workflow morrem com o processo do CLI, e entre
turnos ninguém olha.

---

## 5. A cozinha: PTY, painéis, cron, voz

O mergulho no código trouxe mecanismos concretos. Estes são os que encostam em
frentes que **já estão na nossa fila**.

### 5.1 O terminal — direto no M1 do estudo da margem
`node-pty` (não portable-pty, não tmux), rodando num **processo filho forkado**
com `uncaughtException` mantendo o worker vivo, porque falha de spawn no conpty
do Windows acontece em outra thread e mataria *todos* os terminais.

Quatro regras que eu roubaria inteiras:

1. **Espelho xterm headless no backend** (scrollback 1000). Um investimento paga
   quatro coisas: reconexão, snapshot de estado, captura em texto pro agente e
   detecção de atividade. Sem ele, cada uma vira um hack diferente. **Isto é
   exatamente o que falta pro M1** — hoje o nosso `managedProcess.output` é um
   tail de 240 linhas sem emulador por trás.
2. **Backpressure medido pelo SOCKET, não pelo produtor.** Acima de 4 MB
   bufferados, o cliente é empurrado de `live` (replay) pra `visible-snapshot`
   (200 linhas). Fixa o pior caso — agente cuspindo 50 MB — sem penalizar o
   caso normal.
3. **Dono explícito do resize (`claim` vs `update`).** No minuto em que duas
   superfícies olham o mesmo PTY, elas brigam por `rows/cols` e o terminal
   pisca. Bug caro de diagnosticar, barato de prevenir. Encosta no Companion.
4. **Sentinela `{{{prompt}}}` no perfil de terminal.** O perfil declara ONDE o
   prompt entra (`claude {{{prompt}}}` posicional; `opencode --prompt={{{prompt}}}`),
   e args que só existem pra carregar o prompt são **descartados** quando não há
   prompt. Isso mata a matriz de casos especiais por CLI — e nós temos quatro
   motores com convenções diferentes no `adapters.rs`.

### 5.2 Painéis: o limite é a lição, não a árvore
Árvore de splits com `MAX_TREE_DEPTH = 5` e `MIN_SPLIT_SIZE = 0.1`; navegação
entre painéis é **geométrica** (calcula retângulos e escolhe o vizinho na
direção), não por índice. E o `partialize` **descarta abas efêmeras antes de
gravar** — diff de commit não é restaurado, porque apontaria pra um SHA
rebaseado.

Essa última é a regra transferível de verdade: **estado persistido precisa
declarar o que NÃO merece voltar.** Vale pras nossas abas e pro layout.

### 5.3 Agendamento: uma cadência canônica
Dois conceitos sobre um motor só: **Schedule** (cria agente novo a cada run) e
**Heartbeat** (reinjeta prompt no MESMO agente). Cron é a cadência canônica —
presets como `5m` são *compilados* pra cron, nunca guardados como tipo
separado. E o heartbeat tem só create/delete, **sem update**, deliberadamente,
"pra impedir que um heartbeat vire silenciosamente outro job".

Superfície mínima como guarda de segurança, não como preguiça. É a mesma
família da nossa regra de escopo explícito.

### 5.4 Voz: dois modos, e o risco declarado
Pipeline local-first (Parakeet STT + Kokoro TTS + Silero VAD em ONNX, worker
separado). O desenho bom: `dictation` (fala vira texto no composer) e
`voice_mode` (conversa) são **modos distintos**, e em voice mode a voz **não é
um agente separado** — injetam um system prompt de voz sobre o agente existente
e depois removem.

Mas a voz deles **executa**: o agente com voz recebe a toolset MCP e pode criar
workspaces e schedules. O doc admite: *"Treat voice prompts with the same care
as direct agent instructions."* Admitir o risco não é mitigá-lo. Nosso ditado
(ADR-034) para no composer, e o §6 abaixo mantém isso.

### 5.5 Compat com data de validade
`// COMPAT(importSessionWorkspaceTarget): added in v0.1.110, remove gate after
2027-01-16`. Gate de compatibilidade com **data de expiração escrita no
código**. Quando o Companion tiver app e desktop em versões diferentes, isso é
a diferença entre gate temporário e dívida permanente.

---

## 6. O que NÃO copiar

- **Canvas/painéis livres como superfície principal.** O ADR-037 é a aposta
  oposta e deliberada, e a varredura de mercado do estudo da margem mostrou o
  custo: painel que acumula vira *audit noise*.
- **Voz como comando de app.** Nosso ditado (ADR-034) transcreve para o
  composer, e o gate humano continua no envio. Voz que EXECUTA é outra tese de
  risco.
- **Daemon por impulso** (ver P1): troca de tese, não feature.
- **Provider totalmente livre por JSON** sem contrato: a versão que cabe aqui é
  só ACP (P2), porque ali a capacidade é descoberta, não declarada por quem
  escreveu o arquivo.
- **Listar CLI sem verificar se está instalado.** Eles têm `isAvailable()` pra
  providers e **não usam** nos perfis de terminal: o menu oferece `codex` e o
  terminal morre com "command not found". Num app multi-motor, é o primeiro
  suporte que a gente receberia.
- **Escrever nos arquivos de config do usuário pra instalar hook.** Eles editam
  o settings do Claude/Codex/OpenCode pra saber quando um agente terminou dentro
  de um terminal. É engenhoso e te torna coproprietário de um arquivo que o
  fornecedor também mexe; remoção por marcador falha calada e a culpa é sua.
- **Plugin não-sandboxado rodando backend E UI.** Superfície de segurança enorme
  por extensibilidade que, no nosso estágio, quase ninguém usaria.
- **RN/Expo como camada única do desktop.** É o que dá a eles "escreve uma vez,
  roda em quatro plataformas" — e cobra `<webview>` reparentado à mão fora do
  React, três implementações de emulador de terminal e arquivos
  `.electron/.web/.native` paralelos. Já temos Tauri+React; esse imposto só se
  paga com app mobile como requisito de produto.

---

## 7. A fila que este estudo abre

| # | ideia | custo | por quê |
|---|---|---|---|
| **PA1** | **Adotar sessão externa** (P3) — o painel da ADR-118 ganha "adotar" para motor com `sessionResume` | médio | o dado já existe; o "não temos como" envelheceu |
| **PA2** | **Tabela de superfícies no §6 do STYLEGUIDE** (lacuna 1) | baixo | já custou um retrabalho esta semana |
| **PA3** | **Geometria de controle fechada** (lacuna 2), com guarda | baixo | tira `h-6 px-2` escrito à mão |
| **PA4** | **Provider ACP por config** (P2) | médio | agnosticismo sem release |
| **PA5** | **Capacidades do app como skill do agente** (P4) | alto | dois concorrentes já provaram; exige o gate humano intacto |
| **PA6** | **Os três presentes do B2.3** (§3) | — | entram quando o B2.3 for feito |
| **PA7** | **Sentinela `{{{prompt}}}` no registry** (§5.1) | baixo | tira a matriz de casos especiais por motor do `adapters.rs` |
| **PA8** | **Espelho headless do terminal** (§5.1) | médio | é o que falta pro **M1** da margem existir de verdade |
| **PA9** | **`isAvailable()` antes de oferecer motor** (§6) | baixo | eles erraram isso em produção; sai de graça pra nós |
