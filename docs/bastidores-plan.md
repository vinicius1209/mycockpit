# Bastidores: ver e acompanhar o que roda fora da conversa principal (plano)

> Status: **B0 a B3 entregues (16/09/2026, ADR-200)**: terminal na aba
> Bastidores do painel direito (abas ou até 3 vistas lado a lado), índice com
> teclado, tail com teto, saída do Codex fora do fio. B4 (parar pelo motor)
> adiado. Mocks em `docs/mocks/bastidores.html` e
> `docs/mocks/bastidores-terminal.html` (A2 + C1 escolhidos).
> Complementa `deferred-work-plan.md` (D0, D1 e D2-A entregues; D2-B pendente) e
> `work-hierarchy-plan.md`.

> **Correção (16/09/2026, ADR-200) — manda sobre o texto abaixo:**
> - A lista É a aba "Bastidores" do painel direito, com contador dos vivos, e as
>   vistas abrem NA MESMA aba, como terminal (abas, ou lado a lado), com o
>   painel alargando enquanto elas existem. A linha "N trabalhos em background"
>   do fio abre a aba. Até o build #389 as vistas dividiam o cartão central com
>   a conversa, e o composer quebrava em três linhas; saiu.
> - O terminal é só leitura: a Frota mostra a saída que o motor já produz (arquivo,
>   stream ou resultado). Sem PTY, sem xterm.js, sem mandar tecla a processo.
> - B0 mostrou que, no modo headless, o shell do Claude e o terminal do Codex
>   morrem com o turno; só o subagente do Claude sobrevive. A vista diz isso.
> - "Parar" sai do B1–B3 e fica no B4.

## O pedido

"Ele mostra que tem dois trabalhos em background, mas tem que ser mais intuitivo.
No CLI do Claude Code eu consigo ir com as setas nesses subprocessos e
acompanhar. Dá para evoluir a Frota a um nível profissional de ver
subprocessos, trabalhos em background e agentes em background, nem que seja
abrindo split view ou N views, sem tirar o foco da conversa principal?"

Hoje a Frota mostra uma linha: "2 trabalhos em background · bash ••• 2min 37s".
Não diz quais, não mostra a saída, não deixa entrar em nenhum.

## Dá? Sim. O que cada motor entrega de verdade

| fonte | o que existe | já chega na Frota? | evidência |
|---|---|---|---|
| Claude Code, shell em background | `task_started` (id, descrição, `tool_use_id`), `background_tasks_changed` (lista viva), `task_updated` (status), `task_notification` (status, `output_file`) | sim, vira `DeferredWork`; o `output_file` já é guardado e monitorado (`agent.rs`), mas **não é exibido** | stream real de 16/09 em `testdata/claude-2.1.270/resume-apos-tarefa-parada.jsonl` |
| Claude Code, subagentes | mensagens e tools do subagente com `parent_tool_use_id`; journal em `~/.claude/projects/<proj>/<sessão>/subagents/` | sim, agrupados como galho no fio (`messageNodes.ts`) | incidente deep-research (`deferred-work-plan.md`) |
| Claude Code, parar tarefa | `stop_task` e `background_tasks` por `control_request` | **não**: exige transporte bidirecional (D2-B) | lista de controles no binário 2.1.270 |
| Codex | `commandExecution` com `processId`, deltas de saída ao vivo, interação de terminal, e `thread/backgroundTerminals/clean` para encerrar | parcialmente: a Frota usa o app-server, mas não expõe processo por processo | `app-server-protocol` v2 da tag `rust-v0.154.0` |
| agy | tools `command_status`, `send_command_input`, `invoke_subagent`, `manage_subagents` no stream | como tool comum | init real com as 56 tools; **a verificar** o que o stream diz de subagente vivo |
| Qualquer motor, SO | árvore de processos do run (descendentes, memória) | sim, já medida (`runLiveness`, aviso de 2,5 GB) | incidente de memória de 15/09 |
| Frota (`mc-work`) | processos iniciados pelo agente via `process_start` | sim, `ProcessosPopover` | ADR-173 |

Conclusão: **listar, acompanhar a saída ao vivo e abrir lado a lado cabe no que já
chega hoje**. Parar uma tarefa pelo motor depende de canal que ainda não temos
no Claude (D2-B); no Codex existe; e parar o processo do SO, com confirmação, já
existe como gesto na casa.

## A proposta

### Um lugar: "Bastidores" no painel direito

Aba nova no painel direito do Trabalho (onde já moram Arquivos e Alterações),
com a lista viva de tudo que roda fora da resposta principal desta conversa:

- **Tarefas** do motor (shell em background, workflow), com estado, idade e
  última linha da saída.
- **Subagentes**, com o que cada um está fazendo agora.
- **Processos** do run e do `mc-work`, com memória.

Teclado como no CLI: ↑/↓ percorre, Enter abre, Esc volta. A linha de "2
trabalhos em background" no fio vira atalho para esta aba.

### Entrar sem sair: split e N vistas

- **Abrir ao lado:** Enter abre o item num painel dividido à direita da conversa
  (o mesmo esqueleto do `BranchSplitView`), com a saída ao vivo (tail do
  `output_file`), ou o fio do subagente.
- **N vistas:** fixar até 3 itens em mosaico; cada vista tem seu estado e fecha
  sozinha, com aviso honesto, quando o trabalho acaba.
- A conversa principal continua viva e com o composer; nada rouba foco.

### Movimento com significado (ADR-179/180)

Nada de animação decorativa: pulso só no item com saída NOVA nos últimos
segundos, contador que assenta quando uma tarefa conclui, e item que para de
respirar quando o processo parou (com o motivo).

### Gestos

- **Parar**: um a um, com confirmação e o alvo na cara (regra do
  `ProcessosPopover`). Codex pelo canal do motor; Claude pelo processo do SO até
  o D2-B existir, dito na interface.
- **Abrir resultado em disco**, **copiar saída**, **mandar para a conversa**
  (cita a saída no composer, sem enviar).

## Fases

| fase | entrega | depende de |
|---|---|---|
| B0 | Sonda: stream real de subagente assíncrono do Claude, background terminal do Codex e subagente do agy, com fixtures | nada |
| B1 | Aba Bastidores com lista viva (tarefas, subagentes, processos) e teclado | B0 |
| B2 | Vista ao vivo de uma tarefa (tail do `output_file` com teto e fim honesto) aberta em split | B1 |
| B3 | N vistas fixadas em mosaico | B2 |
| B4 | Parar pelo motor (Codex já; Claude com D2-B) | D2-B |

## Não fazer

- Terminal interativo embutido (PTY) para "entrar" no processo: a Frota é
  headless por decisão; acompanhar e parar cobre o pedido sem abrir essa porta.
- Mostrar saída sem teto: tail com limite e aviso de truncamento.
- Inventar estado: tarefa sem evento novo não "roda", ela fica "sem notícia há
  N min", com o processo do SO como prova.
