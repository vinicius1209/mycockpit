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

### CONTRATO (fixo — o time coda contra isto)

**1. MCP tools** (no nosso server stdio, ver approval.rs):
- `approval_prompt` (JÁ EXISTE) — decisão de permissão.
- `ask_user` (NOVO) — input schema ESPELHA o AskUserQuestion:
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
  { id: string, kind: "approval" | "question", data: ApprovalData | QuestionData }
  ```

**4. Comando Tauri** (frontend → app): generaliza `answer_approval`:
  ```ts
  answer_interaction(id: string, answer: ApprovalAnswer | QuestionAnswer): Promise<void>
  ```

**5. Tipos no frontend** (`lib/agent.ts` ou `lib/interaction.ts`):
  ```ts
  interface InteractionRequest { id: string; kind: "approval" | "question"; data: unknown }
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
- Codex: sem equivalente headless → segue como está (perguntas viram texto).

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
