# Agent Runner — a abstração de extensão

> **Objetivo:** desenhar a costura (*seam*) que permite adicionar Codex, OpenCode e Aider
> no v0.2 **sem reescrever** o caminho do Claude Code do v0.1. Mesmo havendo um só agent
> no v0.1, **ele já é o primeiro adapter desta abstração.** Respeitar isto agora é o que
> evita retrabalho depois.

## Princípio

A UI conhece **apenas eventos normalizados**. Cada agent é um **adapter** que traduz a
saída nativa (dialeto próprio) para esses eventos. Adicionar um agent = escrever um
adapter; a UI não muda.

```
saída nativa do agent  ──[adapter]──►  AgentEvent normalizado  ──►  UI (cartões no chat)
```

## 1. Modelo de eventos normalizados

Este é o **contrato de renderização**. É a parte mais estável do sistema — pense bem
antes de mudar.

```rust
enum AgentEvent {
    SessionStarted { session_id: String, agent: String, model: Option<String>,
                     cwd: PathBuf, tools: Vec<String> },
    Thinking       { text: String },                 // raciocínio/intermediário (opcional)
    AssistantText  { text: String, is_final: bool }, // bolha de texto (delta ou completa)
    ToolCallStarted{ id: String, name: String, input: serde_json::Value },
    ToolCallOutput { id: String, chunk: String },    // stdout/stream do resultado
    ToolCallFinished{ id: String, ok: bool, summary: Option<String> },
    PermissionRequest{ id: String, tool: String, input: serde_json::Value,
                       reason: Option<String> },     // host precisa aprovar/negar
    FileChanged    { path: PathBuf, kind: ChangeKind }, // edit/create/delete (painel de diffs)
    UsageUpdate    { input_tokens: u64, output_tokens: u64, cost_usd: Option<f64> },
    Done           { ok: bool, result_text: Option<String>, session_id: Option<String> },
    Error          { message: String, recoverable: bool },
    Unknown        { raw: serde_json::Value },        // NUNCA dropar; logar p/ fechar lacuna
}
```

Regra de ouro (a mesma do spike M0): **evento desconhecido vira `Unknown`, nunca um
crash.** Isso mantém o app vivo quando o CLI muda de formato.

## 2. A trait `AgentRunner`

```rust
trait AgentRunner {
    fn id(&self) -> &str;                       // "claude-code"
    fn capabilities(&self) -> Capabilities;
    fn detect(&self) -> Result<DetectInfo>;     // binário presente? versão?
    fn run(&self, req: RunRequest) -> EventStream;          // nova tarefa
    fn resume(&self, session_id: &str, req: RunRequest) -> EventStream;
    fn respond_permission(&self, id: &str, decision: PermissionDecision); // se suportado
}

struct RunRequest {
    prompt: String,
    cwd: PathBuf,
    attachments: Vec<PathBuf>,
    permission: PermissionPolicy,   // por projeto (ver §5)
    model: Option<String>,
}

struct Capabilities {
    structured_output: bool,   // true = JSON streaming; false = fallback PTY
    session_resume: bool,
    permission_callback: bool, // consegue perguntar ao host mid-run?
    streaming_text: bool,
    reports_file_changes: bool,
    reports_usage: bool,
}
```

`EventStream` = um stream assíncrono de `AgentEvent` (no Tauri, encaminhado à UI via
Channel). A UI **degrada graciosamente** conforme `capabilities` (ex.: esconde o painel
de custo se `reports_usage == false`).

## 3. Duas estratégias de execução por baixo

| Estratégia | Como | Para quem |
|---|---|---|
| **StructuredAdapter** | `spawn` do CLI com saída JSON → parse → `AgentEvent` | Claude Code, Codex, OpenCode |
| **PtyAdapter** | `spawn` em PTY (`portable-pty`) → bytes crus como `AssistantText`/`ToolCallOutput`; `Done` no exit | Aider, ou qualquer agent sem JSON |

A `trait` é a mesma; muda só o "motor" interno do adapter.

## 4. Matriz de capacidades (mid-2026, confirmar por versão)

| Agent | binário | structured | resume | perm callback | estratégia |
|---|---|---|---|---|---|
| **Claude Code** | `claude` | ✅ `stream-json` | ✅ `--resume` | ✅ (SDK `canUseTool` / flags) | Structured |
| **Codex** (OpenAI) | `codex` | ✅ `exec --json` | ⚠️ parcial | ⚠️ limitado | Structured |
| **OpenCode** | `opencode` | ✅ `run --format json` | ❓ a confirmar | ❓ a confirmar | Structured |
| **Aider** | `aider` | ❌ (sem JSON estruturado) | ❌ | ❌ | **PTY** |

