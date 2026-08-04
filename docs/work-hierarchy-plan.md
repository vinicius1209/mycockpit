# Visibilidade de trabalho vivo — Proposta A (Fio Vivo), multi-provider

> Status: implementado e validado em 30/07/2026.
> Mock de validação: `docs/mocks/work-visibility.html` (abre na Proposta A;
> galeria de estados no fim, incl. multi-provider e interno/externo).
> Extensão (31/07): o Plano 1 ganhou nós com **ciclo de vida próprio** para
> trabalho interno do provider que ULTRAPASSA o turno (tool `Workflow` /
> background tasks do Claude) — ver `deferred-work-plan.md` e ADR-028. Mesmo
> vocabulário de estados do nó de processo externo (A2.3), incl. `interrompido`.

## Entregue

- Fio Vivo inline no chat, com árvore acessível e navegação por
  `↑`/`↓`/`←`/`→`; o ramo ativo abre sozinho e os detalhes continuam sob demanda.
- O plano vivo tem um único instrumento canônico junto ao composer, aberto
  enquanto o turno está em voo. No transcript fica apenas o marco compacto
  `Plano publicado`, que vira resumo final expansível; planos são isolados por
  pedido e nunca reutilizam tarefas de um turno anterior.
- Sem update explícito do provider, a primeira etapa aparece como `Próxima`, não
  como falsamente ativa. `TaskUpdate`/`work_update` são a única fonte de
  progresso em andamento.
- Ponteiros reais de pai/filho do Claude preservados até a UI; no Codex, comandos
  aparecem desde `item/started`. Providers que não reportam estrutura continuam
  no fallback plano, sem árvore inventada.
- MCP interno uniforme `mc-work` para Claude e Codex, com `work_plan`,
  `work_update`, `process_start`, `process_poll` e `process_stop`.
- Processos externos pertencem ao MyCockpit: PID, grupo de processos,
  stdout/stderr em tail, parar e repetir. Um processo que estava vivo no replay
  vira `órfão`, nunca aparece falsamente como ainda executando.
- Reação removida dos fragmentos intermediários. Há uma única faixa de emojis no
  resultado terminal de cada pedido; transformar a reação em aprendizado abre
  uma proposta editável e exige confirmação de escopo antes de gravar a memória.
- Briefings de subagente ficam em disclosure compacto; durante a execução, ações
  anteriores são agrupadas e só o ramo atual permanece em evidência. O provider
  mora no cabeçalho do agente, e a interrupção informa quando só existe controle
  do turno completo.

## O objetivo

O mycockpit é um **cockpit multi-provider**: conversa com Claude Code CLI, Codex,
Antigravity (`agy`) — e adiante OpenCode. A visibilidade precisa deixar **CLARO
pro usuário o que CADA motor está fazendo**, incluindo trabalho interno (raciocínio,
tools, sub-agents) e processos externos (docker, dev servers, shells). Não é a
"árvore do Claude" — é um modelo **normalizado e agnóstico de provider**, com
degradação honesta conforme o que cada motor consegue reportar.

## A decisão de UI: Proposta A — Fio Vivo (inline, aninhado no chat)

Comparadas 3 abordagens (ver mock): A (inline), B (dock persistente), C (painel
lateral). **Escolhida: A** — é evolução do que já existe (`buildNodes`,
`TaskChecklist`, `ToolGroup`), não superfície nova. Escopo por conversa.

---

## Os DOIS planos de visibilidade (o eixo central)

O "interno vs externo" mapeia em dois planos com **donos diferentes** — e é isso
que resolve o multi-provider:

### Plano 1 — Trabalho interno (reportado pelo PROVIDER)
Raciocínio, tool calls, sub-agents. Quem produz é o motor; a granularidade é o
que cada um emite. **Degradação honesta — não inventar árvore que o motor não
reporta.** Cada nó leva o **selo do motor** (vem de `conv.agent`).

| Motor | Tool calls | Sub-agents | Custo | Árvore |
|---|---|---|---|---|
| Claude Code (`adapters.rs:176`) | estruturados, ao vivo | sim (`parent_tool_use_id`, `adapters.rs:432`) | USD real | **rica** |
| Codex (`adapters.rs:583`, `codex_appserver.rs`) | ao vivo desde `item.started` | não | estimado (`pricing::estimate`) | **média** (folhas) |
| Antigravity `agy` (`adapters.rs:871`) | ❌ só texto cru (sem `--output-format json` na v1.0.16) | não | ❌ | **pobre** (bolha) |
| OpenCode (`agents.ts:210`) | não implementado no Rust | — | — | — |

### Plano 2 — Processos externos (do MYCOCKPIT, uniforme)
Docker/dev servers/shells long-running. Chave: se o **agent** roda `pnpm dev` pela
Bash-tool dele, o processo é filho da CLI do motor — o mycockpit **não tem o pid
nem o stdout**, só vê um `Tool`. Não dá pra attachar.

