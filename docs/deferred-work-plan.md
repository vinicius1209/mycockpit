# Trabalho diferido do provider — plano (Fio Vivo, Plano 1½)

> Status: **D0 ✅ · D1 ✅ · D2-A ✅ (31/07/2026, ADR-028)** · D2-B e D3.2 pendentes.
> Proposto em 31/07/2026, a partir do incidente `deep-research` (mesmo dia).
> Investigação forense: sessão `e3b21a87` do projeto `~/projetos`, journal em
> `~/.claude/projects/-Users-viniciusmachado-projetos/e3b21a87…/subagents/workflows/wf_3f484d03-7ff/`.
> Complementa `work-hierarchy-plan.md`: aquele deu ciclo de vida próprio ao trabalho
> **externo** (processos, Plano 2); este dá o mesmo direito ao trabalho **interno do
> provider que ultrapassa o turno** (Plano 1).

## A dor (o incidente que define o escopo)

O usuário pediu uma pesquisa profunda; o Claude Code lançou um workflow em background
(~25 subagentes) e encerrou o turno prometendo "aviso quando terminar". O que aconteceu:

1. **11:27** — turno 1 lança o workflow. UI carimba **"concluído ✓"** às 11:37; o
   workflow segue rodando *dentro* do processo `claude`, invisível.
2. **~11:38** — o processo encerra; o workflow morre no meio. Silêncio total.
3. **11:38:56** — o usuário cutuca ("cade a conclusão?"). Só aí o harness injeta no
   `--resume` a `<task-notification>` *"stopped — no completion record"*. O modelo
   relança o workflow.
4. **11:40–11:48** — o processo fica vivo **8 min após o `result`** (UI já dizia
   "concluído") rodando o workflow — até morrer com assinatura de SIGKILL (quit do
   app → `RunRegistry::kill_all`, `lib.rs:553`), journal cortado em `started` sem
   `result`.
5. **12:27–12:30** — terceira cutucada; o modelo lê o journal na mão e entrega o
   relatório. **2 horas e 3 cutucadas** para um resultado que existia em disco.

## A causa raiz (não é bug pontual)

O mycockpit assume que **todo trabalho vive dentro do turno**: um processo
`claude -p` por envio (`agent.rs:554-666` — spawn → stream até EOF → `wait()` →
drop dos guards e sockets MCP por-run, `work_gateway.rs:414-419`). O Claude Code tem
primitivos que **sobrevivem ao turno** — tool `Workflow`, `Bash run_in_background`,
subagentes async — desenhados para um harness residente que é *re-invocado* por
`task-notification` quando o trabalho conclui. No modelo atual não há quem receba a
re-invocação. Três faltas somadas:

1. **Nenhuma detecção**: zero ocorrências de `Workflow`/`run_in_background`/
   `task-notification` no código. O `result` com workflow vivo vira "concluído" seco.
2. **Nenhum push pós-turno**: todo mecanismo de re-invocação existente (fila,
   auto-resume de rate-limit, agendamento, watchdog) é *pull do app*. Evento do
   provider após o turno não tem para onde ir — o Channel fechou.
3. **Morte silenciosa**: `kill_all` no quit e o exit natural não distinguem processo
   ocioso de processo carregando 25 subagentes.

Pela régua da casa: é o ADR-013/017 ("silêncio nunca para quem está esperando") e o
ADR-015 ("surfaçar o que o CLI faz") numa camada nova — e o ADR-021 estendido: *o
turno morre honesto, mas o trabalho que ele deixou vivo ainda não tem esse direito*.

**Agnosticismo**: a arquitetura (trait + eventos normalizados) está certa; o que
falta é um **conceito normalizado** — *trabalho diferido* — com capability por
provider e degradação honesta, no mesmo espírito da matriz de permissões
(`agent-runner.md` §7.1). Transporte dedicado por adapter já tem precedente:
`codex_appserver.rs`.

---

## Fase D0 — Spike (estilo M0; decide o caminho das fases seguintes)

