# Navegador de trabalho vivo — estudo e desenho

> Status: **proposta, nada implementado**. Entregável = este documento + os três
> mocks (`docs/mocks/trabalho-vivo-{a,b,c}.html`).
> Data: 14/08/2026. Build de referência: working tree pós-Especialistas.
> Nome do produto na copy visível: **Frota**.
>
> **Frentes vivas que este plano NÃO toca** e das quais só depende por leitura:
> MISSÃO (`components/mission/*`, `lib/mission*`, `store/mission.ts`),
> FIO (`MessageList.tsx`, `toolview.ts`, `messageNodes.ts`),
> AGY CAPS (bloco `AGY_CAPS` em `adapters.rs`, `lib/agents.ts`).
> Onde este plano precisa de algo dessas áreas, ele descreve o **contrato**,
> não a edição.

---

## 0. Resumo executivo

1. **A tese do brief se confirma, com uma correção de fronteira.** As quatro
   superfícies (trabalho diferido no fio, fases de missão, shells do
   `work_gateway`, sessões externas dos hooks) fazem a mesma pergunta e hoje a
   respondem em quatro lugares desconexos. A correção: elas **não** compartilham
   o detalhe, compartilham o **índice**. Quem tenta unificar o detalhe constrói
   uma quinta superfície de trabalho vivo e reabre o bug que o ADR-037 e o B2.2
   fecharam.
2. **A granularidade é por motor e vira capability**, mas o **controle não é**.
   Proposta: `live_unit: Option<LiveUnitSource>` (o motor publica unidade viva
   abaixo do turno? por qual dialeto?) e `live_unit_stop: Option<LiveUnitStopSource>`
   (dá pra parar UMA dessas sozinha? por qual dialeto?), no molde
   `usage_window` × `usage_window_poll`. **Posse não é capability**: um shell é
   nosso independente do motor que o pediu, um subagente é do motor independente
   de quem o pediu. Posse é campo da unidade, derivado da origem.
3. **Achado que muda o roadmap:** a CLI do Claude **tem** parada individual, e o
   bloqueio é **nosso**. Medido nesta máquina em 14/08/2026 (CLI 2.1.220): o
   canal de controle bidirecional aceita
   `{"type":"control_request","request":{"subtype":"stop_task","task_id":…}}`
   e responde `control_response · success`. Ele só existe com `--input-format
   stream-json` e stdin aberto, e o app spawna com `stdin(Stdio::null())`
   (ADR-020). Ver §5.
4. **Onde mora:** direção **B (o radar)**, um overlay convocado por
   <kbd>⌘J</kbd>, irmão do <kbd>⌘K</kbd>. A tensão com o "dono único do agora"
   se resolve por construção: uma superfície que **não pode ser deixada aberta
   ao lado do fio** não compete com o fio.
5. **"Entrar" é ir, não é abrir uma cópia.** O fio filtrado por unidade já
   existe (o agrupamento por `parentToolId` no Fio Vivo). <kbd>↵</kbd> navega
   até ele. Onde não há lugar (sessão de terminal), o painel de foco já mostrou
   tudo e a UI diz que não há para onde ir.

---

## 1. A tese, testada

> "Isto não é ver subagente do Claude. É uma superfície que o Frota já precisa
> em quatro lugares e hoje resolve mal em cada um."

**Confirmada.** As quatro fontes existem, são vivas, e nenhuma delas tem hoje
uma resposta para "o que está vivo agora, em toda a frota". Prova por fonte:

| Fonte | Onde aparece hoje | O buraco |
|---|---|---|
| **Trabalho diferido** (`system/task_*`) | nó no Fio Vivo + linha viva do rodapé, **escopo da conversa aberta** (`deferredLiveLine`, `store/chat.ts:244`) | invisível de outra conversa; a auditoria de 14/08 mediu 3 spinners e 2 cronômetros narrando o mesmo trabalho (`docs/fio-poluicao-2.md`) |
| **Fases de missão** | `MissionTimeline` + `PhaseLive` (frente viva, em reconstrução) | "não sei o que acontece em cada etapa, não consigo pausar a etapa" (`docs/mission-ui-feedback.md`) |
| **Shells do app** (`ProcessRegistry`) | **só** como variação de uma linha de tool comum (`ToolLine`, `MessageList.tsx:265`); único lugar do app que mostra PID é `MessageList.tsx:312` | não existe nenhuma lista de "processos vivos"; só dá pra ver um shell se o `ChatItem` que o criou estiver na tela |
| **Sessões externas** (hooks H1) | bloco "No terminal (observando)" no Painel (`MissionControl.tsx:600-648`) e até 3 itens no tray (`TrayPopover.tsx:291-330`) | sem detalhe, sem foco, sem nada além do dot e do status |

### A correção que o estudo impôs

O brief diz "é a mesma pergunta quatro vezes". É — mas as quatro fontes **já
têm renderizador de detalhe** e três deles estão sendo reconstruídos agora
(FIO, MISSÃO). Unificar o **detalhe** significaria:

- reescrever o feed de ação da fase (é a frente MISSÃO, `PhaseLive.tsx`);
- reescrever a subárvore de subagente (é a frente FIO, `messageNodes.ts`);
- reescrever o tail do processo (`ToolLine`);
- e virar a **quinta** superfície com relógio vivo.

Então a tese vira: **o que falta é um índice de frota, não um renderizador de
frota.** O navegador lista, foca e **manda para o detalhe que já existe**.
Essa é a decisão de arquitetura que sustenta todo o resto do documento.

### O índice quase já existe (e ninguém percebeu)

`App.tsx:400-530` já monta, a cada tick, um agregado cross-projeto para o tray:
`TraySnapshot` com `activities[]` (`convId`, `projectId`, `title`,
`projectName`, `kind: "turno" | "missão" | "disputa"`, `startedAt`, `agent`,
`model`, `detail`), `deferred: number` e `external: TrayExternalSession[]`.
`TrayAction` já tem `open-activity` e `stop-activity`.

**O tray é um navegador de trabalho vivo capado**: corta em 3
(`activities.slice(0,3)`), não desce abaixo do turno e não tem foco. O
navegador é esse mesmo cálculo sem o corte e com granularidade sub-turno.
Consequência prática de escopo: a fonte de dados da lista **não é** trabalho
novo, é uma extração de `App.tsx` para um seletor testável.

---

## 2. Que dado existe hoje, por fonte

