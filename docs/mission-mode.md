# Modo Mission — times heterogêneos de agents (design + avaliação)

> Estudo completo do [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> (OMO) por 3 agentes (arquitetura, filosofia/UX, encaixe no MyCockpit) + síntese.
> Pergunta do produto: *"Opus planeja → Gemini executa front → Codex faz X →
> Opus revisa"* — vale construir? Como? Data: 2026-07-12.

> **Atualização (jul/2026) — confiabilidade dos artefatos.** As menções a
> `.mission/` abaixo são HISTÓRICAS. Os artefatos de missão (handoffs
> `<i>-<persona>.json`, `plan.md`, `reports/`, `run-state.json`) hoje vivem
> ISOLADOS por missão em **`.mycockpit/missions/<slug>/`** (slug = data + id
> curto + tarefa) — antes o `.mission/` fixo fazia missões no mesmo cwd se
> sobrescreverem. A persistência foi ENTREGUE: run-state por missão (retomada
> via ponteiro por conversa) + índice `missions` no banco (histórico, com
> consumidor na seção "Missões" do painel de contexto) + viewer no app ("Ver
> arquivos" + promover pra `docs/`). Ver `lib/missionPaths.ts`,
> `lib/missionState.ts`, `lib/missionFiles.ts`.
>
> **Atualização (ago/2026) — hardening MH1–MH4.** O registro vivo das decisões
> e entregas do endurecimento da Missão é o `docs/mission-hardening-plan.md`
> (bloco STATUS no topo). Destaques que mudam a leitura deste doc:
> - **Desfecho honesto (MH1.1)**: rodadas de correção esgotadas sem APROVADO ⇒
>   `done` COM RESSALVA explícita (`reviewCaveat` no run, no run-state e no
>   índice `missions`), nunca "done" seco.
> - **Política de gate por preset (MH3.3)**: `gatePolicy: "agente" |
>   "sempre-apos-planejar" | "nunca"` (ausente = "agente", o clássico). Motor
>   puro em `gateOutcome` (lib/mission.ts); "nunca" preserva as open_questions
>   como notice no fio; "sempre-apos-planejar" abre gate obrigatório após a
>   fase 1. A política viaja no run → run-state (sobrevive a restart).
> - **Máquina de fases explícita (MH4.1)**: as transições do pipeline
>   (budget/teto intra-fase/falha/recovery/loop de correção/gate/desfecho) são
>   funções PURAS em `lib/missionEngine.ts`; o `launch` do `store/mission.ts` é
>   casca fina que executa efeitos (runPhase/persist/notices/notify/ledger) sob
>   comando do motor. Pré-requisito do M3 (paralelismo).
>
> **Atualização (ago/2026) — Planos de voo.** `MissionPreset` passa a ser o
> template reutilizável chamado **Plano de voo**; `MissionRun` continua sendo a
> execução concreta. Presets legados seguem lineares sem migração. O canvas v1
> persiste um `MissionPlanGraph` versionado, permite organizar e reordenar nós,
> importar/exportar JSON e configurar critérios de entrada/saída. A topologia
> executável ainda é uma cadeia única — o limite e a evolução estão descritos
> em [`mission-flight-plans.md`](./mission-flight-plans.md).

## TL;DR (a recomendação)

**Sim — como feature INDEPENDENTE, sem nenhum vínculo com o SDD.** Decisão de
produto (2026-07-12): Mission e SDD são features separadas, cada uma validável
por si — o SDD já tem skills e agents próprios definidos; o Mission é um
**modo de uso**: um time configurável (papel → agent/modelo) que roda **dentro
do Linear** como um tipo de run (igual o Fusion é acionável do composer), não
uma nova superfície no switcher. O OMO mesmo aprendeu a lição das primitivas:
a v2 do Team Mode deles abandonou o tmux acoplado e virou "script-driven +
git worktree por membro" — exatamente o que o MyCockpit **já tem**.

Reuso estimado: **runtime 100%** (run_agent/adapters já são agnósticos),
handoff 100%, worktrees 100%, padrão de store do Fusion ~70%. Código novo:
~2,5k linhas (orquestrador + store + UI + config), sem tocar no SDD.

---

## 1. O que o OMO realmente faz (essência dos 3 relatórios)

### Arquitetura
- **Um único runtime** (plugin do opencode): 11 agentes nomeados vivem em
  *sessões* do mesmo harness. Três mecanismos de spawn: `task` (síncrono,
  bloqueante), `background_task` (fire-and-forget + polling em JSON no disco)
  e `team_mode` (paralelo, **mailbox por arquivos** em `~/.omo/teams/…`,
  máx. 4 simultâneos).
- **Sisyphus lidera**: um agente-orquestrador decide a quem delegar lendo uma
  *Delegation Table* injetada dinamicamente no system prompt (gerada dos
  metadados de cada agente: domínio, custo, "use when").
- **Config Zod em camadas** (user + projeto): modelo/variant/fallback-chain
  **por agente** e **categorias** (`quick`, `deep`, `ultrabrain`,
  `visual-engineering`) que mapeiam tarefa → modelo. Não existe fallback
  global — cada papel tem o seu.

### Filosofia
- **Roteamento por categoria, não por modelo**: o usuário dá a meta; o sistema
  classifica e roteia. Config manual existe, mas é override, não o caminho.
- **Papéis com persona**: Prometheus *entrevista* antes de planejar (plano em
  `.omo/plans/*.md`), Atlas executa o plano, Oracle consulta read-only, Momus
  revisa implacável. "Give him a goal, not a recipe."
- **Zero hand-holding + Ralph loop**: não parar até 100% feito; enforcement de
  TODO puxa o agente de volta.
- **Limites que eles admitem**: 3+ assinaturas necessárias; 54-62 hooks comem
  contexto; detecção de intent por keyword é frágil; churn de modelos exige
  manutenção constante.

### O que é portável pra nós (CLIs separados ≠ um runtime)
| Portável | Acoplado ao opencode |
|---|---|
| Conceito de papéis + metadados de delegação | Hooks de plugin (`tool.execute.before`…) |
| Config por papel (modelo/variant/fallback) + categorias | `task` síncrono via session API |
| Coordenação por arquivos (mailbox/estado em JSON) | Injeção de resultado via `dispatchInternalPrompt` |
| Worktree por membro (Team Mode v2) | MCPs wired no plugin |

A diferença estrutural: o OMO orquestra *sessões de um harness*; o MyCockpit
orquestra **processos de CLIs distintas** — que é exatamente o que
`run_agent()` + `AgentAdapter` já fazem. Nossa versão do "task tool" é spawn
de subprocess; nossa versão do handoff é `buildHandoff()` + **o worktree/git
como verdade compartilhada**.

---

## 2. É necessário? (avaliação honesta)

### O que o Mission adiciona que NADA no app cobre hoje
| Superfície | O que faz | O que NÃO faz |
|---|---|---|
| Linear | 1 agent por conversa (lock no 1º envio) + revezamento manual por limite | Não troca de agent *por etapa planejada* |
| Fusion | N agents na MESMA tarefa, em paralelo, competindo + juiz | Não é pipeline; papéis não colaboram |
| SDD | Fases com gates e custo por entrega | As fases não têm *dono* (agent/modelo) distinto |

O buraco real: **especialização heterogênea sequencial** — "Opus planeja,
Gemini/agy executa UI, Codex mexe no backend, Opus revisa o diff". Nenhuma
superfície atual expressa isso. E o argumento econômico do OMO se aplica:
executar com modelo mais barato e planejar/revisar com o mais capaz otimiza
US$/entrega — que é literalmente a métrica-assinatura do MyCockpit.

### Contra-argumentos (levados a sério)
1. **Proliferação de modos.** Linear/Fusion/SDD já exigem explicação; um 4º
   modo no switcher aumenta a carga cognitiva. → Mitigação: Mission NÃO é
   modo; é um *tipo de run* dentro do Linear (como o Fusion é acionável do
   composer), com timeline de fases no fio da conversa.
2. **Evidência de qualidade é anedótica.** Os testimonials do OMO são fortes,
   mas não há benchmark de que "time heterogêneo > um Opus bem dirigido" para
   o caso típico. → Mitigação: v1 pequeno, medir custo/resultado por missão
   (temos a infra de custo!), decidir v2 com dados próprios.
3. **Custo multiplicado.** Cada fase = um run completo; review de diff grande
   por Opus é caro; retries multiplicam. → Mitigação: `max_cost_usd` HARD por
   missão (o risco nº 1 do relatório de encaixe) + custo por fase visível.
4. **Handoff com perda.** Entre CLIs não há sessão compartilhada; o handoff é
   texto (tail ~9k tokens, corte silencioso). → Mitigação-chave (melhor que o
   OMO): **o artefato de handoff primário é o `git diff` do worktree**, não o
   chat. O reviewer recebe o diff real + o plano; o texto é complemento.

### Veredito
**Construir, escopo v1 enxuto, como "run de missão" no Linear — feature
independente do SDD.** O custo de oportunidade é baixo (reuso alto de
primitivas: runtime, handoff, worktrees), o diferencial competitivo é real
(nenhum concorrente do estudo de mercado tem pipeline heterogêneo com controle
de custo), e não compete com Fusion nem SDD: cada uma valida sua própria
hipótese isoladamente.

---

## 3. Arquitetura proposta

### Conceitos
```
MissionPreset  = nome + papéis ordenados          (ex.: "Feature completa")
Papel (Phase)  = id + persona + agent + model + effort + prompt-template
                 + maxRetries + gate?             (ex.: reviewer usa git diff)
MissionRun     = execução de um preset numa conversa/worktree
```

### Fluxo v1 (sequencial, no Linear)
```
composer ▸ botão Mission ─→ escolhe preset (ou monta ad-hoc) ─→ start
   │
   ▼                                        (tudo no MESMO worktree)
[Fase 1: Planner · claude-code/opus]
   prompt = template(planner) + pedido do usuário
   saída: plano (fica no fio + PLAN.md opcional)
   ▼  handoff = buildHandoff(items) + plano íntegro
[Fase 2..N: Executor(es) · agy/gemini, codex/gpt…]
   prompt = template(executor) + handoff + tarefa da fase
   entre fases: gate opcional (tsc/test — check próprio do Mission)
   ▼  handoff = plano + GIT DIFF acumulado (verdade real) + tail do chat
[Fase final: Reviewer · claude-code/opus]
   prompt = template(reviewer) + diff + plano ("aprove ou liste correções")
   se reprovar e houver retry: volta ao executor com as correções
   ▼
resumo da missão no fio: fases, custo POR FASE, custo total, diff final
```

### Peças novas (e o que reusam)
| Peça | Descrição | Reusa |
|---|---|---|
| `src/lib/mission.ts` | Orquestrador: `runMission(config)` → loop de fases com `runAgent()`, handoff, retry, budget-check | run_agent, buildHandoff, git diff (lib/git) |
| `src/store/mission.ts` | Estado por conversa: fases (queued/running/done/error), custo acumulado, guarda anti-duplo-start | padrão do store/fusion.ts (~70%) |
| `MissionTimeline` (UI) | Fases como timeline vertical NO FIO da conversa (como o FusionBoard aparece), com custo por fase + retry badge | FusionBoard/TaskChecklist |
| Config | `GlobalSettings.missionPresets[]` (mc.app) + override por projeto em `.mycockpit/config.toml [mission]`; `enabled` default **false** (beta) | settings.ts, mycockpit.rs |
| Templates de papel | Preâmbulos curtos por persona (planner/executor/reviewer), inspirados nos do OMO mas mínimos | prompts em lib/mission.ts |
| Budget | `maxCostUsd` por missão: soma `cost_usd` dos results; excedeu → aborta com card acionável | AgentEvent.Result, fmtCost |

**Sem mudança no Rust.** O runtime atual (spawn + eventos normalizados +
registry + cancel) atende; a orquestração é 100% TypeScript por cima de
`runAgent()` — mesma altitude do Fusion.

### Configurável/ativável (o pedido explícito)
- **Settings ▸ Missions (beta)**: toggle liga/desliga (esconde o botão do
  composer) e oferece acesso à prancheta.
- **Geral ▸ Planos de voo**: workspace global de autoria, com biblioteca,
  canvas central e inspetor do nó (papel → agent → modelo → effort → retries).
- **Preset ad-hoc no launch** (como a liga do Fusion): monta o time na hora.
- **Presets de fábrica** (espelham as categorias do OMO, sem keyword-magic):
  - *Feature completa*: Opus planeja → executor por área → Opus revisa
  - *UI-first*: Opus planeja → agy(Gemini) executa → Sonnet revisa
  - *Barato*: Sonnet planeja → Codex executa → Sonnet revisa
- **Por projeto**: `.mycockpit/config.toml [mission]` sobrepõe o global
  (mesmo padrão do helper/permission).

### Decisões de design (com o porquê)
1. **Diff como handoff primário** (não só texto): entre CLIs não há sessão
   compartilhada; o worktree é a única verdade íntegra. O OMO não precisa
   disso (um runtime só) — nós precisamos, e é *melhor*: reviewer revisa
   código real, imune a resumo com perda.
2. **Sequencial no v1, paralelo depois**: paralelismo de executores (mailbox
   à la team-core) só quando houver demanda real; o Fusion já cobre o caso
   "paralelo competitivo".
3. **Papéis manuais + presets, sem IntentGate**: a detecção por keyword é o
   ponto frágil confesso do OMO. Aqui o usuário escolhe o preset — explícito
   e previsível (e o pedido do Vinícius é exatamente "eu defino o time").
4. **Retry limitado com fallback de agent** (`executor: ["agy", "codex"]`):
   a cadeia de fallback POR PAPEL é a melhor ideia de config do OMO.
5. **Cancelamento**: parar a missão = cancel do run corrente + status
   `aborted`; fases feitas ficam no fio (nada se perde — está no worktree).

---

## 4. Riscos e mitigação (do relatório de encaixe)
| Risco | Grau | Mitigação |
|---|---|---|
| Custo explode com retries | **Alto** | `maxCostUsd` hard + custo por fase na UI + retry default = 1 |
| Contexto estoura no handoff | Médio | diff-como-handoff + aviso visível quando `buildHandoff` cortar + (v2) resumo compressivo via helper |
| Corrida de estado (2 starts) | Baixo | guarda do Fusion (`byConv` rodando → ignora) |
| Churn de modelos | Contínuo | presets referenciam o registry `agents.ts` (fonte única já existente) |

## 5. Fases de entrega
- **M1 (v1 útil)** ✅ ENTREGUE: lib/mission.ts (motor: phasePrompt/runPhase/
  diffToText/checkBudget, +12 testes) + store/mission.ts (launch/abort/clear) +
  MissionTimeline/MissionLauncher + MissionSettings (toggle beta + editor de
  times) + botão 🚀 no composer. Sequencial, retry por fase, budget HARD.
  Verde: tsc + 26 testes + oxlint. Persistência em memória (ver M2). O motor
  vive isolado no próprio store (não escreve no fio do Linear) — a timeline é
  a superfície da missão.
- **M2**: gates entre fases (checks genéricos: tsc/test/lint no worktree —
  implementação própria do Mission, sem tocar no SDD), fallback de agent por
  papel, resumo compressivo de handoff, preset por projeto no config.toml.
  Além disso, 3 arestas do M1 mapeadas — status:
  - ✅ **Bloquear o composer durante a missão** (ENTREGUE): envio manual travado
    quando `byConv[convId].status === "running"` (bloqueio no handleSend +
    composer desabilitado com placeholder); o botão 🚀 também some. Evita run
    paralelo no mesmo worktree embolando o diff.
  - ✅ **Loop de correção do reviewer** (ENTREGUE): se o reviewer não responde
    APROVADO, o motor injeta um executor corretivo (com as correções como
    instrução) + re-review, até `MAX_REVIEW_LOOPS` (2) e sempre sob o teto de
    custo. `reviewerApproved`/`phaseText` em lib/mission (+testes); o loop do
    store cresce a lista de fases dinamicamente (a timeline reflete).
  - ✅ **Persistência** (ENTREGUE — caminho diferente do planejado): em vez de
    espelhar `saveFusionRun`, o pipeline persiste em DOIS planos — run-state
    por missão no worktree (`lib/missionState.ts`, marcos: largada/fase/gate/
    recovery/fim; retomada via ponteiro por conversa e card na conversa) +
    índice `missions` no banco (`lib/db.ts` upsert nos marcos; consumido pela
    seção "Missões" do painel de contexto). Disco = artefatos; banco = índice.
- **Handoff tipado (.mission/) ✅ ENTREGUE** (2026-07-12, antecipado do M2): o
  handoff entre fases agora é blackboard — cada fase escreve `.mission/<i>-<
  persona>.json` (intent/decisions/files_touched/open_questions/for_next_agent)
  e o app injeta os JSONs anteriores + a lista LEVE de arquivos mudados no
  prompt seguinte; o código não viaja no prompt (o agente roda `git diff` no
  cwd). Fallback pro tail do transcript quando o agente não emite o JSON. Ver
  `lib/missionHandoff.ts` (+6 testes: parse tolerante, caps, formatação, refs).
- **M2 — motivação original da correção (pesquisa 2026-07-12)**: o M1 usava
  git diff + rabo do transcript como portador de contexto. A pesquisa dos
  sistemas que rodam agentes em contextos ISOLADos (Anthropic research-system,
  Claude Code sub-agents, Factory.ai) mostra que isso é subótimo:
  - **O diff no prompt é redundante** — os agentes já leem os arquivos no
    worktree (mesmo cwd). Passar o diff paga tokens por algo já visível. O que
    o diff NÃO carrega é o que importa: intenção, alternativas rejeitadas,
    pendências, contrato esperado pelo reviewer.
  - **O transcript tail é ruído** (mistura thinking + tool-logs). Rebaixar a
    fallback quando o handoff estruturado falhar.
  - **Direção nova**: blackboard `.mission/` no worktree + handoff TIPADO por
    fase (JSON: `intent`, `decisions[]`, `files_touched[]` como REFERÊNCIA (não
    o diff), `open_questions[]`, `for_next_agent`). No prompt injeta só
    `brief.md` (objetivo + fronteiras) + os JSONs anteriores + "os arquivos já
    estão no seu cwd". Otimiza tokens-por-missão, não por request. Cap por
    campo (máx ~5 decisions/open_questions) p/ o blackboard não crescer sem fim.
  - Descartar compressor por LLM barato (overkill p/ 3 fases; `agy` nem tem
    JSON) — cada agente já emite seu JSON estruturado de saída = compressão de
    graça. `git diff --stat` fica só como ponteiro ("revise estes N arquivos").
  - Fontes: anthropic.com/engineering/multi-agent-research-system, Claude Code
    sub-agents docs, factory.ai/news/evaluating-compression, arXiv 2510.01285
    (blackboard multi-agente: +13-57% de sucesso vs RAG/master-slave).
  - **Referência de template**: a skill `handoff` do Matt Pocock
    (github.com/mattpocock/skills productivity/handoff) chegou à mesma regra —
    "não duplique o que já está em specs/plans/commits/diffs; **referencie por
    path/URL**" + redigir segredos. Aproveitamos: (a) `files_touched` como
    referência, (b) redação de segredos no artefato, (c) campo `for_next_agent`.
    NÃO aproveitamos o gatilho dela: ela é manual e não calcula janela. Dois
    handoffs distintos — INTER-fase (evento = transição, é o `.mission/`) vs
    INTRA-fase (janela do agente enchendo no meio: cada CLI já auto-compacta;
    não reimplementar por fora, frágil a update do `agy`).
- **M3**: paralelismo de executores independentes (mailbox à la team-core) e
  agente-líder que delega sozinho (Sisyphus-like) — só com dados do M1/M2.
- **Explicitamente fora (decisão de produto)**: **qualquer acoplamento com o
  SDD**. São features irmãs e independentes — o SDD tem skills/agents
  próprios; o Mission é um modo de uso do Linear. Cada uma valida sua
  hipótese sozinha. Keyword routing também fora (fragilidade confessa do OMO).

## 6. Referências do estudo
- Clone analisado: `oh-my-openagent` @ HEAD 2026-07-12 (5.689 arquivos).
- Peças estudadas: `packages/omo-opencode/src/agents/*` (papéis + prompts
  dinâmicos), `config/schema/*` (Zod em camadas), `tools/delegate-task/`,
  `tools/background-task/`, `packages/team-core` (mailbox + worktrees),
  README/ROADMAP/CHANGELOG/AGENTS.md.
- Precedentes internos: `store/fusion.ts` (lanes/eventos), `lib/handoff.ts`
  (revezamento), `src-tauri/src/sdd.rs` (fases/gates), `lib/git.ts`
  (worktrees), `agent.rs`/`adapters.rs` (runtime multi-CLI).