O achado dos 8 minutos sugere que o `claude -p` **fica vivo após o `result`**
enquanto há background work rastreado — e talvez emita novos eventos (e um segundo
`result`) quando o workflow conclui. Se confirmar, o conserto é muito menor do que
parece: o loop de leitura já vai até EOF; talvez os eventos pós-`result` já cheguem
e só não sejam tratados.

- **D0.1** — script reproduzível em `spikes/deferred-work/`: um workflow trivial de
  2 agentes via `claude -p --output-format stream-json`, cronometrando
  `result` → EOF e capturando TODO o stdout pós-`result`.
- **D0.2** — responder com evidência (registrar versão do CLI, como o M0):
  1. O `-p` segue vivo até o workflow concluir? Há timeout/grace?
  2. Ao concluir, emite eventos novos no stdout (re-invocação) e um segundo `result`?
  3. `kill -9` no meio + `--resume` → a `task-notification` *stopped* é injetada?
     (já evidenciado no incidente; travar com repro)
  4. Com `--input-format stream-json` (bidirecional): a notificação chega como turno
     novo? `--resume` convive? (o §7.2 do agent-runner já provou o convívio p/ anexos)
- **D0.3** — atualizar `stream-json-notes.md` com o inventário observado
  (`task-notification`, forma dos eventos pós-result).

**Gate de decisão:**
- Se (2) = sim → **Caminho A** (D2-A): o `-p` one-shot já sustenta o ciclo; a
  correção é de estado/render, não de transporte.
- Se (2) = não → **Caminho B** (D2-B): transporte bidirecional por conversa.
- (4) informa o D2-B independentemente.

### ✅ Resolvido em 31/07/2026 (claude 2.1.219) — Caminho A, com um achado a mais

Rodado `spikes/deferred-work/driver.py` (3 execuções) + engenharia reversa do
bundle do CLI. Inventário completo em `stream-json-notes.md` §Background tasks.

1. **O `-p` one-shot sustenta o ciclo inteiro** — e melhor do que o previsto: ao
   encerrar o turno com task pendente, o CLI **segura a emissão do `result`**,
   mantém o processo vivo streamando `system/task_progress`, re-invoca o modelo
   quando o workflow conclui (segundo `system/init` no mesmo stream) e descarrega
   os dois `result` juntos antes do EOF. Provado com workflow rápido e lento.
2. **O teto de espera existe e explica o incidente**: no bundle,
   `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? 600000` — **10 minutos**, com wind-down
   de 5s de grace que marca o task como `stopped` e mata shells background
   ("print wind-down: no longer waiting on background…"). Os "10min 28s" do turno 1
   do incidente são esse ceiling estourando. **É env var**: o app pode subir o teto
   no spawn — vira a alavanca central do D2-A.
3. Detecção não precisa farejar tool: o stream emite `system/background_tasks_changed`
   (lista completa; `[]` = nada pendente), `task_started` (com `tool_use_id` →
   vínculo determinístico), `task_progress`, `task_updated`, `task_notification`.
4. Morte + `--resume` injeta `<task-notification>` `stopped` com instrução de
   `resumeFromRunId` (payload real arquivado; fases completas voltam do cache).

**Consequência:** D2-A é o caminho: subir o ceiling via env no spawn + tratar o
segundo `system/init`/`result` como continuação + watchdog ciente do hold. D2-B
(residente) deixa de ser pré-requisito para o cenário do incidente e fica como
evolução (push entre turnos + anexos base64).

## Fase D1 — Detecção + honestidade ✅ (entregue 31/07/2026)

Objetivo: nunca mais "concluído ✓" escondendo trabalho vivo, e nunca mais morte
silenciosa. Mesmo sem entrega automática do resultado, o usuário VÊ e RETOMA.