Levantamento direto no código (não é estimativa).

### 2.1 Subagente do Claude

Não existe evento de subagente. Existe **um campo no envelope**:
`parent_tool_use_id` na mensagem `assistant` (`adapters.rs:1377`), de onde saem
três consequências (`:1385` `SubagentText`, `:1395` `Tool` com pai, `:1418`
supressão). O nascimento é a tool `Task` comum (`toolview.ts:336`).

| dado | tem? | fonte |
|---|---|---|
| nome / descrição | sim | `input.description` da `Task` |
| tipo | sim | `input.subagent_type` |
| ferramenta corrente | sim | tools filhas ligadas por `parent_tool_use_id` |
| texto final | sim | `SubagentText` → `agentSummary` (`chat.ts:852`) |
| tempo | derivado | `ts` / `activityAt` carimbados pelo APP, nunca pelo motor |
| **tokens** | **NÃO** | `ContextUsage` é suprimido para filho de propósito (`adapters.rs:1418-1420`, "contexto próprio e não conta") |
| custo | não | o `result` do turno é agregado |
| id próprio | não | o id é o `tool_use_id` da `Task` |

**Isto é a informação mais importante do estudo para o desenho.** A coluna mais
sedutora do print da CLI (`↓ 253.1k tokens`) é a que **não podemos preencher**
para um subagente. Um layout de tabela com coluna de tokens obrigaria a mentir
(traço, zero ou o número do turno). Ver §3.

### 2.2 Trabalho diferido (`DeferredWork`)

`app/src/lib/work.ts:28-54`. Nasce dos `system/task_*` (`adapters.rs:1196-1338`).

`id` (task_id) · `toolUseId` · `kind` (task_type) · `name` · `status`
(`running|completed|interrupted`) · `summary` (passo corrente) · `outputFile` ·
**`tokens`** (de `task_progress.usage.total_tokens`) · `startedAt` · `updatedAt`.

Sem `convId` próprio: a posse é herdada do `ChatItem` que o hospeda
(`chat.ts:80`). Não sobrevive a restart como vivo: `markOrphanedProcesses`
(`chat.ts:146-160`) converte `running` do disco em `interrupted` com copy
explícita. **Tem tokens; o subagente não tem.** Duas linhas do mesmo motor com
riqueza diferente, e as duas estão certas.

### 2.3 Shell do app (`ProcessRegistry`)

`ManagedProcessView` (`work_gateway.rs:67-80`): `id` · `runId` · `convId` ·
`label` · `command` · `cwd` · **`pid: u32`** · `status`
(`running|stopping|stopped|exited|failed`, mais `orphaned` só no front) ·
`exitCode` · **`output`** (tail em anel de 240 linhas, `TAIL_LINES`,
`work_gateway.rs:26`) · `startedAt` · `updatedAt`. Sem tokens, sem custo, sem
CPU/memória.

Comandos Tauri: `managed_process_stop` (`:507`), `managed_process_retry`
(`:516`), `managed_process_start` (`:537`), registrados em `lib.rs:641-643`.
`process_poll` **não** é comando Tauri, é ação MCP consumida pelo motor; o front
recebe estado por evento `work://event` (um evento **por linha** de stdout, sem
coalescing).

**O stop é real e é o único do app**: `signal_process_group(pid, "-TERM")`
(`work_gateway.rs:322-332`) manda SIGTERM ao **grupo** (o spawn faz
`process_group(0)`, `:201`). Não há escalada automática para SIGKILL; SIGKILL só
no `kill_all()` do `ExitRequested` (`lib.rs:679`).

Não há tabela SQLite de processos. O que persiste é o `ChatItem` dentro de
`conversations.items`, então o snapshot (comando, tail, PID histórico) sobrevive
mas o handle não: reinício vira `orphaned`.

### 2.4 Fase de missão

`MissionPhaseRun`/`MissionPhaseDef` (frente MISSÃO). Tem `startedAt`, agent,
modelo, effort, o feed derivado de `items`, custo por fase somado no `result`.
**Não tem `endedAt`** (já registrado como pedido de dado em
`docs/mocks/missao-README.md` R6). A parada real existe e é nossa (o processo é
nosso): `abort(convId)` mata a missão; "Interromper esta fase" é o gesto que a
frente MISSÃO está desenhando (R7), com preço por motor (`session_resume`).

### 2.5 Sessão externa (hooks H1)

`ExternalSession` (`hook_sessions.rs:52-66`): `agent` · `sessionId` · `cwd` ·
`status` (`working|waiting|blocked|idle`) · `lastEvent` · `tool: Option<String>`
(só quando o evento carrega) · `lastSeen` · `startedAt`. **Sem PID, sem tokens,
sem custo, sem modelo.**

Vivacidade é passiva: `STALE_MS = 4h` podado só quando chega outro sinal
(`hook_sessions.rs:44,195`); a UI já esconde antes, `DISPLAY_TTL_MS = 2h`
(`externalSessions.ts:125`). Teto de 100 sessões. Nada persiste.

