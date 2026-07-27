# Hierarquia de trabalho vivo — visibilidade estilo CLI

> Status: proposta / design. Nada implementado ainda.
> Objetivo: dar ao mycockpit a visibilidade que o Claude Code CLI tem — ver
> workflows, agents e processos rodando, com contexto e agrupamento, num lugar
> sempre visível e navegável.

## O problema, em uma frase

Hoje o mycockpit **executa** trabalho concorrente (turnos, missões, sub-agents,
disputas) e **já mede** tempo/tokens/custo de tudo isso — mas não **modela a
hierarquia** entre as unidades de trabalho. O resultado são três sintomas que
parecem separados e são o mesmo bug de fundação:

1. **Sem tray global de trabalho vivo.** Não existe o rodapé do CLI
   (`pesquisa-multimodal-headless · 4/5 agents done · 39m 57s · ↓521k tokens`).
   A agregação existe espalhada em 3 lugares, nenhum é um dock persistente.
2. **Sub-agents viram lista plana.** Quando o agent despacha um time, os
   `Read`/`Bash` dos sub-agents escorrem num fio único, sem dizer quem fez o quê.
3. **Processo não é cidadão.** `docker compose up` / `npm run dev` não existem
   como nó rastreável — viram uma linha de tool que trava e trunca a ~600 chars.

## A causa-raiz única: a árvore de trabalho

Toda unidade de trabalho tem um pai. Se o app modelasse isso, as três telas
caem de graça.

```
conversa
 └─ turno / missão (fase)
     ├─ agent principal
     │   ├─ tool (Read, Bash…)
     │   └─ sub-agent (Task)          ← hoje: parentesco jogado fora
     │       ├─ tool                  ← hoje: escorre plano no fio
     │       └─ tool
     └─ processo (docker/dev server)  ← hoje: nem existe como nó
```

Uma causa, três superfícies consumidoras do **mesmo** modelo:

- **Superfície 1 — Dock/tray global:** a árvore vista de cima, agregada.
- **Superfície 2 — Aninhamento inline:** a árvore vista de dentro, no chat.
- **Superfície 3 — Processo como nó:** docker/dev server rastreável e re-attachável.

---

## O que JÁ existe (reusar, não recriar)

A infra está ~70% pronta. Mapa do que reaproveitar:

### Registries de trabalho vivo
- `app/src/store/chat.ts:87` — `ConvState`: `running`, `runId`, `startedAt`,
  `contextTokens`, `items[]`. Um por conversa; N concorrentes.
- `app/src/store/mission.ts:64` — `mission.byConv: Record<convId, MissionRun>`;
  `MissionRun` (`app/src/lib/missionTypes.ts:139`) tem `phases[]`, `current`,
  `costTotal`, `status`, `startedAt`. Já dá "X/Y fases".
- `fusion.byConv` — disputas vivas.
- Backend: `app/src-tauri/src/agent.rs:24` — `RunRegistry` (mapa `run_id → pid` +
  sinal de cancel), suporta N runs; `attachments.rs:310` — `ActiveConvs`.

### Telemetria por turno (tempo/tokens/custo) — pronta
- `app/src/store/chat.ts:57` — `ChatItem` tipo `"result"`: `costUsd`, `usage`,
  `durationMs`. Preenchido no reducer em `chat.ts:475`.
- `app/src/components/chat/MessageList.tsx:729` — `TeleStrip` (o card
  "TEMPO/TOKENS/CACHE/CUSTO"). `sessionCost` somado on-the-fly em `:1001`.
- `app/src/lib/format.ts` — `fmtCost`/`fmtDuration`/`fmtTokens` (pt-BR).
- Persistência: `app/src/lib/db.ts:1069` `recordTurnCost` (tabela `turn_costs`);
  `loadLedger` unifica `turn_costs ∪ deliveries ∪ stage_runs`.

### Agregação cross-projeto — JÁ EXISTE (a mina de ouro)
- `app/src/App.tsx:355-495` — o `useEffect` que monta `TraySnapshot` iterando
  `chat.byId` running + `mission.byConv` running + `fusion.byConv`. **Esta é
  literalmente a lógica do "4/5 agents done".** Precisa virar hook compartilhado.
- `app/src/lib/tray.ts` — `TrayActivity`/`TraySnapshot` (`kind`, `startedAt`,
  `agent`, `detail`, contadores).
- `app/src/components/tray/TrayPopover.tsx` — popover que já renderiza isso.
- `app/src/components/panel/MissionControl.tsx:628` — strip de frota + custo
  hoje/7d/30d + sparkline. Quase um dashboard.
- `app/src/components/layout/Sidebar.tsx:325` — `useRunningConvIds` etc.: pulso
  de status por conversa/projeto.

