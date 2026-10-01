# Remoção da aba Features (SDD) · PRD

## Status (13/09/2026)

**Entregue: F1 + F2 + F3 + F4, com D1 a D4 como recomendadas.** Registro em
ADR-185. Suítes rodadas de verdade: `bun run test` 4113 ok em 428 arquivos,
`bunx tsc -b --force` limpo, `cargo test` 766 ok (7 ignorados), `bun run check`
exit 0, testes das guardas (`scripts/lints`) 119 ok.

Testes que migraram em vez de morrer (G3): `inbox.scan.test.ts`,
`db.hardDeleteProject.test.ts`; `db.ledgerHistorico.test.ts` é novo e trava R5.
Baselines apertadas só por `--update`. Ajustes de carona no ADR-185: aba ativa
acesa por baixo da view Frota, varredura do sino sem `catch` e lista congelada
ao arquivar o último projeto.

**Não provado nesta etapa:** G5 no app rodando (boot de build de teste com
`viewMode: "sdd"` persistido). A regra está coberta por teste da migração pura,
não por boot real.

> Precedente direto: `docs/office-removal-plan.md` + ADR-035 (remoção do
> Escritório). Mesma disciplina: corte por fases, restos deliberados escritos
> no ADR, teste vivo não morre de carona.

---

## O problema, na frase do usuário

"Quero remover por COMPLETO essa feature, essa aba Features, ou seja, manter
apenas Painel e Trabalho."

A barra do topo tem três superfícies (`Painel · Trabalho · Features`). A
terceira é o **modo SDD**: um cockpit de entrega de feature que lê
`.claude/plans/<slug>/manifest.json` do projeto, dirige as skills
`/discovery → /prd → /spec → /developer → /test-suite → /code-review → /pr`
pelo AgentRunner, grava o custo por etapa e alimenta a caixa de decisões com
"PRD por aprovar" e "PR aberto".

Pela régua do ADR-035, **toda superfície mantida paga seu custo**. Esta não
paga: o uso diário está no Trabalho, e o SDD depende de um fluxo de skills
externo (`SEED_REPO = github.com/vinicius1209/skills`, já apontado em
`docs/onboarding.md` como default pessoal a avaliar). Manter custa
~4 mil linhas, um módulo Rust com escrita no disco do usuário, uma tabela de
marcas e três conceitos de UI (sidebar de features, gates descobertos,
ignorados) que só existem por causa dele.

---

## O que é "Features" hoje (inventário medido)

### Superfície (some inteira)

| onde | o quê | linhas |
|---|---|---|
| `components/sdd/SddView.tsx` | a view: pipeline, form "Nova feature", seed, aprovar PRD, rodar etapa, bloco de custo | 1415 |
| `components/sdd/StagePipeline.tsx` · `StageRunOverlay.tsx` · `sddFormat.ts` | pipeline, overlay do run, formatação | 309 |
| `lib/sdd.ts` | parse do manifest, `loadSddPlans`, `nextStep`, invokes | 510 |
| `lib/sdd.test.ts` · `lib/sdd.manifest.test.ts` | testes do parse e do fluxo | 430 |
| `src-tauri/src/sdd.rs` | `read_sdd_plans`, `pr_info`, `sdd_ready`, `seed_sdd`, `approve_prd`, `create_plan`, `set_plan_stage` (12 `#[test]`) | 1223 |

### Pontos de costura (mudam, não somem)

**Navegação e chrome**
- `components/layout/titleBarModes.ts`: sai a entrada `sdd` de `MODES`.
- `components/layout/AppShell.tsx`: sai o ramo `viewMode === "sdd"` e o import
  do `SddView`; comentários que citam SDD/Features.
- `components/layout/Sidebar.tsx`: sai `SddFeatureList` (lista de features no
  projeto ativo, botão "Nova feature") e o ramo `viewMode === "sdd"`.
- `store/app.ts`: `viewMode` vira `"painel" | "linear"`; saem `sddFocusSlug`,
  `sddCreateRequested`, `sddDataVersion`, `setSddFocus`, `requestSddCreate`,
  `bumpSddData`; **migração v5** do estado persistido (ver R3).
- `store/interactions/split.ts`: comentário "painel/sdd/agendado".

**Caixa de decisões** (sino, faixa `DecisionStrip`, fila do Painel)
- `lib/inbox.ts`: saem os kinds `prd` e `pr` de `Decision`, `DecisionOrigin`
  (descoberto/ignorado), a varredura de `.claude/plans` por projeto, a adoção
  via `stage_runs` + `sdd_plan_marks`.