> Claude Code é o mais rico → por isso é o primeiro. Aider é o mais pobre → entra por PTY,
> com eventos grosseiros (`Started` → `AssistantText(final)` em chunks → `Done` no exit).

## 5. Mapeamento por adapter (nativo → normalizado)

### Claude Code (`claude -p --output-format stream-json --verbose`)
| Nativo | Normalizado |
|---|---|
| `system/init` | `SessionStarted` (captura `session_id`, `model`, `tools`) |
| `stream_event` `content_block_delta` (`text_delta`) | `AssistantText{is_final:false}` |
| `assistant` bloco `text` | `AssistantText{is_final:true}` |
| `assistant` bloco `tool_use` | `ToolCallStarted` |
| `user` (`tool_result`) | `ToolCallFinished` / `ToolCallOutput` |
| `result` | `Done` + `UsageUpdate` |
| callback `canUseTool` (via SDK) | `PermissionRequest` |

### Codex (`codex exec --json`)
| Nativo | Normalizado |
|---|---|
| `thread.started` | `SessionStarted` |
| `turn.started` / `turn.completed` | (ciclo de vida; opcionalmente `Thinking`) |
| `item.*` (reasoning / command / file change) | `Thinking` / `ToolCallStarted` / `FileChanged` |
| evento final | `Done` |
| `--output-schema` | preenche `Done.result_text` estruturado |

### OpenCode (`opencode run --format json`)
| Nativo | Normalizado |
|---|---|
| `step_start` | `ToolCallStarted` (aprox.) |
| `message.part.updated` (`thinking`/`reasoning`/`text`) | `Thinking` / `AssistantText` |
| evento de fim | `Done` |

### Aider (PTY)
| Nativo | Normalizado |
|---|---|
| processo inicia | `SessionStarted` (id sintético) |
| stdout cru | `AssistantText{is_final:true}` em chunks |
| processo sai | `Done{ ok: exit==0 }` |

## 6. Empacotamento dos "plugins"

- **v0.1 / v0.2: adapters são módulos Rust compilados** num *registry*. Simples e
  type-safe. Não há protocolo externo ainda.
- **Mas defina o schema JSON dos eventos normalizados desde já** (espelho do enum §1).
  Assim, um futuro **protocolo de plugin externo** vira *drop-in*: um agent descrito por
  um *manifesto* + um processo que emite `AgentEvent` em JSON no stdout — **sem
  recompilar** o app. Não construir essa maquinaria até precisar.

Manifesto futuro (forma esperada):
```jsonc
{
  "id": "meu-agent",
  "displayName": "Meu Agent",
  "binary": "meu-agent",
  "detectCmd": "meu-agent --version",
  "capabilities": { "structured_output": true, "session_resume": false, /* ... */ },
  "runArgsTemplate": ["run", "--json", "{prompt}"],
  "defaultPermissions": { "mode": "read_only" }
}
```

## 7. Política de permissão (por projeto)

```rust
struct PermissionPolicy {
    mode: PermissionMode,         // Plan | ReadOnly | AcceptEdits | AskOnBash | Autonomous | Custom
    allowed_tools: Vec<String>,
    denied_tools: Vec<String>,
    ask_on: Vec<String>,          // padrões de tool que exigem aprovação in-app
}
```

- Guardada **por projeto** (SQLite e/ou `.mycockpit/permissions.json` na pasta).
- O adapter **traduz a política para as flags nativas** do agent:
  - Claude Code → restrição REAL via `--disallowedTools`/`--tools`; auto-aprovação via
    `--allowedTools`; comportamento via `--permission-mode`. ⚠️ **`--allowedTools` NÃO
    sandboxa** (achado validado no M0 — ver `stream-json-notes.md`). Gating fino mid-run
    exige o callback `canUseTool` do Agent SDK.
  - Outros → melhor esforço conforme a capacidade.
  - **PTY (Aider)** → ⚠️ não dá para interceptar mid-run; mitigar com *worktree* (v0.3)
    e/ou config nativa do agent. **Documentar esse limite na UI.**
- Default são (M5): `AcceptEdits` + **Bash pergunta** (`ask_on: ["Bash"]`).

### 7.1 Realidade por agent — o que cada CLI REALMENTE faz (verificado 2026-07)

