# Notas: `stream-json` do Claude Code

> Compilado de pesquisa (mid-2026). **Detalhes variam por versão do CLI** — o spike M0
> (`spikes/m0-stream-json/`) existe para confirmar o comportamento real. Atualize esta
> página com seus achados e a versão testada.

## Versão validada

- `claude --version`: `____________` (preencher ao rodar o spike)
- Data da validação: `____________`

## Flags relevantes

| Flag | Comportamento |
|---|---|
| `-p` / `--print` | Modo não-interativo: uma chamada, resposta, sai |
| `--output-format text` | (padrão) texto puro |
| `--output-format json` | JSON único com `result`, `session_id`, `usage`, `total_cost_usd` |
| `--output-format stream-json` | **JSONL** (uma linha JSON por evento, em tempo real) |
| `--verbose` | **necessário** com `stream-json` para emitir os eventos completos |
| `--include-partial-messages` | inclui deltas parciais (eventos `stream_event`); requer `stream-json` + `--verbose` |
| `--input-format stream-json` | aceita JSONL no stdin |
| `--resume <session_id>` | retoma uma sessão |
| `--continue` | retoma a sessão mais recente do diretório |
| `--allowedTools "<lista>"` | whitelist de tools (ex.: `"Read,Glob,Grep"`, `"Bash(git *)"`) |
| `--permission-mode <modo>` | modos conhecidos: `default`, `acceptEdits`, `plan`, `bypassPermissions` |

> ⚠️ **Cautela:** alguns nomes de `--permission-mode` que apareceram em fontes
> secundárias (`dontAsk`, `auto`) **não estão confirmados** — validar contra
> `claude --help` da sua versão antes de usar.

## Tipos de evento (stream-json)

Cada linha é um JSON independente com um campo `type`:

- `system` (subtype `init`): `session_id`, `model`, `tools` disponíveis, MCP servers, plugins.
- `assistant`: mensagem do modelo sob `message.content[]` (blocos `text` e `tool_use`).
- `stream_event`: eventos parciais (com `--include-partial-messages`):
  `message_start`, `content_block_start`, `content_block_delta` (`text_delta`,
  `input_json_delta`), `content_block_stop`, `message_delta`, `message_stop`.
- `user`: `tool_result` devolvido ao modelo.
- `result`: final — `result`, `is_error`, `session_id`, `usage`, `total_cost_usd`
  (e `structured_output` se `--json-schema`/`--output-schema` foi usado).

## Continuação de sessão

```bash
# captura
sid=$(claude -p "Analise o projeto" --output-format json | jq -r '.session_id')
# retoma
claude -p "Agora foque no módulo de auth" --resume "$sid"
```
Transcrições ficam em `~/.claude/` (escopo: projeto + worktrees). Para portar entre
máquinas, salvar o arquivo de transcrição.

## Permissões em headless (sem terminal)

- **Não há prompt interativo** em `-p`: tudo é decidido por `--allowedTools` +
  `--permission-mode` (ou, via Agent SDK, callback `canUseTool` / hooks `PreToolUse`).
- Combos seguros (a confirmar):
  - read-only: `--allowedTools "Read,Glob,Grep"` (o que o spike usa).
  - commits só: `--allowedTools "Read,Edit,Bash(git *)"`.
  - dev local confiável: `--permission-mode acceptEdits`.
  - ⚠️ `--permission-mode bypassPermissions`: **só** em ambiente de confiança total.

## ✅ Checklist a preencher rodando o spike

- [ ] Texto vem como `assistant` completo, como `stream_event` deltas, ou ambos?
- [ ] `--include-partial-messages` muda isso como?
- [ ] `--allowedTools` aceita vírgula, espaço, ou ambos?
- [ ] `--permission-mode` — quais valores a SUA versão aceita (`claude --help`)?
- [ ] `session_id` aparece em quais eventos?
- [ ] Tool **não permitida** em `-p`: deny silencioso, erro, ou trava?
- [ ] Formato exato do `tool_use` e do `tool_result` (anexar 1 exemplo de cada).

## Fontes

- Claude Code CLI Reference / Headless / Agent SDK (code.claude.com/docs)
- OpenCode docs (opencode.ai/docs/cli), Aider (aider.chat/docs), Codex (developers.openai.com/codex)