- `lib/decisions.ts`: saem os casos `prd`/`pr` de `decisionTs`,
  `decisionNoun`, `decisionLine`.
- `lib/panel.ts`: saem `PrEnrichment`, `parsePrView`, `mergeEligible`,
  `prHealth`, `prResolved`, cache e `fetchPrEnrichment`, `mergePr`;
  `queueRank`/`orderQueue` simplificam (ver D1).
- `components/decisions/DecisionCards.tsx`: saem `PrCard` (com botão de merge)
  e `PrdCard`, e a navegação `setSddFocus` + `setViewMode("sdd")`.
- `components/decisions/DecisionStrip.tsx`: sai o enriquecimento de PR e o
  `mergePr`.
- `components/layout/InboxBell.tsx`: saem os ícones/rótulos de PRD/PR, a seção
  "Encontrados no projeto", os "ignorados" e `setSddPlanIgnored`.

**Banco (TS)**
- `lib/db.ts`: saem `ensureSddMarkTables`, `listSddPlanMarks`, `adoptSddPlan`,
  `setSddPlanIgnored`, `insertStageRun`, `listStageRuns`, `listStageCosts`
  (já sem consumidor hoje), `listDrivenPlanKeys`, e o `DELETE FROM
  sdd_plan_marks` do apagar projeto. `loadLedger` depende de D2.
- `lib/db.sddMarks.test.ts` (230) e `lib/inbox.sdd.test.ts` (646): morrem com
  o código que testam. Ver guarda G3.

**Rust**
- `src-tauri/src/lib.rs`: sai `mod sdd;` e os 7 comandos do `invoke_handler`.
  **As migrações v20/v21 de `stage_runs` ficam** (migração não se apaga; ver D2).
- `src-tauri/src/github.rs`: `gh_pr_view` e `gh_pr_merge` ficam sem
  consumidor se D1 for aprovada, e saem junto (e do `invoke_handler`).
- `fsx.rs`, `proc.rs`, `skills.rs`: só comentário que cita `sdd.rs`. O
  `deaccent` de `skills.rs` hoje "espelha `sdd::deaccent`": vira dono único.

**Painel de contexto (Trabalho)**: depende de D3.
- `src-tauri/src/sources.rs::read_specs` + `lib/sources.ts` (`specs`) +
  seção "Specs" em `ContextPanel.tsx` + `StageBadge` em
  `contextPanelChrome.tsx`.

**Copy e vocabulário**
- `SettingsDialog.tsx:272`: "o modo (Linear/SDD) também são lembrados" vira
  "e a superfície aberta (Painel ou Trabalho)".
- `MicButton.tsx`: "SDD" sai do vocabulário do ditado. "PRD" fica (termo
  comum de quem dita, não depende da feature).
- Comentários com "Painel/Trabalho/Features" em `notify.ts`,
  `ScheduledView.tsx`, `ConversationList.tsx`, `selection.ts`,
  `GlobalInteractionHost.tsx`, `DecisionStrip.tsx`, `TitleBar.tsx`,
  `DecisionCards.tsx`, `contextPanelChrome.tsx`, `lib/agent.ts`,
  `lib/mission.ts`, `store/mission.ts`, `lib/missionTypes.ts`.

**Guardas**
- `scripts/lints/file-size-baseline.json`, `geometria-baseline.json`,
  `filete-baseline.json`: as entradas de `SddView.tsx` e `lib/sdd.ts` viram
  obsoletas. Recolher **pelo `--update` da própria guarda** (a catraca só
  desce), nunca à mão.
- `scripts/lints/deadTokens.mjs`: sai a exceção de `components/sdd/SddView.tsx`;
  o comentário histórico em `deadTokens.test.mjs` pode ficar como referência a
  commit.

**Docs**
- `docs/archive/sdd-mode.md`, `docs/archive/sdd-evolution.md`: arquivados como histórico
  em `docs/archive/` (mesmo tratamento do `agent-office.md`).
- `docs/onboarding.md:67`: a pendência do `SEED_REPO` se resolve pela remoção.
- `docs/architecture.md`, `README.md`: conferir e tirar a terceira superfície
  se aparecer.
- ADR nova em `docs/decisions.md` (a última é ADR-184; conferir no dia).

---

## O que fica (e por quê)