O seletor de Permissões é do **projeto**, mas quem obedece é a CLI da conversa — e
elas divergem. Versões auditadas: claude 2.1.219, codex-cli 0.144.6, agy 1.1.7.
Re-checagem 31/07/2026 (foco MCP): claude 2.1.219 e codex 0.144.6 inalterados
(`--mcp-config`/`--strict-mcp-config` presentes; `codex mcp list --json` com o
shape que o registry consome); **agy 1.1.9** instalado — segue SEM comando/flag
MCP, o limite honesto do control plane permanece válido.

Re-checagem 03/08/2026 (foco canal SYSTEM, capability `system_channel` do
prompt-hygiene-plan H1), **codex 0.146.0**: o config key
`developer_instructions` EXISTE (achado por strings no binário; não aparece no
`--help` nem na doc) e **funciona em sessão nova** do `exec` — teste real com
`-c 'developer_instructions="…termine com ABACAXI"'` rendeu "Oi ABACAXI". Mas
no **`exec resume` a instrução da sessão ORIGINAL venceu** uma
`developer_instructions` diferente passada no resume (o modelo seguiu ABACAXI,
ignorou MELANCIA) — ou seja, não há re-envio são por spawn, que é exatamente o
contrato que o canal precisa cumprir (doutrina re-enviada/atualizável a cada
turno). Não-documentado + não re-aplicável no resume = frágil ⇒
`system_channel=false` pro codex (guarda do plano: na dúvida, false). Claude
2.1.219 segue ✅ (`--append-system-prompt`, documentado); agy ❌. Re-checar a
cada bump de versão do codex: se `developer_instructions` ganhar doc + efeito
no resume, vira candidato a `true`.

Re-checagem 04/08/2026 (foco compactação nativa, capability `native_compact`
do /compactar builtin): **claude 2.1.220** — `claude -p --resume <sid>
"/compact"` FUNCIONA em modo print: o comando é processado (teste real
respondeu "Not enough messages to compact"), e o `compact_boundary` resultante
o app já surfaça como aviso no fio (ADR-015) ⇒ `native_compact=true`.
**codex 0.146** — `/compact` é comando só do TUI; `codex exec` não expõe (help
verificado) ⇒ `false`. **agy** — nada ⇒ `false`. Motor sem a capability e COM
`session_resume` (codex): o /compactar degrada pra renovação de sessão com
recap (transplante para si mesmo, `lib/compact.ts`); sem `session_resume`
(agy) não há o que compactar — cada turno já é sessão fresca com recap, e a
UI diz isso em vez de fingir.

Re-checagem 04/08/2026 (foco TELEMETRIA, capability `cumulative_usage`),
**codex 0.146**: o `usage` do `turn.completed` do `codex exec --json` é o
**acumulado da THREAD**, não do turno. Medição real, dois turnos triviais no
MESMO thread (o 2º via `exec resume`):

```
turno 1: {"input_tokens": 17494, "cached_input_tokens": 9984,  "output_tokens": 6}
turno 2: {"input_tokens": 35005, "cached_input_tokens": 27136, "output_tokens": 12}
```

Mesmo prompt, o dobro dos números. Lido como gasto do turno, isso somava
acumulados em `turn_costs` e inflou o ledger do usuário para US$ 4.217,63 em 67
linhas (maior "turno": US$ 160,02 com 195M de input) ⇒ `cumulative_usage=true`
e o adapter passou a emitir o DELTA contra o baseline do run (ADR-033). O
**contexto** virou `delta.input` no mesmo movimento: nível, não soma (e sem
somar `cached_input`, que a API da OpenAI já conta dentro do `input_tokens`).
**claude 2.1.220** ❌ — o `result` traz usage e `total_cost_usd` DO TURNO;
**agy** ❌ — não reporta usage. Assimetria interna do Codex que vale lembrar: o
transporte **app-server** publica `thread/tokenUsage/updated` com
`tokenUsage.last`, que **já é do último turno** — só o `exec` acumula.

| | Leitura | **Padrão (PEDE)** | Liberado |
|---|---|---|---|
| **claude** | `--disallowedTools` de escrita | `acceptEdits` + `--permission-prompt-tool` (MCP) | `bypassPermissions` |
| **codex** | `-s read-only` (sandbox de SO) | **`app-server` + `approvalPolicy: untrusted`** | `-s danger-full-access` |
| **agy** | `--sandbox` (best-effort) | ⚠️ **impossível** — nenhum canal | `--dangerously-skip-permissions` (é o único modo) |