- **D1.1** — detectar trabalho diferido no `ClaudeAdapter`:
  `ToolCallStarted` com `name == "Workflow"`; `Bash` com `run_in_background: true`;
  `tool_result` correspondente (extrair `runId`/task-id do texto); e o padrão
  `<task-notification>` (status `completed`/`stopped`) chegando como mensagem `user`
  no resume. Novo evento normalizado `AgentEvent::DeferredWork { id, kind, status }`
  (extensão em `agent.rs:111`, mesmo movimento do `parent_tool_id` do A1.1).
- **D1.2** — reducer + item sintético no fio, espelhando o precedente
  `ManagedProcess` (`chat.ts:1716-1861`): nó de trabalho diferido com ciclo de vida
  **próprio**, estados `rodando · concluiu · interrompido · retomável`, pendurado no
  Fio Vivo como o nó de processo externo (A2.3). Selo do motor no nó.
- **D1.3** — meta do turno honesto: com diferido pendente, o estado pós-`result`
  deixa de ser "concluído" seco e vira **"concluído · trabalho em background
  rodando (nome)"** (o estado `finalizing` de `chat.ts:817-830` já existe — ganha
  rótulo e deixa de ser invisível). `Done` com diferido incompleto → o nó vira
  **"interrompido"** com ação **Retomar** (dispara um envio de resume; a
  task-notification injetada faz o resto — comprovado no incidente).
- **D1.4** — morte consciente: o quit do app com diferido vivo avisa antes do
  `kill_all` (`lib.rs:553-559`), como se avisa de processo externo; o botão
  "Interromper turno" diz que também mata o trabalho em background.
- **D1.5** — replay-safe: no restore, diferido `rodando` vira `interrompido`
  (mesmo padrão de `markOrphanedProcesses`, `chat.ts:120-145`). Nunca "rodando"
  falso.
- **D1.6** — testes vitest (pt-BR, convenção da casa): detecção dos 3 gatilhos,
  transição de estados do nó, órfão no replay, e fixture REAL de
  `task-notification` (lição do ADR-16: fixture irreal esconde bug).

## Fase D2 — Entrega automática do resultado (caminho conforme D0)

