# Mission hardening — plano (honestidade, custo, launcher, estrutura)

> **STATUS (04/08/2026, após o gate de review de MH1+MH2):**
>
> - **MH1 ✅ entregue** (MH1.1–MH1.4): desfecho com ressalva nos 4 lugares +
>   `reviewerApproved` endurecido; fases marcadas unattended (fail-closed
>   ADR-021) + vigia de fase muda no ticker único (`checkStalledMissions`);
>   recovery com card no Trabalho (`MissionTimeline`); worktree criado no
>   launch (`ensureMissionCwd`, fallback só com confirm explícito).
> - **MH1 · correção do tester ✅**: memória do loop de revisão
>   (`reviewLoops`/`lastReview`) persiste no run-state e re-hidrata na
>   retomada (clamp de `MAX_REVIEW_LOOPS` sobrevive a crash; arquivo legado
>   deriva das fases `fix-N`/`rereview-N`); `reviewCaveat` serializado no
>   run-state E no índice `missions` (coluna `review_caveat`);
>   `buildRecoveryChoice` movido pra `lib/recoveryChoice.ts` (fonte única dos
>   dois cards de recovery).
> - **MH1 · ressalvas do gate ✅**: `reviewerApproved` com fronteira de
>   palavra ("DESAPROVADO"/"REPROVADO" não passam; "NÃO-APROVADO" reprova);
>   notice de teto furado na ÚLTIMA fase (done não muda, o registro entra);
>   `.catch` no cancel do corte de teto; `clear()` limpa
>   `missionCwd`/`missionReview`.
> - **MH2 ✅ entregue** (MH2.1–MH2.3): fases gravam `turn_costs` (fonte única;
>   ADR-030 registra a saída de `deliveries` da união e a perda transitória
>   aceita); teto morde DENTRO da fase (`stopAtCostUsd` + cancel); desfechos
>   notificam pelos canais do ADR-013.
> - **MH3 ✅ entregue** (MH3.1–MH3.3): "Salvar como time" nas DUAS superfícies
>   (input inline + validação vazio/duplicado case-insensitive; lógica pura
>   `saveDraftAsPreset` em `missionDraft.ts`); linha de fase COMUM
>   (`components/mission/PhaseRow.tsx`, pílulas autonomia/agent/modelo/effort)
>   consumida por Launcher e Dock — effort nos dois por construção;
>   `gatePolicy` no `MissionPreset` (ausente = "agente", fail-open) com motor em
>   `gateOutcome` (lib/mission.ts) consultado no ponto do gate
>   (store/mission.ts): "nunca" preserva as open_questions como notice no fio,
>   "sempre-apos-planejar" abre gate obrigatório após a fase 1 com a pergunta
>   padrão "Revise o plano antes de executar"; política sobrevive a restart
>   (viaja no run → run-state); seletor da política no Launcher, no Dock e no
>   MissionSettings; toggle "Autonomia" ao ligar também seta "nunca" (desligar
>   volta pra política do preset) — `toggleTeamAutonomyWithGate`.
> - **MH4 ✅ entregue** (MH4.1–MH4.4): máquina de fases explícita em
>   `lib/missionEngine.ts` — transições PURAS (initEngine/nextTransition/
>   failureTransition/applyRecoveryChoice/rerunBudget/afterPhaseDone/
>   gateTransition/advance/finalCaveat; MAX_REVIEW_LOOPS mora lá), o `launch`
>   do store virou casca de efeitos; refactor comportamento-neutro PROVADO
>   pelas suítes existentes de missão (26 arquivos / 214 testes intactos,
>   nenhum alterado). MH4.2: transições do loop de correção em unit puro
>   (`lib/missionEngine.test.ts`, 18 casos: rodada N abre fix+rereview, clamp
>   estrutural e re-hidratado da retomada, reprovação final → ressalva,
>   aprovação na re-review → done limpo, teto intra-fase vence rastro de
>   limite, recovery, initEngine da retomada). MH4.3: `listMissions` ganhou
>   consumidor — seção "Missões" no painel de contexto
>   (`components/layout/MissionsSection.tsx`: data, tarefa, desfecho com
>   ressalva, custo, "Ver arquivos" reusando `MissionFilesDialog`); retomada
>   oferecida também SEM worktree (`ChatPanel.tsx`: detecção cai pra pasta do
>   projeto — caso residual de missão pré-MH1.4/fallback confirmado; o
>   `readInterruptedFor` já filtra por convId). MH4.4: `docs/mission-mode.md`
>   atualizado (persistência entregue, gate policy, máquina de fases).
>   **Furos conhecidos registrados (não corrigidos):**
>   - O índice `missions` não distingue teto de falha comum (não persiste
>     maxCostUsd/motivo) — a seção "Missões" mostra ambos como "falha".
>   - A seção "Missões" carrega no mount do painel (snapshot): missão
>     terminando com o painel aberto só aparece ao reabrir/recarregar.
>   - "Ver arquivos" de missão cujo worktree foi removido depois abre vazio
>     (best-effort; o índice guarda o dir, não copia artefatos).
>   - Detecção de retomada olha UM cwd (worktree da conversa OU pasta do
>     projeto): missão antiga da pasta do projeto numa conversa que ganhou
>     worktree DEPOIS não é re-oferecida.
>
> **PLANO FECHADO (04/08/2026):** o gate final aprovou MH3+MH4 COM RESSALVAS e
> as ressalvas de código foram fechadas na rodada final:
>
> - **Janela de duplo-start no launch/retomada** ✅: o run agora é SEMEADO em
>   `byConv` sincronamente (antes de qualquer await de preparação) e o card de
>   retomada sai no mesmo instante — duplo-clique em "Retomar"/"Lançar" morre
>   na guarda; falha de preparação limpa a semente e devolve o card
>   (`store/mission.ts` + `mission.doubleStart.test.ts`, ensure lento
>   injetado).
> - **Régua de "personalizado" unificada com o teto** ✅: `draftCustomized`
>   (missionDraft.ts) é a fonte única de Launcher E Dock — editar só o teto no
>   Dock agora marca "time personalizado" e oferece "salvar como time"
>   (`missionDraft.customized.test.ts`).
> - **Aceites registrados no ADR-031**: presets de fábrica congelam ao salvar
>   time (trade-off aceito); prova de neutralidade sem diff por fase (lição:
>   plano multi-fase commita por fase).
>
> **Quirks conhecidos aceitos no gate (nits 5-7 + 1 achado do fecho):**
>
> - Toggle "Autonomia" ao DESLIGAR restaura a política de gate do PRESET, não
>   a editada antes de ligar (comportamento documentado do
>   `toggleTeamAutonomyWithGate`).
> - `parseRunState` é fail-open pra `gatePolicy` com lixo no arquivo (vira o
>   default "agente" via normalização, nunca erro).
> - `agentOptions` do Dock renderiza sem description (o Launcher tem; cosmético).
> - Nome do preset EFETIVO do Dock (`effectiveTablePreset`) não ganha
>   "· personalizado" quando SÓ o teto muda — comportamento fixado por teste
>   pré-existente (`ui.test.ts`, "sem edição ⇒ nome intacto"); a régua nova
>   (`draftCustomized`) cobre a UI (badge/salvar/restaurar), o nome que viaja
>   no run segue a régua antiga.