**Solução agnóstica:** o mycockpit vira o **dono do substrato de processos**. Ele
já roda um MCP server interno (approval-server, `adapters.rs:260`); expõe uma
capability de processo (spawn + buffer + poll + kill) via MCP, e **qualquer motor
que fale MCP usa a mesma coisa**. Processo externo fica idêntico entre providers,
com saída/parar/pid que o app controla de verdade. Onde não dá pra rotear (agy sem
MCP), cai no Plano 1 (aparece como tool/texto). Honesto.

> Interno = o motor reporta (granularidade variável). Externo = o mycockpit
> spawna (uniforme). Um nó de processo tem **ciclo de vida próprio** — nunca trava
> o turno esperando um `tool_result` que não vem (hoje trava: `adapters.rs:485`).

---

## A árvore de trabalho (modelo único)

```
turno (bolha do agent) ── selo do motor (claude/codex/agy)
 └─ [espinha]  = to-do se existir, senão o próprio turno
     ├─ tarefa in_progress
     │   ├─ tool (interno, granularidade do provider)
     │   ├─ sub-agent (Task) ── só Claude reporta          ← determinístico
     │   │   └─ tool  (parent_tool_use_id = Task)
     │   └─ processo (externo, do mycockpit)               ← uniforme, via MCP
     └─ tarefa pending…
```

Dois vínculos: sub-agent→Task **determinístico** (`parent_tool_use_id`);
tool/processo→tarefa **temporal** (tarefa `in_progress` no momento).

---

## Entrega implementada

### ✅ A1 — Primitivo de árvore + aninhar sub-agents + selo de provider
Menor esforço, conserta a "lista plana" (print dos study agents) e planta a
fundação (o nó de árvore + o selo do motor que tudo reusa).
- **A1.1** — propagar o pai: adicionar `parent_tool_id: Option<String>` ao
  `AgentEvent::Tool` (`agent.rs:111`); parar de descartar em `adapters.rs:446`
  (hoje vira só `is_subagent`, `adapters.rs:432`). Equivalente no Codex.
- **A1.2** — `parentToolId?` no `ChatItem` tool (`chat.ts:47`) + reducer (`chat.ts:441`).
- **A1.3** — agrupar por pai em `buildNodes` (`messageNodes.ts:71`).
- **A1.4** — card de sub-agent colapsável (○/✓/✕ agregado). `presentTool` já tem
  `case "Task"` com `subagent_type` (`toolview.ts:336`).
- **A1.5** — selo de provider no nó, derivado do `conv.agent` do turno (barato;
  provider não vive no evento hoje — mas o turno inteiro é um motor só).

### ✅ A2 — Plano de processos externos (mycockpit-owned, MCP) — cobre foreground E detached
A capacidade nova de verdade. Escopo confirmado: **detached (`docker -d`) E
foreground long-runner (`pnpm dev`)**.
- **A2.1** — registry de processos no Rust (além do `RunRegistry` que só guarda o
  pid da CLI de topo, `agent.rs:24`): spawn com stdout bufferizado (tail em anel),
  poll, kill. Sem PTY (sem input interativo).
- **A2.2** — expor via MCP interno (ao lado do approval-server) pra qualquer
  motor iniciar/consultar/matar processo de forma uniforme.
- **A2.3** — nó de processo com ciclo próprio + estados: **vivo · encerrou 0 ·
  falhou (saiu N) · órfão** (morto no restart, `RunRegistry.kill_all`, `agent.rs:32`).
- **A2.4** — UI: saída sob demanda (mini-terminal), ações abrir/parar/ver saída/
  retentar/retomar. Marcado "externo".

### ✅ A3 — To-do como espinha
Trabalho pendura sob a tarefa `in_progress` (vínculo temporal). Estende
`deriveTasks`/`TaskChecklist` ou compõe em `buildNodes`.

---

## Decisões travadas
1. **Espinha sem to-do** → to-do se existir, senão o turno.
2. **Ordem de vínculo** → determinístico (A1) antes do temporal (A3); selo de
   provider já em A1.
3. **Escopo de A2** → detached **e** foreground long-runner (`/bashes` completo,
   sem PTY), via substrato de processo do próprio mycockpit exposto por MCP.

## Estados que a UI cobre (galeria do mock)
- Time de sub-agents: done colapsa; falha à mostra ("✕ N ações falharam").
- Processo nos 4 estados com ações contextuais.
- Fallback sem to-do (espinha = turno).
- **Multi-provider:** Claude (árvore rica) vs Codex (folhas, sem galhos) vs agy
  (só texto) — degradação honesta com selo do motor.

## Guardas
- `parentToolId` ausente (Codex legacy/agy/streams antigos) → render plano
  (fail-open).
- Replay-safe: a árvore deriva de `items` (como `deriveTasks`); reconstrói após
  restart. Processo órfão mostra estado honesto, não "rodando".
- Nó de processo é assíncrono ao ciclo do turno — nunca trava.
- Degradação honesta: nunca desenhar estrutura que o provider não reportou.

## Fora de escopo
- Dock global cross-projeto (B) e painel lateral (C) — descartados.
- Terminal PTY / input interativo no shell — não; só visibilidade + saída sob
  demanda + parar.