**Controle: nenhum.** O comentário de topo do arquivo é explícito ("o app
OBSERVA, não dirige"). O único canal de volta é o round-trip de **permissão**
(H2, opt-in), síncrono, 30s de teto, que decide **uma chamada de ferramenta** e
não interrompe a sessão.

### 2.6 O que falta (pedido de dado, não de UI)

| # | falta | custo | quem paga |
|---|---|---|---|
| F1 | **Índice de unidades vivas cross-conversa**, com granularidade sub-turno | médio; a base existe em `App.tsx:400-530` | este plano |
| F2 | **`lastActivityAt` normalizado por unidade** (hoje cada fonte tem o seu: `activityAt`, `updatedAt`, `lastSeen`) | baixo | este plano |
| F3 | **`endedAt` por fase de missão** | baixo | frente MISSÃO (já pedido no R6) |
| F4 | **Canal de controle do Claude aberto** (stdin `--input-format stream-json`) | alto; é o D2-B do `deferred-work-plan.md` | fora deste plano, §5 |
| F5 | **Tokens por subagente** | **impossível hoje**, e não é lacuna nossa | ninguém; vira declaração (§3) |

---

## 3. A unidade viva: um modelo, três eixos independentes

Todo item do navegador é uma **unidade viva** com três propriedades que **não
se derivam uma da outra**. Confundi-las é a origem de todas as mentiras
possíveis nesta tela.

```
unidade viva
 ├─ grão   : quanta coisa o produtor consegue dizer sobre ela  (do MOTOR)
 ├─ posse  : quem tem a mão no interruptor                     (da ORIGEM)
 └─ lugar  : onde mora o detalhe dela                          (da SUPERFÍCIE)
```

### 3.1 Grão — cinco contratos de observação, não uma escala de qualidade

A palavra que o brief propôs, "granularidade", empurra para uma escala
(fino > médio > grosso), e escala implica que o grosso é uma versão deficiente
do fino. Não é: são **contratos de observação diferentes**. Um shell não é um
subagente pobre, é outra coisa. O vocabulário adotado (cinco frases fechadas,
escritas na UI):

| contrato | quem | a frase na UI |
|---|---|---|
| `subagente` | Claude, tool `Task` | "reporta ferramenta a ferramenta" |
| `background` | Claude, `system/task_*` | "reporta passo a passo, com tokens" |
| `comandos` | Codex `app-server` (`item/started`), fase de missão | "reporta comando a comando" |
| `processo` | shell do `work_gateway` | "processo do app, com PID e saída" |
| `pulso` | agy hoje; Codex em transporte `exec` | "não reporta ação, só sinal de vida" |
| `sinais` | sessão externa | "só o que o hook conta" |

Regra de render: **onde não há ação, a faixa de evidência diz o contrato.**
Nunca vazia (leria "nada acontecendo"), nunca "preparando…" (frase inventada,
proibida pelo §7 e pelo R5 da missão).

### 3.2 Posse — três valores, e é isto que decide o botão

| posse | quem | o que o gesto faz de verdade |
|---|---|---|
| **`nosso`** | shell do `work_gateway`; fase de missão | mata o processo (SIGTERM no grupo / `abort`). O botão existe. |
| **`turno`** | subagente Claude; trabalho diferido; turno do agy/Codex | só o turno inteiro morre, e o background da conversa morre junto. O botão **não** existe; a UI **nomeia** o gesto que existe. |
| **`só ver`** | sessão externa do terminal | nada. Nem botão nem frase de gesto. |

**Posse não é capability e nunca pode virar uma.** Um `bun run dev` é nosso
tenha sido pedido pelo Claude, pelo Codex ou por você. Um subagente é do motor
mesmo que o motor seja nosso favorito. Posse é campo da unidade, derivado de
onde ela nasceu. Se virar capability, o dia em que o Codex ganhar subagente
obriga a mexer no registry por um motivo que não é do motor.

### 3.3 Lugar — onde mora o detalhe

| unidade | lugar |
|---|---|
| subagente, trabalho diferido, shell | o nó no **Fio Vivo** da conversa dona |
| fase de missão | a **MissionTimeline** daquela missão |
| sessão externa | **nenhum** |

O navegador não renderiza nenhum desses. Ele leva.

---

## 4. A capability proposta

### 4.1 Por que uma nova, e por que `structured_output` não serve

A régua da casa (missão R5) é dura e certa: *"não nasce capability nova aqui;
`structured_output` é proxy fiel enquanto 'emite JSON estruturado' e 'emite
evento por ação' andarem juntas"*. Ela **não** serve aqui, por dois motivos
independentes:

1. **Aridade errada.** `structured_output` é `bool`, e a pergunta desta tela tem
   pelo menos três respostas: Claude tem unidade **com linhagem**
   (`parent_tool_use_id`), Codex tem unidade **plana** (`item/started`, sem
   pai, `parent_tool_id: None` hardcoded em 9 pontos), agy hoje não tem unidade
   nenhuma. Um bool não separa os dois primeiros, e separar os dois primeiros é
   metade do propósito da superfície.
2. **O proxy está prestes a quebrar.** A frente AGY CAPS mediu, no agy 1.1.13,
   `--output-format stream-json` com `step_update`, `step_index` e
   **`usage` incremental por step** (comentários novos em `adapters.rs:459-522`).
   Quando `structured_output` do agy virar `true`, ela colapsará Claude, Codex e
   agy num balde só, enquanto o grão dos três continua diferente. A capability
   nova nasce **antes** desse dia, não depois.

### 4.2 O par proposto (molde `usage_window` × `usage_window_poll`)

```rust
/// O motor publica UNIDADE VIVA abaixo do turno, com identidade própria?
/// `None` = a única unidade viva é o turno (degradação honesta, não defeito).
/// O dialeto confina o "como": a capability decide o "se".
pub live_unit: Option<LiveUnitSource>,

/// Dá pra parar UMA dessas unidades sozinha, sem matar o turno?
/// `None` = só existe controle do turno inteiro. Hoje é `None` nos três.
pub live_unit_stop: Option<LiveUnitStopSource>,
```

```rust
pub enum LiveUnitSource {
    /// assistant.parent_tool_use_id (adapters.rs:1377) + tool `Task`.
    /// Unidade COM LINHAGEM: filhos penduram no pai.
    ClaudeParentToolUse,
    /// system/task_* (adapters.rs:1196-1338). Unidade com id próprio E
    /// telemetria própria (task_progress.usage). Ciclo ultrapassa o turno.
    ClaudeBackgroundTask,
    /// item/started do app-server (codex_appserver.rs:395). Unidade PLANA.
    /// No transporte `exec` os started são descartados (adapters.rs:1820):
    /// a capability é o TETO, a unidade declara o que de fato chegou.
    CodexItemStarted,
    /// step_update com step_index (agy 1.1.13). Hoje NÃO declarado:
    /// o app roda o `-p` de texto puro. Entra quando a frente AGY CAPS virar
    /// a chave, e a UI não muda uma linha.
    AgyStepUpdate,
}

pub enum LiveUnitStopSource {
    /// control_request {subtype:"stop_task", task_id} sobre o canal
    /// bidirecional (--input-format stream-json). MEDIDO, ver §5.
    /// Exige stdin aberto: hoje o spawn usa stdin(Stdio::null()) (ADR-020).
    ClaudeControlStopTask,
}
```

`live_unit` é `Option<Enum>` e não `Vec`, apesar de o Claude ter **dois**
dialetos (`ClaudeParentToolUse` e `ClaudeBackgroundTask`). Decisão deliberada,
com o mesmo argumento do `usage_window`: a capability responde "qual é o dialeto
canônico de unidade viva deste motor" e o segundo dialeto do Claude já é
declarado por outra capability que existe (`deferred_work: true`). Declarar duas
vezes a mesma coisa é registro morto.

### 4.3 O que cada motor declara

| agent | `live_unit` | `live_unit_stop` | evidência |
|---|---|---|---|
| `claude-code` | `Some(ClaudeParentToolUse)` | `None` **hoje** | `adapters.rs:1377,1395`; teste `claude_preserva_ponteiro_e_retorno_do_subagente` (`:2447`) |
| `codex` | `Some(CodexItemStarted)` | `None` | `codex_appserver.rs:395`, `map_item_started:191`; `turn/interrupt` é do TURNO (`:889-899`), não do item |
| `agy` | `None` hoje | `None` | `on_stdout_line` transforma cada linha em `TextDelta` (`adapters.rs:2090-2104`); a promessa medida está em `:459-522`, e virar a chave é da frente AGY CAPS |
| desconhecido | `None` | `None` | fail-closed |

### 4.4 Espelho TS e testes

Espelho em `lib/agents.ts` (o front decide comportamento com isto: o contrato
escrito na linha e no painel de foco):

```ts
liveUnit: "subagent" | "background" | "item" | "step" | null
liveUnitStop: "control" | null
```

- **Teste-gêmeo**: `matriz_live_unit_por_agent` (Rust) ↔
  `agents.liveUnit.test.ts` (TS), no padrão das dez `matriz_*` que já existem
  (`adapters.rs:3185-3500`).
- **Asserções no `contrato_capabilities_x_comportamento_por_agent`**
  (`adapters.rs:3692`), no bloco (B) de coerência, copiando literalmente a régua
  do `usage_window_poll` (`:3771-3777`):
  ```rust
  // não se para o que não se nomeia
  assert!(caps.live_unit_stop.is_none() || caps.live_unit.is_some(),
      "{agent}: live_unit_stop declarado sem live_unit");
  // linhagem exige árvore: quem declara ClaudeParentToolUse tem que emitir
  // Tool com parent_tool_id no stream (bloco D, sobre on_stdout_line)
  assert!(caps.live_unit != Some(LiveUnitSource::ClaudeParentToolUse)
      || caps.structured_output,
      "{agent}: unidade com linhagem exige stream estruturado");
  ```
- **Guarda de honestidade no front** (vitest, não é teste de tipo): a linha do
  navegador com `liveUnit === null` **nunca** pode renderizar faixa de ação
  vazia; ela renderiza a frase de contrato. É o teste que impede a regressão
  "preparando…".

### 4.5 Nomes descartados

| nome | por que não |
|---|---|
| `live_work_granularity` (o do brief) | "granularidade" é escala, e escala implica que grosso é fino deficiente. O estudo mostrou que são contratos diferentes, não graus. |
| `telemetry_granularity` (proposto pelo agy na rodada da missão) | mesmo problema, e já foi descartado uma vez naquele plano. |
| `subagent_support` | fixa o desenho no vocabulário de UM fornecedor (§ "nunca" da casa). O Codex não tem subagente e tem unidade viva. |
| `can_stop_unit: bool` | esconde o dialeto. A casa separa o "se" (capability) do "como" (enum), e aqui o "como" é uma decisão de infra grande (§5). |

---

## 5. O que NÃO dá pra parar (e o achado que muda o roadmap)

### 5.1 O estado de hoje, sem enfeite

| unidade | parada individual hoje | evidência |
|---|---|---|
| shell do `work_gateway` | **SIM**, real | `managed_process_stop` → SIGTERM no grupo (`work_gateway.rs:272-295,322-332`) |
| fase de missão | **SIM**, é processo nosso | `abort` no store de missão; o gesto por fase é da frente MISSÃO (R7) |
| subagente do Claude | **NÃO** | `stopInHeader` exclui (`MessageList.tsx:374-380`); a copy já diz "O provider não expõe cancelamento individual deste subagente; interrompe o turno completo" (`:485-489`) |
| trabalho diferido | **NÃO** | não existe `stopDeferredWork`; `ChatPanel.tsx:1270` cai no `handleStop()` do turno |
| item do Codex | **NÃO** | só `turn/interrupt` (`codex_appserver.rs:889-899`), granularidade de turno |
| turno do agy | **NÃO** individual (é o turno todo) | — |
| sessão externa | **NÃO**, e nem parcialmente | `hook_sessions.rs:9-10`, observação por design |

**Regra de UI que sai daí, e é inegociável:** o botão de parar só aparece onde a
posse é `nosso`. Onde é `turno`, a UI **nomeia** o gesto que existe, com o preço
("interrompe o turno inteiro e o trabalho em background morre junto"). Onde é
`só ver`, não há gesto nem frase de gesto. Botão desabilitado cinza foi
descartado: ele ocupa o lugar do comando sem ser comando (convergência entre o
agy e o codex na consulta, §10).

### 5.2 O achado: a CLI tem parada individual, e o bloqueio é nosso

O `work-hierarchy-plan.md` e a copy do app dizem "o provider não expõe". Isso
**deixou de ser verdade** (ou nunca foi, na forma em que foi escrito). Medido
nesta máquina, 14/08/2026, `claude 2.1.220`:

- O schema de `control_request` do binário declara
  `{subtype:"stop_task", task_id}` com a descrição literal **"Stops a running
  task."**, e `{subtype:"background_tasks", tool_use_id?}` com
  **"Backgrounds in-flight foreground tasks (Bash commands and subagents). With
  tool_use_id, targets the single task started by that tool_use block"**.
- **Probe executado**, não leitura de binário:
  ```
  echo '{"type":"control_request","request_id":"r2",
         "request":{"subtype":"stop_task","task_id":"nao-existe"}}' \
    | claude -p --verbose --input-format stream-json --output-format stream-json
  → {"type":"control_response","response":{"subtype":"success","request_id":"r2","response":{}}}
  ```
  (`not_found`/`not_running` são tratados como sucesso pelo handler; o que o
  probe prova é que **o canal aceita o verbo**.)

Ou seja, o caminho completo existe: dado o `tool_use_id` de uma `Task` em voo
(que o app **já tem**, é o `parentToolId`), dá para `background_tasks` +
`stop_task` e matar **um** subagente sem matar o turno.

**O que impede hoje é nosso, e está escrito em dois lugares:** o loop de spawn
força `stdin(Stdio::null())` (`docs/agent-runner.md:327-333`, ADR-020), e o
`docs/interactive-input.md:38-42` descartou o stream-json de entrada por ser
protocolo não documentado. A avaliação era correta na época; a evidência mudou.

**Consequência para este plano:** `live_unit_stop` nasce `None` para todos, e o
enum `ClaudeControlStopTask` fica **registrado com a evidência medida** como o
caminho de upgrade. Ele acende quando o D2-B do `deferred-work-plan.md`
(processo residente com stdin aberto) existir, e nesse dia **a UI não muda uma
linha**: a linha já lê a posse da unidade, e a posse do subagente passa de
`turno` para `nosso`. Isso é o teste real de "desenhar para o motor crescer sem
redesenho", e este é o primeiro caso concreto dele.

---

## 6. Onde mora (e a tensão com o dono único do agora)

### 6.1 A tensão, escrita inteira

O `STYLEGUIDE §6` e o `background-status-plan B2.2` dizem, com um bug real por
trás (builds 181/182): **a linha viva do rodapé é a ÚNICA superfície com
relógio vivo**; grupo vivo mostra no máximo "atividade há Xs". E o
`work-hierarchy-plan.md` já comparou inline (A), dock persistente (B) e painel
lateral (C) e registrou: *"Dock global cross-projeto (B) e painel lateral (C):
descartados"*.

Um navegador de trabalho vivo é, na cara, exatamente o que foi descartado.
Ignorar isso seria reabrir um bug fechado por decisão escrita.

### 6.2 A resolução, em três cláusulas

**Cláusula 1 — exclusividade no tempo.** O navegador é **convocado** e cobre o
app. Enquanto ele está aberto, o fio está atrás de um véu. Um viewport, um
agora. Uma superfície que **não pode ficar aberta ao lado do fio** não compete
com o fio, e isso é uma propriedade do layout, não uma promessa de copy.

**Cláusula 2 — um relógio, e ele é do cursor.** Dentro do navegador, **só a
linha em foco tem cronômetro** (segundos, `tabular-nums`). Todas as outras
mostram idade em granularidade de minuto ("12min", "3h 12min", "visto há 8s"
para a externa, que é a única cujo dado é o `lastSeen`). Isto é exatamente o R4
da missão ("duas idades, não uma"), aplicado a uma lista: **o cursor é o dono do
agora dentro do navegador.** É também a diferença deliberada contra o print da
CLI, que tica segundos em todas as linhas.

**Cláusula 3 — o escopo é outro, e é declarado.** A linha viva do rodapé é dona
do agora **desta conversa**. O navegador é da **frota**. Onde os dois falam do
mesmo trabalho, o navegador marca ("aqui"), e a contagem declara os dois números
("6 vivos · 2 aqui, 4 em outros lugares"). Isso obriga uma mudança pequena e
honesta em `deferredLiveLine`: o denominador precisa dizer o que conta, senão
cresce calado quando você troca de conversa (contagem sem fonte única é
proibida, §7).

### 6.3 Substitui alguma coisa?

- **Não substitui** a linha viva (ela vira o gesto de descoberta, clicável).
- **Não substitui** o Fio Vivo, a MissionTimeline nem o tray.
- **Absorve**, sim, o bloco "No terminal (observando)" do Painel
  (`MissionControl.tsx:600-648`): ele é um pedaço do navegador vivendo num
  dashboard. Depois que o navegador existir, aquele bloco vira uma linha
  ("N sessões no terminal · ⌘J") ou some. **Decisão adiada para a entrega**,
  porque o Painel é superfície com dono e a remoção precisa de gesto dele.

---

## 7. O que é "entrar"

### 7.1 Duas grades, e a UI declara qual está oferecendo

**Unidade com lugar** (subagente, diferido, shell, fase) → <kbd>↵</kbd> **vai**:
troca de projeto e conversa, fecha o navegador, rola até o nó e abre a subárvore
dele no Fio Vivo (ou a fase na MissionTimeline). Rodapé: "↵ ir pro fio".

**Unidade sem lugar** (sessão externa) → não há para onde ir. O painel de foco
**já mostrou tudo que existe** (agent, cwd, status, ferramenta, duas idades), e o
rodapé diz o que dá: abrir o projeto cujo `cwd` bate, quando houver um
(`projectForCwd`/`sessionPlace` já resolvem isso, `externalSessions.ts:88-116`).

### 7.2 Por que não um "fio filtrado" dentro do navegador

Porque **ele já existe**. O Fio Vivo agrupa por `parentToolId`
(`messageNodes.ts:215-229`, `childrenByParentOf`), abre o ramo ativo sozinho e
tem navegação por `↑↓←→`. Um fio filtrado dentro do navegador seria:

- a quinta implementação de "mostrar trabalho vivo";
- em conflito com a frente FIO, que está reconstruindo justo isso;
- e uma segunda superfície com relógio vivo, que é o que a §6 acabou de
  resolver.

**"Entrar" é navegar até o detalhe que existe, nunca clonar o detalhe.** O
painel de foco do navegador é uma **prévia** (aparece no `↑↓`, não no `↵`), e é
deliberadamente raso: agora · evidência recente · contexto · o que dá pra fazer.

### 7.3 Como se sai

<kbd>esc</kbd> fecha e devolve o foco de onde veio. Não há pilha de histórico:
um navegador que lembra onde você estava é um browser, e browser é outro
produto. Se você entrou (navegou), saiu do navegador; o caminho de volta é o
atalho de novo.

---

## 8. Teclado

Inventário real: o app tem **um** atalho com modificador (`⌘K`,
`CommandMenu.tsx:89`) e usa `Escape`, `Enter` e as quatro setas dentro de
componentes. O espaço está livre.

| tecla | ação | nota |
|---|---|---|
| <kbd>⌘J</kbd> | abre/fecha o navegador | toggle, igual ao ⌘K. `J` de "jump", idioma estabelecido (VS Code, Slack), sem colisão, mesma mão do ⌘K |
| <kbd>↑</kbd><kbd>↓</kbd> | move o foco (atravessa os grupos) | o foco muda o painel de prévia e o rodapé |
| <kbd>↵</kbd> | vai pro lugar da unidade | fecha o navegador |
| <kbd>esc</kbd> | fecha | devolve o foco à origem |
| `a-z` | filtra por digitação | mesmo modelo do ⌘K; é a resposta para N grande, sem inventar agrupamento novo |
| <kbd>⌫</kbd> | **parar**, e só aparece com posse `nosso` | destrutivo: passa por `confirm({ danger })` como o resto da casa |
| <kbd>⇧⌫</kbd> | interromper o turno inteiro | só quando a posse é `turno`; o preço é dito no rodapé antes |

Descartados:
- **`x` para parar** (é o que a CLI usa): letra solta conflita com o filtro por
  digitação, que é o que faz a lista escalar. <kbd>⌫</kbd> é o idioma macOS de
  ação destrutiva sobre a linha selecionada (Finder, Mail).
- **Meter trabalho vivo dentro do ⌘K**: a lista do ⌘K é de comandos e não tica.
  Misturar estado vivo com comandos faz um dos dois virar ruído, e obrigaria o
  ⌘K a ter relógio.
- **Um atalho por fonte** (⌘1 shells, ⌘2 sessões…): reintroduz as quatro
  superfícies que o plano existe para juntar.

Mouse: a linha viva do rodapé fica clicável e pede a abertura, no mesmo padrão
pub/sub do `lib/commandMenu.ts` (`openCommandMenu`/`onOpenCommandMenu`), que já
existe justamente para "o mesmo ⌘K por outro gesto". Um `lib/liveWork.ts`
espelhando aquele arquivo é ~30 linhas e resolve descoberta.

---

## 9. Fases de missão: sem dado novo × com dado novo

O navegador **não** reconstrói a fase. Ele resolve as duas queixas do usuário
pela borda, e o resto é da frente MISSÃO.

### 9.1 Dá pra entregar sem nenhum dado novo

1. **A fase viva aparece na lista da frota**, com nome, motor, `fase n/N`, a
   idade e o comando corrente. Hoje, para saber o que a fase 7 está fazendo, é
   preciso estar na conversa da missão. Isso já responde metade de "não sei o
   que está acontecendo em cada etapa".
2. **O contrato de observação da fase vem da capability do motor DAQUELA fase**
   (`MissionPhaseDef.agent`), não da conversa. Fase de agy diz "não reporta
   ação, só pulso" na própria linha, antes de você abrir.
3. **A posse da fase é `nosso`**, então a fase é uma das poucas linhas com
   <kbd>⌫</kbd> de verdade. O navegador **não implementa** o gesto: ele chama o
   que a frente MISSÃO expuser (o `abort`/interromper fase), com o preço por
   motor lido da capability `session_resume` (Claude/Codex retomam; agy roda de
   novo).
4. **O aviso de repetição (R11) e o "sem sinal há X" (R5)**, quando a frente
   MISSÃO os produzir, aparecem na faixa de evidência da linha sem código novo
   aqui: é a mesma string.

### 9.2 Exige dado novo

| precisa | de quem | para quê |
|---|---|---|
| `endedAt` por fase (F3) | frente MISSÃO | a lista quer mostrar "fase 6 terminou há 4min" na transição; sem isso a fase que acabou some sem rastro |
| `lastActivityAt` normalizado (F2) | este plano | ordenar por "quem parou de dar sinal primeiro", que é a ordem útil quando há 12 unidades |
| leitura periódica do worktree | frente MISSÃO (R11) | o segundo fator do detector de travamento; continua o furo aberto declarado no `missao-README.md` |

**O que este plano NÃO pede à frente MISSÃO:** nada de layout. A queixa "não
consigo pausar a etapa" é resolvida por ela (R7), e o navegador só oferece o
mesmo gesto de um segundo lugar.

---

## 10. As três direções e a recomendação

Os três mocks renderizam a **mesma cena**, com os mesmos seis trabalhos vivos
das quatro fontes (subagente do Claude, trabalho diferido com tokens, shell com
PID, fase de missão do Codex, turno de agy sem ação, sessão externa esperando
permissão), em quatro estados (`lista`, `foco fino`, `foco grosso`, `vazio`) e
nos dois temas.

| | **A · a linha viva cresce** | **B · o radar** | **C · a coluna do agora** |
|---|---|---|---|
| onde | faixa ancorada no rodapé, cresce pra cima | overlay convocado, cobre o app | rail direito permanente, 300px |
| escopo | frota, dentro da coluna de UMA conversa | frota, fora de qualquer conversa | frota, ao lado do fio |
| dono do agora | **resolvido por construção** (é a linha viva com outro zoom) | **resolvido por exclusividade** (véu sobre o fio) | **VIOLADO**: dois cronômetros na mesma tela |
| descoberta | grátis (a âncora está sempre lá) | precisa da linha viva clicável | grátis |
| largura pro detalhe | ~700px, sem painel lateral | 860px, lista + foco lado a lado | 300px, foco embaixo da lista |
| consciência periférica | nenhuma | nenhuma | **é a única que tem** |
| estado vazio | some | some | 300px de nada |
| delta de código | menor | maior (superfície nova) | maior ainda |

### Recomendação: **B (o radar)**, com a âncora de A e nada de C

Quatro razões, em ordem de peso:

1. **B é a única que pode ser honestamente de frota.** A e C moram grudadas na
   conversa aberta; o navegador precisa listar coisas de outros projetos e
   coisas de **nenhum** projeto (a sessão de terminal não pertence a conversa
   nenhuma). Uma superfície de frota dentro de uma coluna de conversa é um
   escopo mentindo sobre o outro. B não mora em lugar nenhum e por isso pode
   falar de todos.
2. **B resolve o dono único do agora sem depender de disciplina.** A resolve
   também, e por um caminho até mais elegante (é a mesma linha, com zoom). Mas
   A resolve porque **hoje** ela é pequena; no dia em que alguém quiser um
   painel de foco decente dentro dela, a faixa vira meia tela em cima do
   composer e a elegância evapora. B tem o espaço desde o começo e a
   exclusividade é do layout, não do tamanho.
3. **C está descartada por decisão escrita, e o argumento novo não vence.** O
   `work-hierarchy-plan.md` já recusou dock e painel lateral. "Agora há mais
   fontes de trabalho vivo" é um argumento real, e mesmo assim ele não paga dois
   relógios narrando o mesmo agora, que é o bug dos builds 181/182 voltando por
   layout (nota 1 do mock C). C fica registrada, com uma coisa que ela ganha e
   as outras não: consciência periférica. Ela já tem dono e já funciona: **o
   tray**, que aparece quando o app está atrás. Reforçar o tray é mais barato
   que uma coluna.
4. **A largura decide o resto.** Com seis posições estáveis na linha (dot ·
   nome · selo de contrato · faixa de evidência · idade · posse), 300px obrigam
   a quebrar em duas linhas (o mock C mostra), o que estraga o ritmo da seta
   num navegador cuja graça é a seta. 700px (A) cabem apertado. 860px (B) cabem
   com painel de foco ao lado.

**O que trago de A:** a âncora. A linha viva do rodapé fica clicável e é a
descoberta do <kbd>⌘J</kbd>; sem ela o atalho é folclore. É a maior fraqueza de
B e ela custa ~30 linhas.

**O que trago de C:** nada de layout. Só o lembrete de que consciência
periférica é um problema real e já tem dono (tray).

### O argumento mais forte CONTRA a recomendação

**Um navegador convocado não avisa.** A fase presa há 20 minutos, o shell que
morreu e a permissão esperando no terminal continuam invisíveis até você apertar
<kbd>⌘J</kbd>. C avisaria. A mitigação honesta é que **o aviso já não é trabalho
desta superfície**: quem avisa hoje é a linha viva (dentro da conversa), o tray
(fora do app) e o watchdog (`lib/watchdog.ts`, ticker único). Se o aviso estiver
fraco, o conserto é lá, e é mais barato que uma coluna permanente. Fica
registrado que essa mitigação **não foi medida**; se depois de B existir o
usuário continuar descobrindo tarde, o assunto volta, e volta como reforço do
tray, não como ressurreição de C.

---

## 11. Ordem de entrega proposta

| fase | o que | depende de |
|---|---|---|
| **N0** | `lib/liveUnit.ts`: o tipo normalizado (grão · posse · lugar) + o seletor que monta a lista a partir das cinco fontes que `App.tsx:400-530` já lê. **Puro e testado, sem UI.** Sai junto a extração do cálculo do tray para o mesmo seletor (fonte única de contagem) | nada |
| **N1** | Capabilities `live_unit` / `live_unit_stop` nos dois lados + `matriz_live_unit_por_agent` + asserções de coerência no contrato + espelho TS | coordenar com AGY CAPS (mesmo arquivo) |
| **N2** | O radar: overlay, lista, teclado, filtro. Sem painel de foco. <kbd>↵</kbd> navegando | N0, N1 |
| **N3** | Painel de foco (prévia rasa) + rodapé sensível ao foco + <kbd>⌫</kbd> onde a posse é `nosso` | N2 |
| **N4** | Âncora: linha viva clicável (`lib/liveWork.ts` no molde do `commandMenu.ts`) + denominador declarado em `deferredLiveLine` | N2 |
| **N5** | Absorver o bloco "No terminal" do Painel | gesto do dono do Painel |

Nada aqui exige migração de banco. Estado vivo não é persistido (regra da casa,
D1.5), então o navegador não ganha tabela.

---

## 12. Guardas

- **Fail-open no render**: unidade de fonte desconhecida vira uma linha com
  contrato `pulso` e posse `só ver`; nunca crasha, nunca some.
- **Fail-closed no efeito**: <kbd>⌫</kbd> só existe com posse `nosso` **e** id
  resolvido; unidade órfã (app reiniciou, `markOrphanedProcesses`) não oferece
  parada, oferece o PID, que é a única coisa acionável que sobrou.
- **Sem estado inventado**: onde não há dado, o slot **some** (não vira traço,
  não vira spinner, não vira esqueleto). A única exceção é a faixa de evidência,
  que quando vazia diz o contrato.
- **Um relógio**: só a linha em foco tica. Teste obrigatório.
- **Contagem com fonte única**: o número do cabeçalho, o do tray e o da linha
  viva saem do mesmo seletor (N0). Três contagens divergentes do mesmo fato foi
  o B2 do `fio-poluicao-2.md`.
- **Replay-safe**: a lista deriva de estado vivo, que não sobrevive a restart.
  Depois de reiniciar o app, o navegador está vazio, e isso é correto.
- **Orçamento de tinta**: no recorte do navegador, duas cores de status
  (`st-running` do vivo, `st-warning` de "esperando você") mais o vermelho preso
  ao gesto destrutivo no rodapé. Nada mais.
- **Não tocar em teste existente.** Se um quebrar, o desenho está errado.

---

## 13. Segunda opinião (agy 3.7 e codex), curada

Pergunta idêntica para os dois: *"como mostrar N unidades de trabalho vivas com
granularidades DIFERENTES sem mentir uniformidade?"*, com as quatro tensões
(lista que parece quebrada, controle parcial, entrar numa unidade grossa,
crescer sem redesenho).

### Onde os dois concordaram (tratado como fechado)

1. **Rodapé de atalhos sensível ao item em foco, nunca botão por linha.** Os
   dois citaram k9s/lazygit e os dois disseram, com as mesmas palavras, que
   botão desabilitado é pior que ausência. É a §5.1 deste plano.
2. **O vazio é dado; nada de placeholder, spinner ou esqueleto.** Métrica que
   não existe não ganha espaço nem traço.
3. **A mesma casca de detalhe para todas as unidades**, com facetas opcionais.
   Entrar numa unidade grossa revela a evidência dela, não a deficiência dela.
4. **Slots reservados** para telemetria que pode chegar depois. É o que faz o
   agy entrar sem redesenho.

### Adotado

- **codex, "contratos de observação".** A melhor contribuição das duas consultas:
  nomear o grão por **contrato** (`estrutura`, `comandos`, `pulso`, `processo`,
  `sinais`) em vez de por qualidade. Adotado literalmente como conceito e
  reescrito para o vocabulário da casa (§3.1), incluindo `background` como
  sexto contrato, que ele não podia saber que existia.
- **codex, "visibilidade e autoridade são eixos ortogonais".** Virou a separação
  grão × posse do §3, e é o argumento que sustenta "posse não é capability".
- **codex, "não agrupe por granularidade; agrupe por projeto, intenção ou
  parentesco real".** Adotado: os grupos são os lugares (`frota`,
  `atlas-commerce`, `lumen-mobile`, `fora do app`), como no print da CLI, que
  agrupa por repositório. Agrupar por grão faria a tela ensinar que motor calado
  é uma categoria inferior.
