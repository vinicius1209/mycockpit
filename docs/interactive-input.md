# Interação pendente — o agente pede input no meio do turno (padrão unificado)

> Problema: quando o agente chama uma tool que precisa de VOCÊ no meio do turno
> (aprovar comando, responder pergunta estruturada, aprovar plano), o MyCockpit
> ou erra (AskUserQuestion → turno morre) ou já resolve pontual (aprovação).
> Este doc define UMA abstração — "interação pendente" — que cobre todos os
> casos sob o mesmo guarda-chuva. Data: 2026-07-13.

## O achado que decide a arquitetura (investigação oficial)
- **Aprovação** tem hook de CLI dedicado (`--permission-prompt-tool`) → já feito.
- **AskUserQuestion** é tool interativa-only; no `claude -p` headless **erra** e
  não tem `canUseTool` no CLI (só no Agent SDK). Responder via
  `--input-format stream-json` existe mas o **protocolo é não-documentado**
  (github.com/anthropics/claude-code/issues/24594) → frágil, quebra a cada update.
- **Saída robusta E bonita**: NÃO usar o AskUserQuestion built-in. Em vez disso,
  **desabilitá-lo** e expor uma tool NOSSA (`ask_user`) no **mesmo MCP server**
  que já criamos pra aprovação. Ela bloqueia no socket → o app renderiza o card
  → você responde → devolve → o turno continua. MCP é documentado e estável.
  Degrada gracioso: se o modelo preferir perguntar em texto, o app já renderiza.

## A abstração: uma interação, N tipos
Um MCP server (extensão do `approval.rs`), um socket IPC, um evento normalizado,
uma camada de UI que escolhe o card por `kind`.

```
kind = "approval" | "question" | "plan"(futuro)
```

### ⚠️ CORREÇÃO CRÍTICA DO ESTUDO (2026-07-13) — leia antes
- O `--permission-prompt-tool` (que a aprovação usa) **NÃO responde tools
  interativas**: a doc oficial converte `allow`→`deny` p/ tools com
  `_meta["anthropic/requiresUserInteraction"]`. Só o `canUseTool` do SDK faria.
- Logo, a `ask_user` **NÃO é uma tool de permissão** — é uma **tool de CONTEÚDO
  normal**: o modelo a chama, ela bloqueia no socket, o app renderiza o card,
  o usuário responde, e a resposta volta como o **RESULTADO da tool** (content
  block). **NÃO** ligar `ask_user` no `--permission-prompt-tool`, **NÃO** marcar
  `requiresUserInteraction`. Isso a torna robusta no `-p`.