- **Missões e Planos de voo.** São do Trabalho (`MissionLauncher` no composer,
  `MissionTimeline` no `ChatPanel`, `MissionsSection` na sidebar,
  `FlightPlansView` como view global, agendamento via `scheduleMission`). O
  próprio código declara a fronteira: `lib/mission.ts` e `store/mission.ts`
  são "feature INDEPENDENTE do SDD, nada daqui importa `lib/sdd.ts`". Nada de
  missão entra neste corte.
- **A caixa de decisões** com disputa, card do board e proposta do lead.
  O sino, a faixa e a fila do Painel continuam; só perdem os dois kinds que
  vinham do SDD.
- **O Painel** inteiro (retrospectiva de custo, ledger por agente e projeto).
- **O campo `mode` do `.mycockpit/config`** (`lib/mycockpit.ts`,
  `mycockpit.rs`). É passagem opaca; ninguém lê como `viewMode`. O teste de
  `permission.test.ts` que usa `mode: "sdd"` prova que o config preserva
  campos alheios, e segue válido como está.
- **Os arquivos do usuário.** `.claude/plans/`, `.claude/skills/` e o que o
  seed copiou continuam no disco. O app nunca apaga dado de projeto.

---

## Decisões

### D1 · PRD e PR saem da caixa de decisões, junto com o merge pelo Painel

Os kinds `prd` e `pr` só nascem de manifest SDD (`inbox.ts:322-334`). Não
existe outra fonte de "PR aberto" no app. Sem o SDD, eles não têm de onde vir.

**Recomendação: sair tudo.** `queueRank` fica disputa (0) → card e proposta
(1), estável dentro do rank. `gh_pr_view` e `gh_pr_merge` saem do Rust.

Alternativa descartada: manter "PR aberto" lendo manifests sem a aba. Seria a
feature pela metade, com a mesma dependência do fluxo de skills, e sem lugar
para onde o clique levar.

**Consequência visível no Painel e no Trabalho:** quem hoje vê "PR aberto" ou
"PRD por aprovar" na faixa ou no sino deixa de ver. É o efeito pretendido, mas
precisa estar escrito no ADR.

### D2 · Custo histórico de `stage_runs` continua somando no Painel

`loadLedger` faz `UNION ALL` de `turn_costs` com `stage_runs`
(`db.ts:1470`), e `fleet/derive.ts::refreshLedger` usa o mesmo ledger. Esse
dinheiro foi gasto de verdade.

**Recomendação: manter a leitura, cortar toda escrita.** A tabela vira
histórico somente-leitura; o Painel não "desgasta" retroativamente. Custa uma
linha de SQL e um comentário dizendo que é resto deliberado. Migrações v20/v21
ficam (instalação nova ganha tabela vazia, sem efeito).

Alternativa: tirar do `UNION`. Totais de 30 dias e acumulado por projeto caem
para quem usou o SDD, sem aviso. Viola "custo deriva de fonte única, nunca
teatro" no sentido inverso: some gasto real.

`sdd_plan_marks` é diferente: é estado de UI (adotado/ignorado), não dinheiro.
Deixa de ser criada (`ensure*` sai) e a tabela existente fica inerte. **Sem
`DROP`**: migração destrutiva sem ganho para o usuário.

### D3 · A seção "Specs" do painel de contexto sai

`sources.rs::read_specs` lê os mesmos `manifest.json` para listar "Specs" com
`StageBadge` no painel de contexto do Trabalho. É o esquema do SDD aparecendo
por outra porta.

**Recomendação: sai** (`read_specs`, campo `specs` em `sources.ts`, a seção,
`StageBadge`). "Por completo" inclui a leitura do manifest. Personas e Memórias
ficam.

Se preferir manter: a seção vira leitura genérica de `.claude/plans` sem
estágio, e isso é decisão de outra frente, não deste corte.

### D4 · Estado persistido com `viewMode: "sdd"` abre no Trabalho

Quem fechou o app na aba Features não pode abrir em tela branca (é o risco que
o `migratePersistedApp` existe para evitar).

**Recomendação:** `version: 5`, e `fromVersion < 5` com `viewMode` fora de
`["painel", "linear"]` cai em `"linear"`. Mesma forma do v4 do Escritório.

---

## Requisitos

- **R1** · A barra do topo mostra exatamente `Painel · Trabalho`, nesta ordem.
  Nenhum atalho, menu de comando, card ou notificação leva a `viewMode` que
  não existe.
- **R2** · Nenhum caminho de código escreve em `.claude/plans`, roda o seed ou
  clona `SEED_REPO`. `grep -rni "sdd" app/src app/src-tauri/src` só devolve
  os restos deliberados listados no ADR.
