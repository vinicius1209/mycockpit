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

## Fontes

- Validação empírica: `spikes/m0-stream-json/` + `claude --help` (v2.1.187).
- Docs: code.claude.com/docs (CLI/Headless/Agent SDK), opencode.ai, aider.chat, developers.openai.com/codex.
