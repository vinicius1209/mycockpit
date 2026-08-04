# Notas: `stream-json` do Claude Code

> Compilado de pesquisa + **validado pelo spike M0** rodando contra o `prime-sales-hub`.
> Detalhes variam por versão — re-rode o spike ao atualizar o CLI.

## Versão validada

- `claude --version`: **2.1.187 (Claude Code)**
- Data da validação: **2026-06-25**
- Alvo: `~/projetos/prime/prime-sales-hub` · modelo observado: `claude-opus-4-8[1m]` · 31 tools.

## 🔴 Achado de segurança (o mais importante do M0)

Rodando com `--allowedTools "Read,Glob,Grep"`, o agent **mesmo assim executou `Bash`**
(`ls -d */`). O `claude --help` confirma o modelo mental correto:

| Flag | O que faz de verdade |
|---|---|
| `--allowedTools` / `--allowed-tools` | **Auto-aprovação** (sem prompt). **NÃO impede** outras tools de rodar. |
| `--disallowedTools` / `--disallowed-tools` | **Gate real**: remove a tool do conjunto. ✅ Validado: com `--disallowedTools "Bash"`, o agent reportou *"Bash tool isn't available"*. |
| `--tools` | Define o conjunto de tools disponíveis (`default` = todas, ou lista). |
| `--permission-mode <modo>` | Comportamento de aprovação. Modos confirmados no help: `default`, `bypassPermissions` (lista completa: rodar `claude --help`). |
| `--dangerously-skip-permissions` / `--allow-dangerously-skip-permissions` | Bypassa **tudo**. Só em confiança total. |
| `--add-dir` | Permite tools acessarem diretórios extras. |

**Implicação para o MyCockpit (ADR-009 / `agent-runner.md` §7):** a política de permissão
por projeto **não** pode se apoiar em `--allowedTools` para restringir. Para *remover*
capacidade perigosa, usar `--disallowedTools` (ou `--tools`). Para gating interativo fino
mid-run, o caminho é o callback `canUseTool` do **Agent SDK** (reavaliar ADR-006).

## Flags de saída / sessão

| Flag | Comportamento |
|---|---|
| `-p` / `--print` | Não-interativo: uma chamada, resposta, sai |
| `--output-format stream-json` | **JSONL** (uma linha JSON por evento) |
| `--verbose` | **necessário** com `stream-json` |
| `--include-partial-messages` | inclui deltas (`stream_event`); **sem ela, texto vem como `assistant` completo** (confirmado) |
| `--resume <session_id>` | retoma a sessão — ✅ validado (lembrou do contexto do projeto) |
| `--continue` | retoma a sessão mais recente do diretório |

## Inventário de eventos observado (spike M0)

Tipos realmente emitidos nesta versão (todos tratados sem crash):

- `system/init` — tem `session_id`, `model`, `tools` (qtd). **Onde o `session_id` aparece.**
- `system/hook_started`, `system/hook_response` — hooks do usuário disparando (4+4 aqui).
- `system/thinking_tokens` — contagem de thinking.
- `assistant` — `message.content[]` com blocos `text` e `tool_use`. (texto chega aqui)
- `user` — `tool_result` devolvido ao modelo.
- `result` (subtype `success`) — `result`, `is_error`, `session_id`, `total_cost_usd` (~0,34 USD aqui).
- `rate_limit_event` — **não documentado**; traz `rate_limit_info` (janela `five_hour`,
  `overageStatus`). Tratado como `Unknown` pelo parser. Útil para a UI mostrar limites.

> Lição confirmada: **nunca dropar evento desconhecido** — `rate_limit_event` e os
> `system/*` de hook não estavam previstos e apareceram. O parser defensivo aguentou.

## Permissões em headless (sem terminal)

- Não há prompt interativo em `-p`. Restrição real = `--disallowedTools`/`--tools`;
  auto-aprovação = `--allowedTools`; bypass total = `--dangerously-skip-permissions`.
- Default são do MyCockpit (M5): remover tools perigosas via `--disallowedTools` por
  projeto + `--permission-mode` adequado. Confirmar interação com o `settings.json` do
  usuário (que tem `acceptEdits` global e hooks).

## Checklist do M0 — ✅ resolvido