### D2-A — o `-p` já sustenta o ciclo ✅ (entregue 31/07/2026)
Entrega real: ceiling de espera subiu para 4h via env no spawn
(`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, adapters.rs) e o vigia de turno mudo
trata progresso de diferido como sinal de vida (watchdog.ts). D2A.1/D2A.2 já
tinham sido absorvidos pela D1 (o reducer colapsa os dois `result` mantendo o
custo cumulativo, e o segundo `system/init` é inofensivo — travado em teste).
Itens abaixo mantidos como registro do desenho original:
- **D2A.1** — não tratar `result` como fim do render: eventos pós-`result`
  (assistant/tool/result novos) continuam alimentando o fio como continuação do
  turno; validar que o reducer aceita (hoje `controlFlow` zera `runId` no `result`,
  `chat.ts:817-830` — ajustar para só zerar no `Done`).
- **D2A.2** — custo/usage: segundo `result` soma no turno (fonte `Reported`),
  não sobrescreve.
- **D2A.3** — watchdog/auto-resume: ensinar `watchdog.ts` e `autoResume.ts` que
  "finalizando com diferido vivo" não é turno travado — não matar nem re-enviar.

### D2-B — se precisar de harness residente (ou como evolução)
- **D2B.1** — transporte `ClaudeStreamTransport` sob a mesma trait (precedente
  `codex_appserver.rs`): **um processo por conversa**, `claude -p --input-format
  stream-json --output-format stream-json --include-partial-messages`; turnos são
  mensagens `user` no stdin; o processo NÃO morre no fim do turno.
- **D2B.2** — ciclo de vida do residente: morre em conversa fechada/troca de agent/
  quit (com o aviso do D1.4); idle-timeout configurável — **nunca** com diferido
  vivo; crash → respawn com `--resume` (a degradação de `session_not_found` de
  `agent.rs:464-504` já existe).
- **D2B.3** — task-notification vira **turno novo do agente** na conversa ("voltei
  com o relatório"), com aviso pelos 3 canais do ADR-013 — a promessa "aviso quando
  terminar" passa a ser verdade.
- **D2B.4** — semânticas que mudam e precisam ser revisitadas: permissão fixa no
  spawn (o aviso "vale a partir do próximo envio" do ADR-014 muda de significado),
  contagem de custo por turno vs por sessão, fila coalescida
  (`ChatPanel.tsx:678-686`) pode virar envio direto no stdin.
- **Bônus pago pelo mesmo trabalho**: destrava anexos base64 (o "Plano B provado"
  do `agent-runner.md` §7.2 — a objeção do `stdin(Stdio::null())` era do loop
  compartilhado; transporte dedicado não a tem).

## Fase D3 — Capability matrix + degradação honesta (multi-provider)

- **D3.1** — `deferred_work: bool` na matriz de capacidades: Claude ✅,
  Codex ❌, agy ❌, OpenCode a confirmar. UI degrada honesta (sem nó inventado).
- **D3.2** — enquanto D2 não estiver entregue num provider/modo, decidir por
  projeto: permitir (com a honestidade do D1) **ou** suprimir a capacidade
  (`--disallowedTools "Workflow"`) para o modelo nunca prometer notificação que a
  plataforma não entrega — mesmo espírito do limite honesto do agy (§7.1).
- **D3.3** — doc: ADR nova registrando o conceito, e atualizar
  `work-hierarchy-plan.md` (o Plano 1 ganha nós com ciclo próprio).

---

## Decisões a travar

1. **Ordem**: D0 e D1 em paralelo (D1 não depende do gate); D2 depois do gate; D3
   fecha.
2. **Onde o nó mora**: no Fio Vivo, como irmão do nó de processo externo — mesmo
   vocabulário de estados (`vivo · concluiu · falhou · órfão/interrompido`).
3. **Retomar ≠ repetir**: "Retomar" reaproveita o cache do workflow
   (`resumeFromRunId`/journal); nunca relançar do zero sem dizer o custo.
4. **D2-A não exclui D2-B**: A é o conserto do modo atual; B é a evolução que
   também paga anexos e turnos-push. Podem coexistir (B atrás de flag por projeto).

## Guardas

- Degradação honesta: nunca desenhar diferido que o provider não reportou; sem
  detecção → comportamento de hoje (fail-open).
- Diferido é assíncrono ao turno: **nunca** trava `finalizing` à espera de um
  workflow (o turno fecha; o nó continua vivo por conta própria).
- Replay-safe: tudo deriva de `items`; estado "rodando" nunca sobrevive a restart.
- Notificação injetada (`<task-notification>` no transcript) é entrada NÃO
  confiável — tratar como dado (render), jamais como comando do app.
- Cada afirmação sobre comportamento do CLI entra em `stream-json-notes.md` com
  versão — o D0 é a fonte, não suposição.

## Pendências anotadas pelo review gate (31/07, não bloqueantes)

- **Task_id reusado num resume real**: o nó terminal é definitivo por decisão
  (running atrasado não ressuscita). Se um resume re-emitir `task_started` com o
  MESMO `task_id`, o nó ficaria "interrompido" com trabalho vivo — desonestidade
  invertida. Não observado; registrar em `stream-json-notes.md` quando o resume
  real for exercitado.
- **Fusion ignora `deferred_work`**: candidato FusionRo que lançar `Workflow`
  fica invisível e órfão em silêncio (FusionRo desliga MCP, não a tool
  `Workflow`). Cobrir na D3.2 (supressão via `--disallowedTools "Workflow"` nos
  modos onde diferido não é suportado/visível).

## Fora de escopo

- Workflow engine próprio do mycockpit (o dono do harness é o provider; nosso
  papel é visibilidade + ciclo de vida, como no Plano 2).
- PTY/terminal interativo; SDK sidecar Node (ADR-006 segue de pé — D2-B é CLI
  subprocess, só muda o modo de I/O).
- Dock global cross-projeto (segue descartado do work-hierarchy-plan).