- Decisão: **opção B** (MCP tool própria). C (stream-json) descartada
  (não-documentada, issue #24594 "not planned"). A (SDK) é norte futuro, fora
  de escopo. AskUserQuestion + ExitPlanMode built-in **desabilitados**
  (`--disallowedTools`) → nunca erram; degradam pra texto se o modelo não usar
  a nossa tool.

### CONTRATO (fixo — o time coda contra isto)

**1. MCP tools** (no nosso server stdio, ver approval.rs):
- `approval_prompt` (JÁ EXISTE) — decisão de permissão, via `--permission-prompt-tool` (só Padrão).
- `ask_user` (NOVO) — **tool de CONTEÚDO** (listada em tools/list, chamada
  diretamente pelo modelo; o resultado É a resposta). Registrada em TODOS os
  modos. Input schema ESPELHA o AskUserQuestion:
  ```jsonc
  // input
  { "questions": [
    { "header": "string(≤12)", "question": "string",
      "multiSelect": false,
      "options": [ { "label": "string", "description": "string" } ] }
  ] }
  // output (content block de texto com JSON stringificado):
  { "answers": [ { "header": "string", "selected": ["label", ...] } ] }
  ```

**2. Socket IPC** (MCP server → app → resposta), 1 linha JSON por sentido:
  ```jsonc
  // pedido (server → app)
  { "id": "uuid", "kind": "approval"|"question", "data": { /* por kind */ } }
  //   approval.data = { "tool_name", "command", "input" }
  //   question.data = { "questions": [...] }  (o input do ask_user)
  // resposta (app → server)
  { "id": "uuid", "answer": { /* por kind */ } }
  //   approval.answer = { "allow": bool, "updated_input"?, "message"? }
  //   question.answer = { "answers": [ { "header", "selected": [] } ] }
  ```
  Fail-closed: erro/timeout de IPC → approval=deny, question=cancelado.

**3. Evento Tauri** (app → frontend): generaliza `approval://request`:
  ```ts
  // "interaction://request"
  { id: string, run_id: string, kind: "approval" | "question",
    data: ApprovalData | QuestionData }
  ```
  ⚠️ `run_id` é IRMÃO de `data`, não vai dentro dele — é o `handle_conn` que o
  conhece (o MCP server não), então ele é anexado só na emissão do evento. É o
  campo que amarra o pedido à conversa dona (`ownerByRunId`, em
  store/interactions): lido do lugar errado, TODO pedido vira órfão e cai no
  toast global, mesmo com a conversa aberta na tela. O canal legado
  `approval://request` replica o run_id dentro de `data`; quem lê usa
  `runIdOf()`, que aceita os dois.

  ⚠️ Vale para os DOIS kinds: o `handle_conn` anexa o run em toda emissão, então
  uma `question` tem dono igual a um `approval`. É isso que faz pergunta pendente
  acender a conversa e o projeto na sidebar (`useAwaiting`) e renderizar INLINE na
  conversa dona em vez de ir pro toast do canto. O recorte approval-only
  sobrevive só onde a superfície fala de permissão: `convIdForInteraction`, usado
  pela mão da mesa no office (rótulo "Aguardando aprovação") e pelo item de
  aprovação do companion.

**4. Comando Tauri** (frontend → app): generaliza `answer_approval`:
  ```ts
  answer_interaction(id: string, answer: ApprovalAnswer | QuestionAnswer): Promise<void>
  ```

**5. Tipos no frontend** (`lib/agent.ts` ou `lib/interaction.ts`):
  ```ts
  interface InteractionRequest { id: string; run_id?: string;
    kind: "approval" | "question"; data: unknown }
  interface QuestionData { questions: { header: string; question: string;
    multiSelect: boolean; options: { label: string; description: string }[] }[] }
  interface QuestionAnswer { answers: { header: string; selected: string[] }[] }
  // approval mantém o shape atual
  ```

**6. Adapter** (`adapters.rs`, ClaudeAdapter):
- Registra o MCP server em TODOS os modos (hoje é só Padrão p/ aprovação) —
  `ask_user` vale sempre. `--permission-prompt-tool` segue só no Padrão.
- **Desabilita** os built-ins interativos: `--disallowedTools AskUserQuestion,ExitPlanMode`
  (mescla com os de read-only). ExitPlanMode cai em texto (card de plano = futuro).
- **Nudge** via `--append-system-prompt`: "Para perguntas com opções ao usuário,
  use a tool mc__<server>__ask_user (não escreva a pergunta como texto se houver
  escolhas claras)."
- Codex: **tem** equivalente headless — ver §7 abaixo (não é MCP, é o app-server).

**7. Segundo produtor de interação: o Codex** (`codex_appserver.rs`, 2026-07)

O `approval` deixou de ser exclusivo do Claude. O contrato acima (kind + data +
evento + `answer_interaction`) é o MESMO; o que muda é de onde o pedido vem:

| | Claude | Codex |
|---|---|---|
| canal | MCP server stdio + socket Unix por-run | JSON-RPC (NDJSON) no stdio do `codex app-server` |
| pedido | tool `approval_prompt` bloqueia | `item/commandExecution/requestApproval` |
| registro | `ApprovalListener` (socket) | `DirectInteractions` (sem socket) |

`DirectInteractions` (approval.rs) é o `handle_conn` sem o socket: registra em
`PendingApprovals`, emite `interaction://request`, espera o oneshot, e o
`shutdown()`/Drop resolve fail-closed + emite `interaction://resolved`. **A UI não
mudou uma linha** — o card do Codex é o mesmo `ApprovalData { tool_name, command,
input }` (`tool_name` = "Bash" p/ comando, "Edit" p/ patch).

Pedidos do app-server que ainda NÃO viram card (`item/tool/requestUserInput`,
`item/permissions/requestApproval`, `mcpServer/elicitation/request`) recebem erro
JSON-RPC `-32601` + um `Notice` visível: nunca penduram o turno e nunca fingem
aprovação. Mapear o `requestUserInput` para o kind `question` é o próximo passo
natural (o shape das perguntas dele ainda não foi capturado de um run real).

## UI — o card por kind
- **approval** (existe): banner Aprovar/Negar acima do composer.
- **question** (novo): card com um bloco por pergunta — radios (multiSelect
  false) ou checkboxes (true), + "Outro" (campo livre, opcional), + botão
  Responder. Fila se vierem várias. Turno marcado PAUSADO. Reusa o
  ApprovalModal → vira `InteractionHost` genérico.

## Fora do escopo do v1 (a abstração já suporta depois)
- `kind: "plan"` (ExitPlanMode) com card de plano — por ora ExitPlanMode
  desabilitado → texto.
- Persistência da interação pendente entre restart (efêmera; se o app cai, o
  RAII nega/cancela e o turno segue — nunca pendura).

## Decomposição do time
- **Backend (Rust):** extensão do MCP server (`ask_user`), generalização do
  socket/evento (`approval://` → `interaction://`), adapter (disallow + register
  sempre + nudge), comando `answer_interaction`. Arquivos: approval.rs (ou novo
  interaction.rs), adapters.rs, agent.rs, lib.rs.
- **Frontend:** `interaction.ts` (tipos + subscribe do evento + answerInteraction),
  `InteractionHost` (generaliza ApprovalModal; card de approval + card de
  question), montagem no ChatPanel. Arquivos: lib/agent.ts→lib/interaction.ts,
  ApprovalModal.tsx→InteractionHost.tsx, ChatPanel.tsx.
- **Seam:** este contrato (§Contrato). Ninguém muda o contrato sem avisar.
