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
  - Claude Code → `--allowedTools` / `--permission-mode`.
  - Outros → melhor esforço conforme a capacidade.
  - **PTY (Aider)** → ⚠️ não dá para interceptar mid-run; mitigar com *worktree* (v0.3)
    e/ou config nativa do agent. **Documentar esse limite na UI.**
- Default são (M5): `AcceptEdits` + **Bash pergunta** (`ask_on: ["Bash"]`).

## 8. Perguntas em aberto (para futuros devs)

1. Semântica exata de *resume* do Codex e do OpenCode (confirmar com a doc/versão).
2. Vale embutir o Claude Agent SDK (sidecar Node) quando precisarmos de callback de
   permissão rico, ou um esquema de aprovação baseado em flags + re-run basta?
3. Como representar *file diffs* de forma uniforme entre agents que reportam `FileChanged`
   e os que não reportam (PTY) — `git diff` da worktree como fonte da verdade?
4. Streaming de `tool_use` *input* parcial (`input_json_delta`) — renderizar ao vivo ou
   só no `ToolCallStarted` completo?