> Status: proposto em 04/08/2026, da auditoria completa da feature Missão
> (código + UI + parâmetros; achados com file:line). Origem: a Missão nasceu
> ANTES da doutrina endurecer (ADR-020/021, watchdog, custo como fonte única,
> capability registry) e é o maior bolsão remanescente de "silêncio para quem
> espera" e "estado teatro" do app. Execução sequencial por fase (as fases
> tocam os mesmos arquivos); gate de review após MH1+MH2 e após MH3+MH4.

## MH1 — Mentira e travamento (dano real)

- **MH1.1 — Desfecho honesto do reviewer**: esgotadas as rodadas de correção
  sem `APROVADO` (`store/mission.ts:780→895`), a missão NÃO termina "done"
  seca: termina `done` com ressalva explícita — notice no fio + timeline
  ("Concluída SEM aprovação do revisor após N rodadas") + o resumo final
  carrega o parecer. Endurecer também `reviewerApproved`
  (`lib/mission.ts:201-209`): "aprovado com ressalvas"/"ainda não está
  aprovado"/"não totalmente aprovado" não podem contar como aprovação.
- **MH1.2 — Missão é run desassistido + timeout de fase**: marcar as fases no
  registro de unattended (`markUnattendedRun`, padrão `scheduleEngine.ts:240`)
  para pedidos de permissão/pergunta expirarem fail-closed (ADR-021); e
  cobertura do vigia: fase sem NENHUM item novo além do limiar
  (`stalledAfterMin`) gera o aviso de turno mudo (integrar ao ticker único do
  watchdog — estender, nunca duplicar). Sem timeout wall-clock novo: o vigia +
  fail-closed cobrem as duas classes (mudo e esperando-humano).