- **codex, "Enter significa inspecionar evidência, não descer na hierarquia".**
  Adotado com uma correção grande: aqui `↵` **vai** para o detalhe que já
  existe, e a inspeção é a prévia do `↑↓`. A correção é minha e vem do código:
  duplicar o detalhe seria a quinta superfície.
- **agy, "log/texto como o mínimo denominador comum".** Toda unidade tem texto
  com hora. Virou a seção "evidência recente" do painel de foco, que é o mesmo
  componente para stdout de shell, ferramenta de subagente, comando de fase e
  prosa de agy.
- **agy, "design por slots"**, e o exemplo dele é exatamente o nosso caso do agy
  ganhando `step_update`. Virou o §4.2 (a capability nova enche um slot que já
  existe) e a nota 9 do mock B.
- **agy, "descartar hover actions"** num navegador de teclado. Adotado: nenhuma
  ação aparece por hover; ações moram no rodapé, ligadas ao foco.
- **agy, "descartar bento/dashboard de cards no detalhe"**: painel de cards
  quebra quando falta dado. Adotado, e reforça a regra da casa contra
  cards-dentro-de-cards (§8 do STYLEGUIDE).

### Descartado, com motivo

- **agy: linha secundária dinâmica / altura variável por unidade** (e o codex
  disse quase o mesmo, "faixa elástica, altura variável"). Descartado nos dois.
  Num navegador cuja interação principal é a seta, **altura variável destrói o
  metrônomo**: você não aprende quantos toques faltam. Adotada a versão
  restrita: **altura fixa de 34px** (a régua de linha de conversa do §8) com a
  faixa de evidência **elástica na largura**. Assim a diferença de riqueza
  aparece como conteúdo, e o ritmo do teclado se mantém.