**Codex — por que existe um segundo transporte.** `codex exec` é mão única: não tem
`--ask-for-approval` e, sem TTY, nunca pausa. No modo Padrão ele mudava só o
confinamento e **nunca perguntava nada** — o seletor prometia um gate inexistente.
O `codex app-server` (mesmo binário, JSON-RPC NDJSON no stdio, o que a extensão de
IDE usa) manda `item/commandExecution/requestApproval` e **fica parado** esperando
a resposta. Ver `src-tauri/src/codex_appserver.rs`.

- **Só o Padrão** passa pelo app-server (`plan_first` também não: turno de plano é
  read-only, não há o que aprovar). Os outros modos seguem no `exec`, que é
  battle-tested — e o app-server ainda é `[experimental]` na CLI.
- Falha **antes** do turno (spawn/handshake/thread) cai no `exec` com um `Notice`
  visível: perde-se o gate naquele turno, nunca o turno.
- Achado que define o mapeamento: `approvalPolicy: "on-request"` **não pede nada**
  (o modelo só escala se o sandbox barrar — provado: um `touch` fora do workspace
  passou liso). `"untrusted"` é o que pede. Teste que trava isso:
  `padrao_usa_untrusted_o_unico_que_pergunta`.
- Negar responde `decision: "decline"` (o turno continua e o modelo se explica),
  nunca `"cancel"` (mataria o turno inteiro).

**agy — limite honesto.** `--dangerously-skip-permissions` é *"auto-approve all tool
permission requests without prompting"*: o agy TEM pedidos de permissão, mas só na
TUI. Em `-p` (print) não há canal e, sem a flag, ele **trava** esperando um humano
que não existe. Não há `mcp-server`/`app-server`/ACP na 1.1.7. O gate que vale para
ele é o nosso, por turno: **"Planejar primeiro"**. A UI diz isso na cara
(`lib/permissionNote.ts`) em vez de fingir um contrato uniforme.

### 7.2 Anexos (imagem e PDF) por agent — verificado 2026-07

| | imagem | PDF | mecanismo |
|---|---|---|---|
| **claude** | ✅ | ✅ | path absoluto no prompt + `--add-dir`; o modelo abre com `Read`. Read **redimensiona** (3000×2000 → 2000×1333) e recomprime >500KB. PDF ≤10 páginas inteiro; acima disso o modelo usa `pages` sozinho (máx. 20/chamada) |
| **codex** | ✅ | ❌ | `-i <PATH>` → vira `input_image` base64 `detail:high`. Formatos por **magic bytes** (PNG/JPEG/GIF/WebP) |
| **agy** | ⚠️ | ⚠️ | igual ao claude (path + `--add-dir`), aberto pela ferramenta `view_file` |

**Armadilhas que custam caro:**
- `codex exec -i` é **variádico**: sem `--` antes do prompt, o prompt vira mais um
  path de imagem. O adapter já emite o `--`.
- **PDF no `codex -i` falha em SILÊNCIO**: exit 0, stderr vazio, e no rollout o
  arquivo vira o literal `"image content"`. O modelo responde sobre nada. Por isso
  `supports_attachment` do Codex é só `Image` — o bloqueio é nosso, não dele.
- `-i` no **agy** é `--prompt-interactive`, não `--image`. Sem TTY, morre em
  `bubbletea: error opening TTY`.
- O agy **alucina**: 1 em 4 rodadas leu errado uma página de PDF sem sinalizar.
  Melhor esforço, não paridade.

**Plano B documentado (não implementado):** `claude -p --input-format stream-json`
aceita content blocks `image` (base64) e `document` (PDF) e foi **provado** — inclusive
convivendo com `--resume` e `--include-partial-messages`. Não migramos porque o loop
compartilhado força `stdin(Stdio::null())` (o `codex exec` trava sem isso), porque
perderíamos o resize automático do `Read`, e porque o caminho é não-documentado. Se
um dia aparecer relato de "mandei imagem e o Claude ignorou", o gatilho está pronto:
`--input-format stream-json` exige `--output-format stream-json`, que exige `--verbose`.

### 7.3 Contexto do projeto: quem lê o quê (e o que o app injeta)

A instrução era a única camada do contexto **não agnóstica**: cada CLI lê o arquivo do
próprio fornecedor, e o app nunca injetou nenhum deles — só os inventariava no painel.