- **R3** · Boot com estado persistido `viewMode: "sdd"` (v4) abre no Trabalho.
  Teste em `store/app.migrate.test.ts`/`app.boot.test.ts`.
- **R4** · A caixa de decisões (sino, faixa, fila do Painel) funciona igual
  para disputa, card e proposta, na ordem disputa → card/proposta.
- **R5** · Totais do Painel antes e depois do corte são os mesmos para a mesma
  base (se D2 aprovada).
- **R6** · Configurações sem menção órfã a SDD/Features/Linear.
- **R7** · Apagar projeto continua limpando o que é dele, sem tocar tabela
  que o app não cria mais.

---

## Fases de entrega

Commit por fase, como no ADR-031. Cada fase termina com as suítes verdes.

### F1 · Corte da superfície
`titleBarModes`, `AppShell`, `Sidebar` (`SddFeatureList`), `store/app`
(campos + migração v5), `components/sdd/` inteiro, `lib/sdd.ts` e testes,
copy de Configurações e ditado. Navegação para `"sdd"` em `InboxBell` e
`DecisionCards` passa a ser código morto nesta fase e sai na F2.

### F2 · Caixa de decisões e Painel
`inbox.ts`, `decisions.ts`, `panel.ts`, `DecisionCards`, `DecisionStrip`,
`InboxBell`, funções SDD de `db.ts`, `loadLedger` conforme D2. Testes de
`panel.test.ts` e `decisions.test.ts` perdem os casos de PR/PRD e **mantêm**
os de disputa, card, proposta, janela de custo e ledger.

### F3 · Rust
`sdd.rs`, `mod` e comandos em `lib.rs`, `gh_pr_view`/`gh_pr_merge` em
`github.rs` (D1), `read_specs` em `sources.rs` (D3), comentários de
`fsx.rs`/`proc.rs`/`skills.rs`. `cargo test` verde.

### F4 · Registro e limpeza
ADR (por que saiu, o que ficou, caminho de volta), docs históricos, baselines
recolhidas por `--update`, exceção do `deadTokens`, `onboarding.md`,
`architecture.md`/`README.md`. Grep final de `sdd`, `Features`, `stage_run`,
`prd`, `pr_info`, `setSddFocus`.

---

## Guardas

- **G1** · Suítes completas rodadas de verdade: `cd app && bun run test`,
  `bunx tsc -b --force` a partir de `app/`, `cargo test` a partir de
  `app/src-tauri`, `bun run check`.
- **G2** · Missões e Planos de voo funcionando igual (as suítes
  `mission*.test.ts`, `store/mission.*.test.ts`, `watchdog.missions.test.ts`
  e `companion*.test.ts` são o contrato; nenhuma pode mudar).
- **G3** · **Teste vivo não morre de carona.** Na remoção do Escritório, três
  testes de `buildRecoveryChoice` sumiram junto e voltaram no re-review. Antes
  de apagar `inbox.sdd.test.ts`, `db.sddMarks.test.ts` e casos de
  `panel.test.ts`/`decisions.test.ts`, conferir caso a caso: o que cobre
  disputa, card, proposta, ordenação estável ou ledger migra para o arquivo
  do comportamento que sobrevive.
- **G4** · Nenhuma baseline de catraca editada à mão; só `--update`, e só
  para baixo.
- **G5** · Boot e2e com estado persistido `viewMode: "sdd"` (build de teste)
  abre no Trabalho.

---

## Não-objetivos

- Mexer em Missões, Planos de voo, agendamento, Fusion ou Companion.
- Apagar `.claude/plans`, skills ou qualquer arquivo no projeto do usuário.
- `DROP TABLE` de `stage_runs` ou `sdd_plan_marks`, ou renumerar migração.
- Criar outra fonte de "PR aberto" para substituir o card que sai.

---

## Riscos

- **Custo retroativo (D2).** Se a leitura de `stage_runs` sair por engano
  junto com a escrita, o Painel perde gasto real sem aviso. Coberto por R5.
- **Ordem da fila (D1).** `queueRank` hoje tem cinco degraus com PR nas
  pontas; simplificar sem manter a estabilidade dentro do rank quebra a ordem
  de chegada. O teste de ordenação estável precisa sobreviver (G3).
- **Tela branca no boot (D4).** Coberto por R3 e G5.
- **Árvore compartilhada.** `DecisionCards`, `InboxBell` e `Sidebar` são
  arquivos quentes; conferir `git status` antes de cada fase e não reverter
  mudança alheia.