- **agy: badges `[CL]` `[CX]` `[AG]` `[SH]` `[EXT]`.** Cosplay de terminal, e a
  casa tem regra de identidade de motor (selo no cabeçalho, `.label-mono`).
  Ficou o selo em texto minúsculo mono ("claude · subagente").
- **agy: "PID na tela" como item de linha genérico.** O `missao-README.md` já
  tinha descartado PID como encanamento sem decisão junto, e a régua vale.
  Adotada uma versão que **ganha** o lugar: o PID aparece só onde sustenta
  decisão, que são dois casos: o shell vivo (é o que o <kbd>⌫</kbd> vai matar,
  o grupo inteiro) e o processo **órfão** (o app perdeu o handle; o PID é
  literalmente a única coisa acionável que sobrou, no terminal).
- **codex: "identidade + fonte/visão" numa zona só.** Testado no mock e
  separado: `nome` e `selo de contrato` são posições distintas porque o nome
  trunca e o selo não pode truncar (se o contrato some, a linha volta a mentir
  uniformidade). Quem cede é o nome, nunca o contrato nem o tempo (regra R5 do
  Warp, já lei da casa).
- **codex: "não colocaria × em cada linha, mas usaria ◆/◇ constantes".**
  Adotado o princípio, trocado o glifo por **texto** (`nosso` · `turno` ·
  `só ver`). São três estados, não dois, e a casa já decidiu que quem precisa
  distinguir estados usa texto, não tinta nem glifo (STYLEGUIDE §9, item 4).
  Cinco caracteres numa coluna fixa não são "um parágrafo de desculpas".