- **MH1.3 — Recovery com UI no Trabalho**: `MissionTimeline` renderiza o
  estado `recovery` com as mesmas ações que o Escritório já tem
  (`office/ui/MissionDock.tsx:590-596`): trocar agent e retomar, ou abortar.
  Motor pronto (`resolveRecovery`, testado) — é só a superfície.
- **MH1.4 — Worktree: verdade no modal e no launch**: sem worktree na
  conversa, a missão CRIA um (mesmo mecanismo do toggle da sidebar) antes de
  rodar — e o subtítulo do modal continua verdadeiro. Se a criação falhar,
  aviso explícito "vai rodar na pasta do projeto" com confirmação (nunca
  silencioso como hoje, `store/mission.ts:374`).

## MH2 — Custo e notificação

- **MH2.1 — Custo no ledger**: cada fase grava `turn_costs` (fonte única do
  Painel/cards), incluindo fases de missão abortada/estourada/falhada. Manter
  `deliveries` como está (entrega ≠ custo). Cuidar dedup: custo da fase entra
  UMA vez (result), não por retry descartado duplicado.
- **MH2.2 — Teto morde DENTRO da fase**: acompanhar custo acumulado nos
  eventos de result durante a fase; estourou → cancela o run corrente e a
  missão vai a `error` de teto (mesmo desfecho do check entre fases). O check
  entre fases continua (barato e cobre o resto).
- **MH2.3 — Notificação de desfecho**: fim (done/ressalva), falha, teto
  estourado e recovery pendente avisam pelos canais do ADR-013 (sino +
  bandeja + SO), com dedupe por missão. Gate já notifica; alinhar copy.

## MH3 — Launcher (o modal)

- **MH3.1 — "Salvar como time"**: rascunho "Personalizado" ganha ação de
  salvar como preset (nome + persiste em `settings.missionPresets`), no
  launcher e no MissionDock.
- **MH3.2 — Effort por fase no launcher**: expor o seletor (já existe no tipo,
  no Settings e no Dock; a UI do launcher ficou para trás). Unificar o
  formulário duplicado launcher×Dock no que der sem reescrever os dois: a
  lógica já é compartilhada (`missionDraft.ts`); extrair a LINHA de fase
  (pílulas agent/modelo/effort/autonomia) num componente comum.
- **MH3.3 — Política de gate no preset**: `gatePolicy: "agente" | "sempre-apos-planejar" | "nunca"`
  (default "agente" = comportamento atual). "Autonomia" no dialog passa a
  também definir gate ("nunca") quando ligado — com o texto dizendo isso.
  Motor: `store/mission.ts:820-825` consulta a política antes de abrir gate.

## MH4 — Estrutura e pendências

- **MH4.1 — Máquina de fases explícita**: extrair o `launch` (635 linhas,
  `store/mission.ts:358-992`) numa máquina de estados testável
  (`lib/missionEngine.ts`?): estados budget/retry/recovery/review-loop/gate/
  entrega como transições puras; o store vira casca (padrão do repo: lógica
  pura + costura fina). SEM mudança de comportamento (as suítes existentes de
  missão são o contrato) — pré-requisito do M3 (paralelismo).
- **MH4.2 — Testes do loop de correção M2**: `reviewLoops`, "Corrigir (rodada
  N)", clamp de `MAX_REVIEW_LOOPS`, e o desfecho com ressalva do MH1.1.
- **MH4.3 — Histórico deixa de ser órfão**: `listMissions` ganha consumidor
  (lista de missões passadas no painel da conversa/projeto — entrada leve, o
  viewer "Ver arquivos" já existe) OU se decide remover o índice (registrar).
  Retomada oferecida também sem worktree (`ChatPanel.tsx:198` — com MH1.4
  criando worktree, o caso residual é missão antiga na pasta do projeto).
- **MH4.4 — Doc drift**: `docs/mission-mode.md` atualizado (persistência
  entregue; gate policy; decisões deste plano).

## Guardas

- Sequencial: MH1 → MH2 → MH3 → MH4 (mesmos arquivos). Gate de review após
  MH2 e após MH4; tester valida critério de aceite do MH1 (o mais crítico).
- Nenhuma suíte existente afrouxada; fixtures reais; suítes completas verdes
  por fase (cargo + vitest + tsc).
- Comportamento por capability, nunca por nome (registry).
- MH4.1 é refactor comportamento-neutro: byte-compat nos prompts/transições
  (as suítes provam).

## Fora de escopo

- M3 (paralelismo/mailbox) — depende do MH4.1, não entra aqui.
- Qualquer acoplamento com SDD (decisão de produto mantida).