- [x] Texto vem como `assistant` completo (deltas só com `--include-partial-messages`).
- [x] `--allowedTools` aceita vírgula **ou** espaço; mas **não restringe** (ver achado).
- [x] `--permission-mode` existe (`default`, `bypassPermissions`, …) — listar com `--help`.
- [x] `session_id` aparece no `system/init`.
- [x] Tool não permitida: **roda mesmo assim** com allowedTools; **bloqueia** com disallowedTools.
- [x] `tool_use` (bloco em `assistant`) e `tool_result` (evento `user`) renderizados.
- [x] `--resume <id>` continua a conversa. Custo ~US$0,34/run (opus 4.8).

## Background tasks / trabalho diferido (spike D0, v2.1.219 — 2026-07-31)

> Validado por `spikes/deferred-work/driver.py` + forense do incidente deep-research
> (sessão `e3b21a87`, projeto `~/projetos`). Base do `docs/deferred-work-plan.md`.

Quando o modelo usa a tool `Workflow` (ou `Bash run_in_background`), o stream emite
eventos `system` **estruturados** — hoje todos descartados pelo adapter:

| subtype | payload relevante | semântica |
|---|---|---|
| `background_tasks_changed` | `tasks: [{task_id, task_type, description}]` | **lista COMPLETA** de tasks vivas; `[]` = nada pendente (o sinal canônico) |
| `task_started` | `task_id`, **`tool_use_id`**, `task_type: "local_workflow"`, `workflow_name`, `prompt` | `tool_use_id` liga o task ao bloco `tool_use` `Workflow` que o criou (vínculo determinístico) |
| `task_progress` | `description`, `usage {total_tokens, tool_uses, duration_ms}`, `workflow_progress [{workflow_phase / workflow_agent}]` | progresso ao vivo, inclusive **depois** do fim lógico do turno |
| `task_updated` | `patch {status, end_time}` | mudança de estado |
| `task_notification` | `status: completed\|stopped`, `summary`, `output_file` | conclusão (ou parada) do task |

**Comportamento do `-p` one-shot com task pendente (o achado central):** o CLI
**segura a emissão do `result`** — mantém o turno aberto streamando `task_progress`,
re-invoca o modelo quando o workflow conclui (aparece um **segundo `system/init`**),
e descarrega os DOIS `result` juntos antes do EOF. Custo do segundo `result` é
**cumulativo**. Provado 2×: workflow rápido (13,9s total) e lento (38,1s; turno do
modelo acabou aos 8s e o processo esperou).

**Teto de espera (derivado do BUNDLE do CLI, v2.1.219 — não reproduzido em
laboratório):** no código minificado do binário:
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? 600000` (10 min) e grace de wind-down de
`5000` ms, com os logs `"print wind-down: no longer waiting on background …
after 5000ms grace"` / `"killing background shell … after 5000ms grace"`. No
wind-down o CLI marca o task como `stopped`, mata shells background e sai —
orfanando o trabalho. Bate com o incidente: workflow de ~20 min, `result`
descarregado aos ~10min28s sem turno de conclusão. A env var é a alavanca do
D2-A: o app sobe o teto para 4h no spawn (`adapters.rs`, ClaudeAdapter).
Proveniência: engenharia reversa das strings do bundle + forense do incidente;
um repro controlado (run >10 min com e sem a env) ainda não foi rodado — se o
comportamento divergir numa versão futura, é aqui que se atualiza. O ceiling só
arma com stdin FECHADO (gate `inputClosed`) — ver modo bidirecional acima.

**Modo bidirecional (`--input-format stream-json`, stdin aberto):** o `result` do
turno sai **imediatamente** (sem hold), o processo segue vivo, e a conclusão do
task chega como **push espontâneo**: `task_notification` → segundo `system/init` →
`assistant` novos → segundo `result`. O wind-down/ceiling só arma com stdin
FECHADO (gate `inputClosed` no bundle) — com stdin aberto a espera é indefinida.
É o transporte natural para turnos-push (D2-B).

**Morte + resume:** se o processo morre com task pendente, o próximo
`--resume` recebe injetada uma mensagem `user` (string) com
`<task-notification>…<status>stopped</status>…` e instrução de relançar com
`Workflow({scriptPath, resumeFromRunId})` — as fases completas voltam do cache
(journal em `~/.claude/projects/<proj>/<sessão>/subagents/workflows/<runId>/`).
Payload real arquivado no plano D1 e nas fixtures de teste.

## Fontes

- Validação empírica: `spikes/m0-stream-json/` + `claude --help` (v2.1.187);
  `spikes/deferred-work/` (v2.1.219).
- Docs: code.claude.com/docs (CLI/Headless/Agent SDK), opencode.ai, aider.chat, developers.openai.com/codex.