- **agy: "terminal de logs em tela cheia" ao entrar numa unidade grossa.**
  Descartado: o tail do shell tem 240 linhas e já tem lugar (o corpo expansível
  do `ToolLine`); construir um mini-terminal dentro do navegador é a quinta
  superfície de novo.
- **Ambos, implicitamente: N relógios ticando** (é o que o print da CLI faz).
  Descartado pela regra da casa. Um relógio, e é do cursor (§6.2).

### Onde eu discordo dos dois

Os dois desenharam **uma lista que é o produto**. Este plano desenha **uma lista
que é uma ponte**: o valor não está no que ela mostra, está em para onde ela
leva. Nenhum dos dois tinha como saber que o app já tem quatro renderizadores de
trabalho vivo, dois deles em reconstrução esta semana. A consequência é a
decisão mais importante do documento (§1, "índice e não renderizador"), e ela
não veio de nenhuma das duas consultas.

---

## 14. Furos conhecidos, NÃO fechados

1. **O índice depende de conversa hidratada.** O agregado de `App.tsx` percorre
   `chat.byId`, que só tem conversas abertas na sessão. Na prática o buraco é
   pequeno (estado vivo não sobrevive a restart, então tudo que está vivo nasceu
   nesta sessão), mas **não foi provado** para runs agendados que disparam sem
   você abrir a conversa. Precisa de um teste antes do N0.
