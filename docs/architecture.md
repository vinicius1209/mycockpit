# Arquitetura

## Visão geral (alvo)

```
                UI React (chat-centro)
                       │  Tauri IPC / Channels
        ┌──────────────┴───────────────┐
        │                              │
   Chat Engine                  Mission / Workflow Engine
        │                              │
   Agent Registry  ──────────────► Permission System (por projeto)
        │
   Agent Runner (trait)  ── adapters: ClaudeCode | Codex | OpenCode | Aider
        │
   Process Manager (Rust): spawn + parse (v0.1)  /  PTY + tmux (v0.2+)
        │
────────────────────────────────────────────────────────
   claude · codex · opencode · aider · (depois) docker · git · MCP
```

A UI **só conhece eventos normalizados** (ver [`agent-runner.md`](./agent-runner.md)).
Ela nunca fala o "dialeto" de um agent específico — isso é trabalho do adapter.

### Fundação atual do Workflow Engine

O primeiro contrato do Workflow Engine já existe dentro do Mission. Um **Plano
de voo** é um template reutilizável (`MissionPreset`) e uma **Missão** é a
execução concreta desse template numa conversa/worktree. Presets antigos sem
metadado continuam sendo `linear`; planos com `mode: "graph"` carregam um
`MissionPlanGraph` versionado, independente da biblioteca visual.

Na v1 do canvas, o grafo é uma cadeia única válida por construção. Reordenar os
nós atualiza `preset.phases`, portanto o mesmo `missionEngine.ts` executa tanto
o editor linear quanto o canvas. Ramificações, condições diferentes de
`success` e loops já têm lugar no schema de arestas, mas o import os rejeita
até o executor de grafo oferecer semântica de budget, recovery e retomada para
essas transições. Detalhes em [`mission-flight-plans.md`](./mission-flight-plans.md).

A autoria vive numa superfície global própria, **Planos de voo**, mas permanece
dentro do mesmo app e sobre a mesma fonte persistida
(`GlobalSettings.missionPresets`). Configurações apenas habilita Missions e abre
esse workspace; não mantém um segundo editor concorrente.

## Decisão central do v0.1: CLI subprocess + `stream-json`

No v0.1, o backend Rust do Tauri **executa o binário `claude`** com
`-p --output-format stream-json --verbose` e parseia o JSONL. Não embutimos o
Claude Agent SDK (que é TS/Python) — isso exigiria um *sidecar* Node.

**Por quê CLI subprocess e não o SDK?**

| | CLI subprocess (escolhido) | Agent SDK (sidecar Node) |
|---|---|---|
| Dependência | só o `claude` (já instalado) | + runtime Node embutido |
| Eventos | JSONL via stdout | objetos tipados |
| Permissão mid-run | flags (`--allowedTools`, `--permission-mode`) | callback `canUseTool`, hooks |
| Complexidade | baixa | média/alta |
| Quando reconsiderar | — | se precisarmos de callback de permissão rico/interativo |

> O SDK volta à mesa quando a política de permissão precisar de **aprovação
> interativa fina mid-run** (M5+). Até lá, flags resolvem.

## Por que não há terminal embutido no v0.1

Eventos estruturados (`tool_use` + output) viram cartões no chat. Sem necessidade de
emulador de terminal. Detalhe no `PLAN.md` §5.3.

## Quando o terminal/PTY entra (v0.2+)

Para agents **sem** saída estruturada (ex.: Aider) ou para um terminal interativo real:

- **`portable-pty` (Rust) + xterm.js + Tauri Channel** — stack provado para embutir
  terminal. Para "um agent por vez", o *exit do processo* já sinaliza "done".
- **tmux *control mode* (`-C`/`-CC`)** — adicionar quando quisermos **persistência**
  (agents sobrevivem a fechar/reabrir o app, *detach/reattach*) e **multiplexação**
  de vários painéis com eventos de ciclo de vida (`%output`, `%window-add`, `%exit`…).
  Libs Rust: `tmux_interface`, `tmux-lib`. Prior art: **TmuxCC** (monitora agents de IA
  em painéis tmux), e a integração `tmux -CC` do iTerm2.
  - Limite: control mode dá **ciclo de vida**, não estado semântico ("agent terminou de
    pensar"); e o `%output` é byte cru → ainda precisa de xterm.js para renderizar.

## Persistência

SQLite local (Zustand para estado de UI, TanStack Query para dados assíncronos):
- `projects` (path, nome, contexto lido, política de permissão)
- `conversations` / `messages` (com referência a `session_id` do agent)
- `agent_sessions` (id nativo do agent + metadados para `--resume`)

## Dependências externas (assumidas presentes)

`claude` CLI autenticado. O `Runner.detect()` deve checar presença + versão e avisar a UI
cedo se faltar (em vez de falhar no meio de uma tarefa).