| fonte | dono (quem lê do disco) | o app injeta? |
|---|---|---|
| `CLAUDE.md` | claude | não — a CLI lê sozinha |
| `AGENTS.md` | codex | não — a CLI lê sozinha |
| `.claude/agents`, `.claude/skills`, `~/.claude/projects/<path>/memory` | claude | não |
| **`.mycockpit/instructions.md`** (doutrina) | **os três** | **sim** — bloco no prompt |
| **`.mycockpit/agents/*.md`** (personas) | **os três** | **sim** — bloco de persona |
| lições e recall (SQLite) | os três | sim — bloco no prompt |

O agy **não tem convenção de arquivo de instrução conhecida**: sem a doutrina injetada,
ele roda sem nenhuma regra do projeto. O painel diz isso na cara em vez de inventar.

**Quando (e por ONDE) a doutrina entra** — a régua é "toda sessão nova de CLI
recebe", e desde o prompt-hygiene-plan (H1/H2/H4, 03/08/2026) o CANAL e a
cadência são por capability, nunca por nome:

- **Motor com `system_channel` (claude)**: doutrina + persona vão no
  `--append-system-prompt`, **re-enviadas a cada spawn** — nunca no corpo do
  prompt. Zero inchaço de histórico, zero eco, frescor automático (edição da
  doutrina mid-conversa chega no turno seguinte de graça). O anúncio de MCPs e
  a TELEMETRIA do mc-work também moram só lá (o corpo fica limpo).
- **Motor com resume e sem canal (codex)**: bloco no corpo do **1º turno** (o
  resume carrega dali em diante) **+ re-injeção com prefixo "(doutrina
  atualizada)" quando o arquivo muda mid-conversa** (H4 — fingerprint no
  ledger efêmero `injected.doctrine` da conversa, store do chat; ledger zerado
  por restart numa conversa já rodada CONTA como mudança — edição feita com o
  app fechado nunca se perde). Sessão FRESCA no meio da conversa (S3.2
  wheel-switch) sempre leva a doutrina, mesma régua do revezamento. O
  preâmbulo de MCP/telemetria segue a mesma régua; mudança no PLANO de MCPs
  mid-conversa re-anuncia via fingerprint (`injected.mcp`, evento
  `mcp://announced`, emitido só depois do run nascer) — inclusive N→0
  (bindings todos desligados anunciam "nenhuma" uma vez).
- **Motor sem resume (agy)**: **todo turno** (sessão fresca, e o recap não
  carrega o prefixo do prompt) — custo honesto, sem alternativa.

| ponto de spawn | quando injeta |
|---|---|
| chat (`ChatPanel`) e mesa (`office/bridge/send`) | régua por capability acima (canal system a cada spawn · corpo 1º turno + frescor · todo turno) |
| revezamento entre agents (transplante, nas duas superfícies) | **sempre** — é sessão fresca, quase sempre em outra CLI (destino com canal system recebe pelo canal) |
| missão (`store/mission`) | **toda fase** (cada fase é um run novo) |
| disputa (`store/fusion`) | **todo candidato** (senão metade dos concorrentes disputa cega) |
| automação agendada (`lib/scheduleEngine`) | **sempre** — é o run DESASSISTIDO: ninguém corrige o rumo às 3h |
| etapa do SDD (`SddView`) | **sempre** — escreve spec e código no repo |

Teto de 12k caracteres no bloco; acima disso corta e **aponta o arquivo** — o agent tem
acesso ao disco e puxa o resto se precisar. Ver ADR-025.

**Fronteira de confiança (H3)**: todo histórico SERIALIZADO reinjetado em
prompt (recap do revezamento/transplante, `serializeContext`, transcript de
retomada, memória sintética do agy) viaja emoldurado em
`<historico-de-contexto>…</historico-de-contexto>` + a linha fixa de que o
bloco é dado, não pedido (`lib/trust.ts`). O conteúdo nunca é reescrito — a
defesa é a moldura.

## 8. Perguntas em aberto (para futuros devs)

1. Semântica exata de *resume* do Codex e do OpenCode (confirmar com a doc/versão).
2. Vale embutir o Claude Agent SDK (sidecar Node) quando precisarmos de callback de
   permissão rico, ou um esquema de aprovação baseado em flags + re-run basta?
3. Como representar *file diffs* de forma uniforme entre agents que reportam `FileChanged`
   e os que não reportam (PTY) — `git diff` da worktree como fonte da verdade?
4. Streaming de `tool_use` *input* parcial (`input_json_delta`) — renderizar ao vivo ou
   só no `ToolCallStarted` completo?