2. **`process_output` emite um evento Tauri por linha de stdout**, sem
   coalescing (`work_gateway.rs:138`). Um shell verboso na lista do navegador
   pode virar tempestade de render. Não é regressão deste plano (já é assim),
   mas o navegador é a primeira superfície que olha vários shells ao mesmo
   tempo. Provável necessidade de throttle antes do N2.
3. **Sessão externa órfã fica visível até 2h.** A poda de 4h só roda quando
   chega outro sinal (`hook_sessions.rs:195`), e a UI esconde aos 120min
   (`externalSessions.ts:125`). Uma sessão morta por `kill -9` fica na lista do
   navegador com o status congelado e a idade crescendo. É honesto (a idade
   cresce à vista) e é feio. Não resolvido aqui.
4. **A parada de fase de missão ainda não existe como API estável.** O §9
   assume que a frente MISSÃO vai expor "interromper esta fase" (R7). Se ela não
   expuser, a linha da fase cai para posse `turno` e a promessa do <kbd>⌫</kbd>
   nela some. É dependência declarada, não suposição.
5. **`MessageList.tsx` está em ~2.8k linhas, acima do teto de 700 do §10** e
   vivendo de baseline congelada. O N2/N3 não mexem nele, mas o N4 (linha viva
   clicável) mexe no `WorkingIndicator`, que mora lá e está sendo tocado pela
   frente FIO. Ordem alta de cuidado, e provavelmente vale dividir o arquivo
   antes.
6. **A copy de hoje ficará desatualizada pelo achado do §5.2.**
   `MessageList.tsx:485-489` diz "O provider não expõe cancelamento individual
   deste subagente". A frase correta passa a ser sobre o app, não sobre o
   provider. **Não corrigi** (é arquivo da frente FIO), mas a correção é devida
   e a evidência está no §5.2.