### Superfície visual — o Escritório
- `app/src/office/bridge/derive.ts:312` `deriveScene` — já mapeia
  missão/turno → mesas/avatares por projeto. É agregação visual pronta.

---

## O que NÃO existe (criar)

1. **Parentesco no dado.** `parent_tool_use_id` do stream-json é **descartado**
   em `app/src-tauri/src/adapters.rs:432` (colapsado num booleano `is_subagent`,
   id do pai jogado fora). Nunca chega ao frontend.
2. **Hierarquia no store.** `ChatItem` tool (`chat.ts:47`) não tem `parentToolId`.
   `buildNodes` (`app/src/components/chat/messageNodes.ts:38`) agrupa por
   **adjacência de stream**, não por pai.
3. **Agregado ao vivo somando tokens/custo/tempo dos runs ativos.** Hoje é
   por-turno (MessageList) ou por-janela histórica (ledger). Falta o "39m 57s ·
   521k tokens" somando o que respira agora.
4. **Rodapé persistente único.** Hoje é tray popover + strip do MissionControl +
   linha "Sessão" — nenhum é um dock sempre-visível.
5. **Processo como cidadão.** Sem background shell, sem PTY, sem re-attach
   (ver `docs/stream-json-notes.md` e a análise de shells).

---

## Plano por superfície

### Superfície 2 primeiro — Aninhamento inline (menor risco, maior clareza)

Conserta a "lista plana" e **prova o modelo de hierarquia** end-to-end antes de
investir no dock. Cadeia mínima:

- **S2.1 — Preservar o pai no adapter.** Adicionar `parent_tool_id: Option<String>`
  ao `AgentEvent::Tool` (`agent.rs:111`) e parar de descartar em `adapters.rs:446`.
  Fazer o equivalente no Codex app-server (`codex_appserver.rs`).
- **S2.2 — Carregar no store.** Campo `parentToolId?` no `ChatItem` tool
  (`chat.ts:47`); preencher no reducer (`chat.ts:441`).
- **S2.3 — Agrupar por pai.** Em `messageNodes.ts:buildNodes`, quando um tool tem
  `parentToolId`, aninhá-lo sob o card do Task pai (`presentTool` já tem
  `case "Task"` com `subagent_type` em `toolview.ts:336`) em vez do `ToolGroup`
  por adjacência.
- **S2.4 — UI de aninhamento.** Card de sub-agent colapsável no `MessageList`,
  com contagem "N tools · X linhas" e status ○/✓ agregado dos filhos.

> Guarda: quando `parentToolId` estiver ausente (Codex legacy, streams antigos),
> cair no comportamento plano atual — fail-open pra render.

### Superfície 1 — Dock de trabalho vivo (o rodapé do CLI)

- **S1.1 — Hook agregador compartilhado.** Extrair `App.tsx:355-495` para um
  `useLiveWork()` que devolve a árvore de runs vivos + somatórios.
- **S1.2 — Somatório ao vivo.** Somar tokens/custo/tempo através dos runs ativos
  (hoje só conta `running` nº). Reusar `MissionRun.costTotal`/`phases` e
  `ChatItem.result.usage`.
- **S1.3 — Componente de dock persistente.** Rodapé fixo (ou promoção do
  `TrayPopover`) listando cada unidade viva: nome, ○/✓, X/Y, tempo, tokens/custo,
  **clicável pra focar a conversa/missão**. Reusar `TrayActivity` + `format.ts`.
- **S1.4 — Onde encaixa.** Decisão de UX: rodapé global vs. faixa no Escritório
  vs. ambos. (ver Perguntas abertas)

### Superfície 3 — Processo como nó (maior esforço, decidir escopo)

Duas rotas, escolher uma (ver análise de shells):
- **Rota leve — background task estilo `/bashes`:** ensinar o adapter a lidar com
  `run_in_background`/`BashOutput`, bufferizar stdout, expor como nó "processo" na
  árvore com polling. Sem PTY.
- **Rota completa — terminal PTY estilo Cursor:** `portable-pty` no Rust +
  `xterm.js` no front. Melhor UX pra docker/dev server, muito mais custo.

> Recomendação: adiar S3 pra depois de S1+S2 provarem o modelo. O ganho imediato
> (visibilidade + agrupamento) vem de S1/S2 e não depende de PTY.

---

## Ordem sugerida

1. **S2** (aninhamento inline) — valida o modelo de hierarquia com risco baixo.
2. **S1** (dock global) — reusa a agregação que já existe + o modelo de S2.
3. **S3** (processo) — só depois, e primeiro a rota leve.

## Perguntas abertas (decisões pendentes)

- Onde o dock vive: rodapé global persistente, faixa no Escritório, ou os dois?
- Escopo de S3: rota leve (`/bashes`) basta, ou você quer terminal PTY completo?
- O dock agrega cross-projeto (toda a frota) ou só o projeto em foco?
