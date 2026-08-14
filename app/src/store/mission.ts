// MOTOR do modo Mission (docs/mission-mode.md §3, M1): pipeline SEQUENCIAL de
// agents heterogêneos numa conversa. Store IRMÃO do useChat, modelado no
// store/fusion.ts (set síncrono, guarda anti-duplo-start, custo acumulado).
// Feature INDEPENDENTE do SDD — nada aqui importa lib/sdd.ts.
import { create } from "zustand"
import { cancelAgent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type {
  GateAnswer,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionPreset,
  MissionRun,
  MissionStatus,
  RecoveryChoice,
} from "@/lib/missionTypes"
import { phasePermission } from "@/lib/missionTypes"
import { agentCaps } from "@/lib/agents"
import {
  notifyGate,
  notifyMissionEnd,
  notifyMissionRecovery,
} from "@/lib/notify"
import { buildHandoff } from "@/lib/handoff"
import { loadGitDiff } from "@/lib/git"
import { insertDelivery, recordTurnCost, upsertMission } from "@/lib/db"
import { buildDoctrineBlock, readDoctrine } from "@/lib/doctrine"
import {
  buildLearningBlocks,
  distillLesson,
  markLessonsUsed,
} from "@/lib/learning"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
// Os marcos que a missão grava no fio moram em lib/missionMarks (a catraca de
// tamanho cobrou a divisão deste arquivo).
import {
  missionIndexRow,
  noticeItem,
  recordHistory,
  summarize,
} from "@/lib/missionMarks"
import {
  buildGateDecisionsBlock,
  normalizeGateAnswers,
  phasePrompt,
  phaseText,
  runPhase,
  splitGateAttachments,
  type PhaseResult,
} from "@/lib/mission"
import {
  advance,
  afterPhaseDone,
  applyRecoveryChoice,
  failureTransition,
  finalCaveat,
  gateTransition,
  initEngine,
  nextTransition,
  rerunBudget,
} from "@/lib/missionEngine"
import {
  changedFilesRef,
  formatPriorHandoffs,
  readHandoff,
  type PriorHandoff,
} from "@/lib/missionHandoff"
import { ensureMissionCwd } from "@/lib/missionWorktree"
import { clearUnattendedRun, markUnattendedRun } from "@/lib/unattendedRuns"
import { handoffFileName, missionDir, missionSlug } from "@/lib/missionPaths"
import { expandDraftForAgent } from "@/lib/slashCommands"
import {
  ensureMissionsGitignore,
  readInterruptedFor,
  runToState,
  shouldOfferResume,
  writeActivePointer,
  writeRunState,
  type InterruptedMission,
  type MissionRunState,
  type ReviewLoopState,
} from "@/lib/missionState"

export interface MissionState {
  /** Missão por conversa (uma por vez; guarda anti-duplo-start no launch). */
  byConv: Record<string, MissionRun>

  /** Missões INTERROMPIDAS por restart, detectadas no boot da conversa (o
   *  run-state.json do worktree ficou `running` sem run em memória). O card de
   *  retomada da conversa lê daqui; Retomar/Descartar limpam a entrada. */
  interrupted: Record<string, InterruptedMission>

  launch: (
    convId: string,
    preset: MissionPreset,
    task: string,
    projectId: string,
    projectPath: string,
    permission: string,
    /** Anexos do launcher (imagem/PDF): só a FASE 1 recebe, junto da task —
     *  mesmo caminho frontend do handleSend (nenhuma mudança em Rust). */
    attachments?: Attachment[],
    /** INTERNO (retomada P1): snapshot do run-state.json — o launch começa em
     *  `startPhase = state.current`, com as fases anteriores entrando como
     *  done (custos do arquivo) e o costTotal retomado somando ao teto. O
     *  prompt da fase corrente se reconstrói NATURALMENTE dos handoffs
     *  da pasta da missão já no disco (mesmo caminho do loop). Gate/recovery
     *  pendentes no crash NÃO sobrevivem: a fase corrente re-roda do zero e
     *  re-pergunta se precisar. */
    resume?: MissionRunState,
  ) => Promise<void>

  /** Boot: detecta missão interrompida no worktree da conversa (run-state.json
   *  `running` + convId da própria conversa + NENHUM run em memória). Popula
   *  `interrupted[convId]` pro card de retomada; limpa quando não se aplica. */
  detectInterrupted: (convId: string, cwd: string) => Promise<void>

  /** Card de retomada → reconstrói o preset efetivo do arquivo e relança a
   *  missão da fase corrente (launch com `resume`). No-op sem entrada. */
  resumeInterrupted: (
    convId: string,
    projectId: string,
    projectPath: string,
    permission: string,
  ) => void

  /** Card de retomada → descarta: marca o arquivo como `abandoned` (não será
   *  re-oferecido) e grava o marco na conversa. No-op sem entrada. */
  discardInterrupted: (convId: string) => Promise<void>

  abort: (convId: string) => void

  clear: (convId: string) => void

  /** Gate humano: entrega as respostas do usuário e RETOMA a missão pausada.
   *  answers[i] corresponde a gate.questions[i] (em branco = agente decide).
   *  Aceita GateAnswer[] (rico: texto + anexos) OU string[] legado — a UI atual
   *  segue funcionando; anexos vão pro runPhase da PRÓXIMA fase (filtrados pelo
   *  agentCaps do agent dela; não suportado ⇒ notice, nunca erro). */
  answerGate: (convId: string, answers: GateAnswer[] | string[]) => void

  /** Recuperação: o usuário escolheu outro agent/modelo/effort → troca a def da
   *  fase corrente e RE-RODA a MESMA fase (sem avançar). No-op se não há
   *  recovery pendente. */
  resolveRecovery: (convId: string, choice: RecoveryChoice) => void

  /** Recuperação: o usuário desistiu → a missão vai a error (resolve com null,
   *  mesmo efeito de não escolher agent). No-op se não há recovery pendente. */
  abortRecovery: (convId: string) => void
}

/** MissionRun em execução ainda tem fase corrente rodando/na fila. */
function isActive(status: MissionStatus): boolean {
  return status === "running"
}

/** Cria o registro de fase (MissionPhaseRun) em estado inicial (fila). */
function queuedRun(def: MissionPhaseDef): MissionPhaseRun {
  return { def, status: "queued", attempt: 1, costUsd: 0, startedAt: null }
}

/** runId estável por fase p/ cancelamento (index-based, uma missão por conv). */
function phaseRunId(missionId: string, phaseIdx: number): string {
  return `${missionId}::phase-${phaseIdx}`
}

/** Gate humano: resolvedores das missões pausadas (por missionId). O loop do
 *  launch fica aguardando; answerGate resolve com as respostas (já normalizadas
 *  p/ GateAnswer[]), abort com null. */
const gateWaiters = new Map<string, (answers: GateAnswer[] | null) => void>()

/** Recuperação: resolvedores das missões pausadas numa falha recuperável (por
 *  missionId). MESMO padrão do gate — o while da fase aguarda; resolveRecovery
 *  resolve com a escolha (re-roda), abortRecovery/abort resolvem com null
 *  (desiste). */
const recoveryWaiters = new Map<string, (choice: RecoveryChoice | null) => void>()

/** cwd da missão de cada conversa (worktree ou pasta do projeto) — alvo do
 *  run-state.json. Fora do MissionRun de propósito: é plumbing de persistência,
 *  não estado de UI (evita churn de tipo em quem consome o run). */
const missionCwd = new Map<string, string>()

/** Estado vivo do loop de revisão por conversa (loops disparados + último
 *  veredito) — plumbing de persistência, como o missionCwd: cada marco grava
 *  isto no run-state pra memória do clamp de MAX_REVIEW_LOOPS sobreviver a
 *  crash (sem ele, a retomada re-armava o loop e pagava rodadas extras). */
const missionReview = new Map<string, ReviewLoopState>()

export const useMission = create<MissionState>((set, get) => {
  /** Patch parcial do MissionRun de UMA conversa (no-op se não existir). */
  const patchConv = (
    convId: string,
    p: Partial<MissionRun> | ((cur: MissionRun) => Partial<MissionRun>),
  ) =>
    set((s) => {
      const cur = s.byConv[convId]
      if (!cur) return {}
      const partial = typeof p === "function" ? p(cur) : p
      return { byConv: { ...s.byConv, [convId]: { ...cur, ...partial } } }
    })

  /** Patch de UMA fase (pelo índice) dentro do MissionRun. */
  const patchPhase = (
    convId: string,
    phaseIdx: number,
    fn: (p: MissionPhaseRun) => MissionPhaseRun,
  ) =>
    patchConv(convId, (cur) => ({
      phases: cur.phases.map((ph, i) => (i === phaseIdx ? fn(ph) : ph)),
    }))

  /** Persiste o snapshot do pipeline no worktree (run-state.json) — chamado em
   *  cada MARCO (início/fase/gate/recovery/fim). BEST-EFFORT e fire-and-forget:
   *  o writeRunState já engole falhas; persistir nunca segura nem derruba a
   *  missão. `gateDecisions` = bloco de gate respondido destinado à fase
   *  `current` (sobrevive ao restart; gate PENDENTE não — a fase re-roda). */
  const persist = (convId: string, gateDecisions?: string | null) => {
    const run = get().byConv[convId]
    const cwd = missionCwd.get(convId)
    if (!run || !cwd) return
    void writeRunState(
      cwd,
      runToState(run, gateDecisions, missionReview.get(convId)),
    )
    // ponteiro em CADA marco (não só no launch): se a escrita do launch falhou
    // transitoriamente, um marco seguinte reabilita a retomada — a
    // confiabilidade do ponteiro passa a igualar a do run-state (arquivo minúsculo,
    // conteúdo constante {dir}). Fecha o achado da revisão (retomada dependia de
    // um único write best-effort no launch).
    void writeActivePointer(cwd, convId, run.dir)
    // índice no banco (histórico navegável): espelha o marco. Disco = artefatos;
    // banco = índice durável. Best-effort — falha nunca derruba a missão.
    indexMission(convId)
  }

  /** Espelha a missão no índice `missions` do banco (upsert). projectId vem da
   *  conversa (useChat). Best-effort e fire-and-forget. */
  const indexMission = (convId: string) => {
    const run = get().byConv[convId]
    const projectId = useChat.getState().byId[convId]?.projectId
    if (!run || !projectId) return
    void upsertMission(missionIndexRow(run, convId, projectId)).catch((e) =>
      console.warn("[missão] falha ao indexar no banco:", e),
    )
  }

  /** Marco terminal de ERRO no fio: result !ok com o custo total + motivo.
   *  MH2.3 — todo desfecho ruim que passa por aqui também AVISA pelos canais
   *  do ADR-013 (sino/feed + SO), com dedupe por missão dentro do notify.
   *  `outcome` distingue teto de falha (copy diferente); abort do usuário NÃO
   *  passa por aqui de propósito (gesto seu não precisa de aviso). */
  const recordError = (
    convId: string,
    reason: string,
    outcome: "falha" | "teto",
  ) => {
    const run = get().byConv[convId]
    const cost = run?.costTotal ?? 0
    if (run) {
      notifyMissionEnd({
        missionId: run.id,
        convId,
        outcome,
        costUsd: cost,
        detail: reason,
      })
    }
    return recordHistory(convId, [
      {
        kind: "result",
        id: crypto.randomUUID(),
        ok: false,
        costUsd: cost,
        text: `Missão interrompida: ${reason}`,
      },
    ])
  }

  return {
    byConv: {},
    interrupted: {},

    detectInterrupted: async (convId, cwd) => {
      // missão em memória (qualquer status: rodando OU timeline visível) ⇒ o
      // card de retomada não se aplica.
      if (get().byConv[convId]) return
      // segue o ponteiro da conversa → run-state da pasta isolada da missão.
      const state = await readInterruptedFor(cwd, convId)
      const offer =
        state && shouldOfferResume(state, convId) ? { state, cwd } : null
      set((s) => {
        if (s.byConv[convId]) return {} // missão chegou enquanto líamos
        if (!offer) {
          if (!s.interrupted[convId]) return {}
          const interrupted = { ...s.interrupted }
          delete interrupted[convId]
          return { interrupted }
        }
        return { interrupted: { ...s.interrupted, [convId]: offer } }
      })
    },

    resumeInterrupted: (convId, projectId, projectPath, permission) => {
      const entry = get().interrupted[convId]
      if (!entry) return
      const st = entry.state
      // preset EFETIVO reconstruído do arquivo: fases (corrigidas/apendadas
      // até o crash) + teto. O launch com `resume` faz o resto — fases feitas
      // entram como done e a corrente re-roda dos handoffs do disco.
      const preset: MissionPreset = { ...st.preset, maxCostUsd: st.maxCostUsd }
      void get().launch(
        convId,
        preset,
        st.task,
        projectId,
        projectPath,
        permission,
        [],
        st,
      )
    },

    discardInterrupted: async (convId) => {
      const entry = get().interrupted[convId]
      if (!entry) return
      set((s) => {
        const interrupted = { ...s.interrupted }
        delete interrupted[convId]
        return { interrupted }
      })
      // `abandoned` é terminal: o boot não re-oferece a retomada nunca mais.
      await writeRunState(entry.cwd, {
        ...entry.state,
        status: "abandoned",
        updatedAt: Date.now(),
      })
      await recordHistory(convId, [
        noticeItem(
          "Missão interrompida descartada; o pipeline não será retomado (o worktree segue intacto).",
        ),
      ])
    },

    launch: async (
      convId,
      preset,
      task,
      projectId,
      projectPath,
      permission,
      attachments = [],
      resume,
    ) => {
      // guarda anti-duplo-start (padrão do Fusion): missão rodando → ignora.
      const existing = get().byConv[convId]
      if (existing && isActive(existing.status)) return

      // JANELA de duplo-start FECHADA (ressalva do gate MH3+MH4): a guarda
      // acima é síncrona, mas o run só entrava em byConv DEPOIS do IO de
      // preparação (worktree/doutrina) — duplo-clique em "Retomar"/"Lançar"
      // passava duas vezes pela guarda e pagava fases em dobro com o MESMO
      // missionId. Por isso o run é construído e SEMEADO em byConv AQUI, sem
      // NENHUM await antes deste set: o segundo launch bate na guarda. O card
      // de retomada sai no mesmo instante síncrono (resumeInterrupted duplo
      // também morre na guarda); se a preparação falhar, a semente é removida
      // e o card volta — nunca fica um "rodando" falso pra trás.
      //
      // MÁQUINA DE FASES (MH4.1): o estado puro do pipeline mora no motor
      // (lib/missionEngine) — preset efetivo, fase corrente, memória do loop
      // de revisão, matéria-prima da entrega. O launch vira casca: executa os
      // efeitos (runPhase/persist/notices/notify/ledger) sob as transições.
      // RETOMADA (P1): o initEngine começa na fase corrente do arquivo (gate
      // respondido com a fase done avança 1 — nunca re-paga fase concluída) e
      // re-hidrata reviewLoops/lastReview (clamp sobrevive a crash).
      let engine = initEngine(preset, resume)
      const startPhase = engine.current
      // retomada preserva o missionId (continuidade dos marcos e do arquivo).
      const missionId = resume?.missionId ?? crypto.randomUUID()
      // pasta ISOLADA por missão: na retomada, a do arquivo; fresca, um slug
      // novo (data + id curto + tarefa) → nunca sobrescreve outra missão.
      const dir = resume?.dir ?? missionDir(missionSlug(task, missionId, Date.now()))
      const run: MissionRun = {
        id: missionId,
        convId,
        presetName: preset.name,
        task,
        dir,
        phases: preset.phases.map((def, idx) => ({
          def,
          // retomada: fases < current entram como done com o custo do arquivo.
          status: resume && idx < startPhase ? "done" : "queued",
          attempt: 1,
          costUsd:
            resume && idx < startPhase ? (resume.phases[idx]?.costUsd ?? 0) : 0,
          // procedência/fim vêm do arquivo: sem eles a fase retomada mostraria
          // um custo sem fonte (que a UI trata como não-medido) e nenhuma
          // duração — honesto nos dois casos, e melhor que inventar.
          costSource:
            resume && idx < startPhase
              ? resume.phases[idx]?.costSource
              : undefined,
          startedAt: null,
          endedAt:
            resume && idx < startPhase
              ? (resume.phases[idx]?.endedAt ?? null)
              : null,
        })),
        current: startPhase,
        // costTotal retomado soma ao teto corretamente (checkBudget usa ele).
        costTotal: resume?.costTotal ?? 0,
        // teto do preset EFETIVO: o launcher pode ter sobrescrito o teto (e as
        // fases) editados no dialog — mesmo caminho, nada além do preset viaja.
        maxCostUsd: preset.maxCostUsd,
        status: "running",
        startedAt: Date.now(),
        // MH3.3 — a política de gate do preset efetivo viaja no run: o
        // run-state serializa e a retomada preserva (ausente = "agente").
        gatePolicy: preset.gatePolicy,
      }
      // card de retomada capturado ANTES da semente: se a preparação falhar,
      // ele volta (a oferta não pode sumir por um launch que nem largou).
      const priorInterrupted = get().interrupted[convId]
      set((s) => {
        // consumiu a retomada (ou relançou por cima) → o card sai da conversa.
        const interrupted = { ...s.interrupted }
        delete interrupted[convId]
        return { byConv: { ...s.byConv, [convId]: run }, interrupted }
      })

      // cwd (MH1.4): worktree da conversa se houver; sem worktree a missão
      // CRIA um antes de rodar (mesmo mecanismo do toggle da sidebar) — o
      // subtítulo do launcher promete isolamento e o launch entrega. Falha na
      // criação nunca é silenciosa: ou o usuário confirma rodar na pasta do
      // projeto, ou a missão não larga. Retomada nunca muda o cwd (run-state e
      // handoffs já moram onde a missão começou).
      const conv = useChat.getState().byId[convId]
      const ensured = await ensureMissionCwd({
        convId,
        projectPath,
        worktreePath: conv?.worktreePath ?? null,
        resume: !!resume,
      })
      if (!ensured.ok) {
        // limpa a semente honestamente: a missão NÃO largou — nada de run
        // "running" fantasma em byConv, e o card de retomada volta se havia.
        set((s) => {
          const byConv = { ...s.byConv }
          if (byConv[convId]?.id === missionId) delete byConv[convId]
          const interrupted = { ...s.interrupted }
          if (priorInterrupted) interrupted[convId] = priorInterrupted
          return { byConv, interrupted }
        })
        await recordHistory(convId, [
          noticeItem(
            "Missão não lançada: a criação do worktree falhou e você optou por não rodar na pasta do projeto.",
          ),
        ])
        return
      }
      const cwd = ensured.cwd
      if (ensured.created) {
        // liga o worktree na conversa (mesmo efeito do toggle da sidebar): o
        // chat, o diff e a retomada passam a enxergar o isolamento.
        useChat.getState().setWorktree(convId, cwd)
        await recordHistory(convId, [
          noticeItem(
            `Conversa isolada em worktree para a missão${ensured.branch ? ` (branch ${ensured.branch})` : ""}.`,
          ),
        ])
      }
      if (ensured.fallback) {
        await recordHistory(convId, [
          noticeItem(
            "A criação do worktree falhou; com a sua confirmação, a missão roda na pasta do projeto (sem isolamento).",
          ),
        ])
      }
      missionCwd.set(convId, cwd)
      // memória do loop de revisão ANTES do primeiro marco: o persist da
      // largada já grava os loops re-hidratados (um crash logo após a
      // retomada não pode zerar o clamp de novo).
      missionReview.set(convId, {
        loops: engine.reviewLoops,
        last: engine.lastReview,
      })

      // Modelo helper (Haiku) p/ destilar lições (M2). Config por projeto vence o
      // default global; null = destilação desligada (mesma regra das sugestões).
      const appState = useApp.getState()
      const projCfg = appState.mycockpit[projectId]
      const helperModel = projCfg
        ? projCfg.helper
        : appState.settings.helperModel

      // Doutrina do projeto (.mycockpit/instructions.md) — lida UMA vez e
      // injetada em TODAS as fases: cada fase é um run novo de CLI e a maioria
      // roda em codex/agy, que não leem CLAUDE.md. Lê da RAIZ do projeto, não do
      // worktree (o worktree só teria o arquivo depois do 1º commit dele).
      const doctrineBlock = buildDoctrineBlock(
        (await readDoctrine(projectPath)).content,
      )

      // ponteiro da conversa → dir desta missão, pro boot achar o run-state sem
      // varrer o FS (as pastas de missão são gitignoradas). Best-effort.
      void writeActivePointer(cwd, convId, dir)
      // garante que os artefatos fiquem FORA do git mesmo num worktree fresco
      // (o onboarding pode não ter semeado o .mycockpit/.gitignore ali).
      void ensureMissionsGitignore(cwd)
      // índice no banco desde a largada (status=running aparece no histórico).
      indexMission(convId)

      // marco: largada no fio da conversa (task + resumo do preset). O launcher
      // já garantiu byId (ensureConversationLoaded) — Escritório e Trabalho.
      // Na retomada a task JÁ está no fio — só o notice de retomada entra.
      await recordHistory(
        convId,
        resume
          ? [
              noticeItem(
                `⟳ Missão retomada na fase ${startPhase + 1}/${preset.phases.length} · preset ${preset.name}`,
              ),
            ]
          : [
              {
                kind: "user",
                id: crypto.randomUUID(),
                text: task,
                attachments: attachments.length ? attachments : undefined,
              },
              noticeItem(
                `🚀 Missão iniciada · preset ${preset.name} · ${preset.phases.length} fases`,
              ),
            ],
      )
      // marco em disco: início (ou retomada) — o pipeline agora sobrevive.
      persist(convId, resume?.gateDecisions ?? null)

      // itens da fase anterior (p/ fallback do handoff) — o diff sai do worktree.
      let prevItems: ChatItem[] = []
      // (preset efetivo mutável, reviewLoops/lastReview, corrections e a
      // matéria-prima da entrega migraram pro MissionEngineState — o motor
      // decide; aqui só sobra o plumbing de efeito.)
      // Gate humano: bloco de decisões do usuário — SÓ a fase seguinte ao gate
      // recebe (zera depois de usar).
      // (retomada: um gate RESPONDIDO antes do crash sobrevive via arquivo e é
      // reinjetado na fase corrente; anexos de gate não sobrevivem.)
      let gateDecisions: string | null = resume?.gateDecisions ?? null
      // Gate rico: anexos das respostas (já filtrados pelo agentCaps da próxima
      // fase no answerGate) — mesma regra: SÓ a fase seguinte recebe.
      let gateAttachments: Attachment[] = []
      // MH2.1 — ledger por TENTATIVA: cada invocação do runPhase (fase nova ou
      // re-run de recovery) ganha um número, e cada tentativa interna dele é
      // uma linha própria em turn_costs (gasto próprio; retry descartado NÃO
      // regrava o gasto de outra tentativa — results parciais do MESMO run
      // colapsam via REPLACE por run_id, custo cumulativo do CLI). O nonce
      // torna o run_id único ENTRE launches (retomada pós-crash nunca
      // sobrescreve linhas já gravadas pelo processo anterior).
      let costInvocation = 0
      const costNonce = Date.now().toString(36)

      while (engine.current < engine.phases.length) {
        const i = engine.current
        // abortada por fora (byConv sumiu ou marcada aborted) → para o loop.
        const now = get().byConv[convId]
        if (!now || now.status !== "running") return

        // transição de entrada (motor): budget HARD antes de gastar na
        // próxima fase (risco nº1 do design). "finish" não ocorre aqui — o
        // while garante fase pendente.
        const step = nextTransition(engine, now.costTotal, now.maxCostUsd)
        if (step.kind === "teto") {
          patchConv(convId, { status: "error", current: i })
          patchPhase(convId, i, (ph) => ({
            ...ph,
            status: "error",
            error: step.reason,
          }))
          await recordError(convId, step.reason, "teto")
          persist(convId)
          return
        }

        const def = engine.phases[i]
        const handoffPath = handoffFileName(dir, i, def.persona)

        // fase 1 = task pura; fases seguintes = blackboard tipado (.mission/*.json
        // que os agentes escreveram) + lista LEVE de arquivos mudados. O código
        // não viaja no prompt — está no worktree. Se ninguém emitiu JSON, cai no
        // fallback do tail do transcript (buildHandoff).
        let priorHandoffs: string | null = null
        let changedFiles: string | null = null
        let fallbackContext: string | null = null
        if (i > 0) {
          const priors: PriorHandoff[] = []
          for (let j = 0; j < i; j++) {
            const pdef = engine.phases[j]
            const doc = await readHandoff(cwd, handoffFileName(dir, j, pdef.persona))
            if (doc) priors.push({ label: pdef.label, persona: pdef.persona, doc })
          }
          if (priors.length > 0) priorHandoffs = formatPriorHandoffs(priors)
          else fallbackContext = buildHandoff(prevItems)
          changedFiles = changedFilesRef(await loadGitDiff(cwd))
        }

        // M1/M2 — injeta o que o projeto já aprendeu. Recall só no planner
        // (alimenta o plano); lições em planner E executor. Best-effort: falha
        // de DB degrada p/ blocos nulos (buildLearningBlocks já é tolerante).
        const learn = await buildLearningBlocks(
          projectId,
          task,
          def.persona === "planner",
        )
        if (learn.lessonIds.length) void markLessonsUsed(learn.lessonIds)

        // G2.1 — `/comando` digitado no campo de tarefa expande pro MOTOR
        // DESTA fase (inventário do agent da fase, lido do worktree). A task
        // vai EMBUTIDA no prompt da fase, então até comando nativo precisa do
        // corpo. Fail-open: sem match/inventário, a task segue como texto. O
        // fio e a entrega guardam a task DIGITADA (a expansão é só do prompt).
        const phaseTask = await expandDraftForAgent(task, cwd, def.agent, {
          embedded: true,
        })

        const prompt = phasePrompt({
          persona: def.persona,
          task: phaseTask,
          handoffPath,
          priorHandoffs,
          changedFiles,
          fallbackContext,
          instructions: def.instructions,
          entryCriteria: def.entryCriteria,
          exitCriteria: def.exitCriteria,
          doctrineBlock,
          recallBlock: learn.recall,
          lessonsBlock: learn.lessons,
          userDecisions: gateDecisions,
        })
        // marco em disco leva o gate consumido POR esta fase: um crash no meio
        // dela retoma re-rodando a fase com as MESMAS decisões do usuário.
        const gateBlockForPhase = gateDecisions
        gateDecisions = null // só a fase imediatamente após o gate recebe
        // anexos do gate: consumidos aqui (fase seguinte ao gate) e zerados —
        // um re-run por recuperação da MESMA fase ainda os recebe (phaseAtts).
        const phaseGateAtts: Attachment[] | undefined =
          gateAttachments.length > 0 ? gateAttachments : undefined
        gateAttachments = []

        patchConv(convId, { current: i })
        patchPhase(convId, i, (ph) => ({
          ...ph,
          status: "running",
          startedAt: Date.now(),
        }))
        // marco em disco: transição de fase (current = i, fase running).
        persist(convId, gateBlockForPhase)

        // ── RECUPERAÇÃO: re-roda a MESMA fase i (mesmo prompt, sem i++) quando a
        // falha é RECUPERÁVEL (limite/rate-limit/crédito) e o usuário escolhe
        // outro agent. Espelha o gate: pausa em recovery e aguarda a escolha. O
        // custo é REAL a cada tentativa (soma todas), o prompt não muda entre
        // elas — só o agent/modelo/effort da def da fase corrente.
        let result: PhaseResult
        while (true) {
          const cur = engine.phases[i]
          // Run DESASSISTIDO por FASE (MH1.2, ADR-021): a missão roda sozinha
          // entre gates — um pedido de permissão/pergunta sem resposta
          // congelaria a fase pra sempre (o backend espera sem timeout,
          // approval.rs). Marcada, o vigia (lib/watchdog) responde fail-closed
          // passado settings.unattendedAnswerAfterMin; o clear no finally é o
          // "cancelamento do timer" (padrão scheduleEngine). Missão com você
          // na frente não precisa de distinção: o limiar é em minutos — quem
          // está olhando responde antes.
          const phaseRun = phaseRunId(missionId, i)
          // MH2.2 — teto RESTANTE pra esta invocação: o corte intra-fase usa o
          // custo já acumulado da missão (fases + tentativas anteriores).
          const live = get().byConv[convId]
          const stopAt =
            live && live.maxCostUsd != null
              ? live.maxCostUsd - live.costTotal
              : null
          costInvocation++
          const inv = costInvocation
          markUnattendedRun(phaseRun, convId)
          try {
            result = await runPhase({
              runId: phaseRun,
              convId,
              agent: cur.agent,
              model: cur.model,
              effort: cur.effort,
              prompt,
              cwd,
              // permissão POR MEMBRO: a fase marcada "auto" roda autônoma (com o
              // freio do CLI); as demais herdam a permissão do projeto.
              permission: phasePermission(permission, cur),
              maxRetries: cur.maxRetries,
              // anexos: 1ª fase (i === 0) = os do launcher, junto do pedido
              // original; fase seguinte a um GATE = os das respostas ricas
              // (phaseGateAtts). As demais herdam o contexto pelo handoff/worktree.
              attachments: i === 0 ? attachments : phaseGateAtts,
              // o carimbo da ÚLTIMA SAÍDA sai daqui porque aqui é o único
              // lugar que vê TODO evento (o runPhase chama por evento, não por
              // item novo): um motor calado que só cospe texto continua sendo
              // medido, e um bloco de texto crescendo por deltas não passa por
              // silêncio (R5, duas idades).
              onProgress: (attempt, items) =>
                patchPhase(convId, i, (ph) => ({
                  ...ph,
                  attempt,
                  items,
                  lastOutputAt: Date.now(),
                } as MissionPhaseRun)),
              // MH2.1 — CADA fase grava turn_costs no result (fonte única do
              // Painel/cards), INCLUSIVE quando a missão vai abortar/estourar
              // depois: grava aqui, no ponto em que o custo é conhecido.
              // Best-effort (recordTurnCost engole falha) e uma linha por
              // tentativa: o run_id carrega nonce+invocação+attempt.
              onCost: (attempt, c) => {
                void recordTurnCost({
                  runId: `${phaseRun}::${costNonce}-${inv}-${attempt}`,
                  projectId,
                  convId,
                  agent: cur.agent,
                  model: cur.model,
                  costUsd: c.costUsd,
                  costSource: c.costSource ?? null,
                  input: c.input,
                  output: c.output,
                  cache: c.cache,
                })
              },
              stopAtCostUsd: stopAt,
            })
          } finally {
            clearUnattendedRun(phaseRun)
          }

          // abortada DURANTE a fase (o run saiu por cancel) → não sobrescreve.
          const after = get().byConv[convId]
          if (!after || after.status !== "running") return

          // custo acumulado da fase E da missão — cada tentativa gastou de fato.
          patchConv(convId, (c) => ({ costTotal: c.costTotal + result.costUsd }))

          if (result.ok) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "done",
              costUsd: ph.costUsd + result.costUsd,
              costSource: result.costSource,
              endedAt: Date.now(),
              error: undefined,
            }))
            break
          }

          // transição de falha (motor): teto intra-fase (MH2.2) vem ANTES do
          // recuperável — o cancel do corte pode deixar rastro de "limite" no
          // transcript e teto estourado nunca vira card de recuperação.
          const fail = failureTransition(result, i, after.maxCostUsd)
          if (fail.kind === "teto-fase") {
            // MESMO desfecho do check entre fases (error de teto), com o
            // notice dizendo ONDE mordeu.
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              costUsd: ph.costUsd + result.costUsd,
              costSource: result.costSource,
              endedAt: Date.now(),
              error: fail.reason,
            }))
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, fail.reason, "teto")
            persist(convId)
            return
          }

          // falha NÃO-recuperável (bug, timeout, cancel) → kill atual: a fase e a
          // missão vão a error e o loop morre (comportamento herdado).
          if (fail.kind === "falha") {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              costUsd: ph.costUsd + result.costUsd,
              costSource: result.costSource,
              endedAt: Date.now(),
              error: fail.error,
            }))
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, fail.reason, "falha")
            persist(convId)
            return
          }

          // falha RECUPERÁVEL → PAUSA em recovery e aguarda a escolha do usuário.
          patchPhase(convId, i, (ph) => ({
            ...ph,
            status: "error",
            costUsd: ph.costUsd + result.costUsd,
            costSource: result.costSource,
            // sem endedAt: a fase pausou pra troca de motor e vai RE-RODAR do
            // começo; congelar o fim aqui daria duração de uma corrida que
            // ainda não acabou.
            error: result.error,
          }))
          patchConv(convId, {
            recovery: {
              phase: i,
              error: fail.error,
              message: fail.message,
            },
          })
          // marco em disco: recovery aberto (a pausa não sobrevive a restart —
          // retomar re-roda a fase corrente do zero, que re-falha se preciso).
          persist(convId, gateBlockForPhase)
          // MH2.3 — recovery pendente AVISA (sino/feed + SO): a missão está
          // parada esperando você trocar de agent, em qualquer modo/app em
          // background. 1 por episódio POR CONSTRUÇÃO: este é o único ponto
          // que abre recovery, e um re-run que re-falha é episódio novo
          // (mesma regra do notifyGate — sem memória extra).
          {
            const projName =
              useApp.getState().projects.find((p) => p.id === projectId)?.name ??
              ""
            notifyMissionRecovery(convId, projName, engine.phases[i].label)
          }
          const choice = await new Promise<RecoveryChoice | null>((resolve) => {
            recoveryWaiters.set(missionId, resolve)
          })
          recoveryWaiters.delete(missionId)
          // abortada por fora durante a espera (abort/clear resolveram null e já
          // marcaram aborted): não força error, só sai do loop da missão.
          const still = get().byConv[convId]
          if (!still || still.status !== "running") return
          patchConv(convId, { recovery: null })
          if (choice === null) {
            // desistiu (abortRecovery) → a missão vai a error, como antes.
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, fail.abandonReason, "falha")
            persist(convId)
            return
          }
          // budget HARD também no re-run (motor: o nextTransition do topo só
          // roda ao ENTRAR numa fase nova; sem isto o teto seria furado ao
          // retomar — o caminho mais caro é justamente re-rodar a fase que
          // falhou). Recusa a recuperação já estourada em vez de gastar e só
          // então morrer.
          const rebud = rerunBudget(still.costTotal, still.maxCostUsd)
          if (!rebud.ok) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              error: rebud.reason,
            }))
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, rebud.reason, "teto")
            persist(convId)
            return
          }
          // marco: a pausa por limite + retomada com o agent escolhido no fio.
          await recordHistory(convId, [
            noticeItem(
              `Fase ${i + 1} · ${engine.phases[i].label} parou por limite; retomada com ${choice.agent}`,
            ),
          ])
          // troca a def da fase corrente e RE-RODA a MESMA fase (volta ao topo
          // do while). O índice NÃO avança; o prompt já montado é reusado.
          engine = applyRecoveryChoice(engine, choice)
          patchPhase(convId, i, (ph) => ({
            ...ph,
            def: {
              ...ph.def,
              agent: choice.agent,
              model: choice.model,
              effort: choice.effort,
            },
            status: "running",
            attempt: 1,
            startedAt: Date.now(),
            endedAt: null,
            error: undefined,
          }))
          // marco em disco: recovery resolvido (def da fase trocada, re-rodando).
          persist(convId, gateBlockForPhase)
        }

        prevItems = result.items
        // marco em disco: fase concluída (status/custos atualizados).
        persist(convId)

        // marco: fase concluída → notice (label/agent/custo) + resumo CURTO da
        // fase no fio (phaseText truncado — o transcript pleno não é o objetivo).
        {
          const phCost =
            get().byConv[convId]?.phases[i]?.costUsd ?? result.costUsd
          const marks: ChatItem[] = [
            noticeItem(
              `Fase ${i + 1}/${engine.phases.length} · ${engine.phases[i].label} (${engine.phases[i].agent}) · concluída · US$ ${phCost.toFixed(2)}`,
            ),
          ]
          const summary = phaseText(result.items)
          if (summary) {
            marks.push({
              kind: "text",
              id: crypto.randomUUID(),
              text: summarize(summary),
            })
          }
          await recordHistory(convId, marks)
        }

        // transições pós-fase (motor, MH4.1): matéria-prima da entrega (plano
        // do 1º planner, agent do 1º executor — pode ter trocado na
        // recuperação), veredito do reviewer (MH1.1: a última revisão decide a
        // ressalva) e o loop de correção do M2 (executor corretivo + re-review
        // até MAX_REVIEW_LOOPS, sempre sob o teto checado no topo do while).
        const doneStep = afterPhaseDone(engine, result.items, missionId)
        engine = doneStep.state
        if (doneStep.review) {
          // espelho vivo do persist: o próximo marco grava o veredito fresco
          // (e as rodadas já disparadas — memória do clamp através de crash).
          missionReview.set(convId, {
            loops: engine.reviewLoops,
            last: doneStep.review,
          })
        }
        if (doneStep.correction) {
          const corr = doneStep.correction
          // POSIÇÃO (corr.at): as corretivas entram LOGO DEPOIS do revisor que
          // reprovou, não no fim da fila — senão as fases seguintes rodariam em
          // cima de um trabalho já reprovado. A inserção é toda ADIANTE de
          // `current` (= i), então o índice da fase corrente, os handoffs já
          // gravados (nomeados pelo índice) e os runId das fases passadas
          // seguem válidos; o run e o preset efetivo andam paralelos.
          patchConv(convId, (cur) => ({
            phases: [
              ...cur.phases.slice(0, corr.at),
              queuedRun(corr.corrective),
              queuedRun(corr.rereview),
              ...cur.phases.slice(corr.at),
            ],
          }))
          // marco em disco: preset efetivo mudou (fases corretivas inseridas).
          persist(convId)
          // O DENOMINADOR NÃO CRESCE CALADO: "fase 3 de 4" vira "fase 3 de 6"
          // no mesmo render, e o número novo vai pro banco. O crescimento é
          // correto (missão que acha problema tem que corrigir); o silêncio
          // não era. O marco diz quem mudou, por quê, o que entrou, onde e de
          // quanto pra quanto. A fase acrescentada leva a procedência no def.
          await recordHistory(convId, [
            noticeItem(
              `O plano de voo cresceu · o revisor reprovou a fase ${i + 1} (${engine.phases[i].label}), e o motor acrescentou ${corr.corrective.label} e ${corr.rereview.label} logo depois dela. O plano foi de ${corr.before} para ${corr.after} fases.`,
            ),
          ])
        }

        // ── GATE HUMANO: a fase deixou perguntas em aberto e HÁ próxima fase →
        // PAUSA a missão até o usuário responder (answerGate). As respostas
        // viram diretriz no prompt da próxima fase. Abortar resolve com null.
        // MH3.3 — a POLÍTICA do preset decide: "agente" = clássico; "nunca" =
        // não pausa (as perguntas viram notice, informação nunca some);
        // "sempre-apos-planejar" = gate obrigatório após a fase 1 mesmo sem
        // perguntas (pergunta padrão de revisão do plano).
        const handoffDoc = await readHandoff(cwd, handoffPath)
        const gateResult = gateTransition(
          engine,
          preset.gatePolicy,
          handoffDoc?.open_questions,
        )
        if (gateResult.kind === "notice") {
          // política "nunca": a missão SEGUE, mas as perguntas ficam no fio.
          await recordHistory(convId, [
            noticeItem(
              `A fase ${i + 1} deixou perguntas em aberto (a política do time não pausa a missão):\n${gateResult.questions.map((q, k) => `${k + 1}. ${q}`).join("\n")}`,
            ),
          ])
        }
        const questions = gateResult.kind === "gate" ? gateResult.questions : []
        if (questions.length > 0) {
          const stillRunning = get().byConv[convId]
          if (!stillRunning || stillRunning.status !== "running") return
          patchConv(convId, { gate: { phase: i, questions } })
          // marco em disco: gate ABERTO. O gate pendente NÃO sobrevive a
          // restart (retomar re-roda a fase corrente do zero — ela re-pergunta
          // se precisar); o marco mantém current/custos frescos no arquivo.
          persist(convId)
          // notificação nativa: o gate ABRIU — a missão está parada esperando
          // você, em qualquer modo/app em background. 1 por gate (só aqui).
          {
            const projName =
              useApp.getState().projects.find((p) => p.id === projectId)?.name ??
              ""
            notifyGate(convId, projName, engine.phases[i].label)
          }
          // waiter registrado ANTES do record: o await do marco não pode abrir
          // janela pro answerGate resolver no vazio.
          const waiter = new Promise<GateAnswer[] | null>((resolve) => {
            gateWaiters.set(missionId, resolve)
          })
          // marco: perguntas do gate no fio.
          await recordHistory(convId, [
            noticeItem(
              `⏸️ Gate humano · a fase ${i + 1} deixou perguntas:\n${questions.map((q, k) => `${k + 1}. ${q}`).join("\n")}`,
            ),
          ])
          const answers = await waiter
          gateWaiters.delete(missionId)
          patchConv(convId, { gate: null })
          if (answers === null) return // abortada durante o gate
          gateDecisions = buildGateDecisionsBlock(
            questions,
            answers.map((a) => a.text),
          )
          // anexos das respostas → runPhase da PRÓXIMA fase, filtrados pelo
          // caps do agent dela (não suportado ⇒ descarta com notice, sem erro).
          const nextAgent = engine.phases[i + 1]?.agent ?? ""
          const split = splitGateAttachments(answers, agentCaps(nextAgent))
          gateAttachments = split.kept
          // marco: respostas do usuário no fio (em branco = agente decide;
          // resposta com anexos ganha o sufixo "+ N anexos").
          const answered = questions.map((_q, k) => {
            const a = answers[k]
            const text =
              (a?.text ?? "").trim() || "(sem resposta, o agente decide)"
            const n = a?.attachments?.length ?? 0
            return `${k + 1}. ${text}${n > 0 ? ` (+ ${n} ${n === 1 ? "anexo" : "anexos"})` : ""}`
          })
          const marks: ChatItem[] = [
            noticeItem(`▶️ Gate respondido:\n${answered.join("\n")}`),
          ]
          if (split.dropped.length > 0) {
            marks.push(
              noticeItem(
                `⚠️ ${split.dropped.length} ${split.dropped.length === 1 ? "anexo descartado" : "anexos descartados"} · ${nextAgent} não suporta: ${split.dropped.map((d) => d.name).join(", ")}`,
              ),
            )
          }
          await recordHistory(convId, marks)
          // marco em disco: gate RESPONDIDO — as decisões sobrevivem a restart
          // (reinjetadas na fase corrente ao retomar).
          persist(convId, gateDecisions)
        }

        engine = advance(engine)
      }

      // todas as fases passaram → done, current aponta além do fim.
      // MH1.1 — desfecho HONESTO (motor): a última revisão reprovou e as
      // rodadas de correção esgotaram ⇒ done COM RESSALVA explícita
      // (status/timeline, notice no fio, resumo final). A entrega aconteceu
      // (worktree, delivery, lição), só não foi aprovada — dizer isso é o mínimo.
      const reviewCaveat = finalCaveat(engine)
      const finalCost = get().byConv[convId]?.costTotal ?? 0
      patchConv(convId, {
        status: "done",
        current: engine.phases.length,
        reviewCaveat,
      })
      // marco em disco: fim normal — o arquivo vira `done` (terminal; a
      // detecção do boot nunca oferece retomada de done).
      persist(convId)
      // MH2.3 — desfecho AVISA (sino/feed + SO, dedupe por missão no notify):
      // fim ok e fim com ressalva têm copy distinta — a ressalva pede que você
      // revise o parecer antes de confiar (mesmo idioma do notice acima).
      notifyMissionEnd({
        missionId,
        convId,
        outcome: reviewCaveat ? "ressalva" : "concluida",
        costUsd: finalCost,
        detail: `preset ${preset.name}`,
      })

      // ── Resumo estruturado da conclusão (UI "concluída"): intenção + arquivos
      // + pendências, do handoff mais RECENTE que existir. Best-effort.
      try {
        for (let j = engine.phases.length - 1; j >= 0; j--) {
          const doc = await readHandoff(
            cwd,
            handoffFileName(dir, j, engine.phases[j].persona),
          )
          if (doc) {
            patchConv(convId, {
              doneSummary: {
                intent: doc.intent || null,
                openQuestions: doc.open_questions ?? [],
                filesTouched: doc.files_touched ?? [],
              },
            })
            break
          }
        }
      } catch {
        // sem resumo estruturado — a UI cai no texto final da fase.
      }

      // marco: conclusão no fio — result (ok + custo total) + o doneSummary
      // (veredito/arquivos/pendências) quando houver. Com RESSALVA (MH1.1), o
      // notice explícito vem antes e o resumo carrega o parecer do revisor.
      {
        const ds = get().byConv[convId]?.doneSummary
        const marks: ChatItem[] = []
        // Teto furado NA ÚLTIMA fase: o checkBudget é gate de fase NOVA, então
        // depois da última ninguém checava — a missão fechava done com
        // costTotal > teto em silêncio. O desfecho não muda (o gasto já
        // ocorreu, o trabalho foi entregue); o registro é o mínimo honesto.
        const runNow = get().byConv[convId]
        if (
          runNow?.maxCostUsd != null &&
          finalCost > runNow.maxCostUsd
        ) {
          marks.push(
            noticeItem(
              `⚠️ Custo final US$ ${finalCost.toFixed(2)} passou o teto de US$ ${runNow.maxCostUsd.toFixed(2)} (o estouro aconteceu na última fase, depois do último check).`,
            ),
          )
        }
        if (reviewCaveat) {
          marks.push(
            noticeItem(
              reviewCaveat.rounds > 0
                ? `⚠️ Concluída SEM aprovação do revisor após ${reviewCaveat.rounds} ${reviewCaveat.rounds === 1 ? "rodada" : "rodadas"} de correção. Revise o parecer antes de confiar na entrega.`
                : "⚠️ Concluída SEM aprovação do revisor (não havia executor para uma rodada de correção). Revise o parecer antes de confiar na entrega.",
            ),
          )
        }
        marks.push({
          kind: "result",
          id: crypto.randomUUID(),
          ok: true,
          costUsd: finalCost,
          text: reviewCaveat
            ? `Missão concluída com ressalva do revisor · preset ${preset.name}`
            : `Missão concluída · preset ${preset.name}`,
        })
        const lines: string[] = []
        if (ds?.intent) lines.push(ds.intent)
        if (ds?.filesTouched.length)
          lines.push(`Arquivos: ${ds.filesTouched.join(", ")}`)
        if (ds?.openQuestions.length)
          lines.push(
            `Pendências:\n${ds.openQuestions.map((q) => `- ${q}`).join("\n")}`,
          )
        if (reviewCaveat?.feedback) {
          lines.push(`Parecer do revisor:\n${summarize(reviewCaveat.feedback)}`)
        }
        if (lines.length) {
          marks.push({
            kind: "text",
            id: crypto.randomUUID(),
            text: lines.join("\n\n"),
          })
        }
        await recordHistory(convId, marks)
      }

      // ── M1: grava a ENTREGA (evento de alto sinal: passou nos gates) ──
      // Arquivos = paths do diff do worktree; fallback = files_touched dos
      // handoffs .mission/. Best-effort: nada aqui pode quebrar o "done".
      try {
        let files: string[] = []
        const diff = await loadGitDiff(cwd)
        if (diff.isRepo && diff.files.length) {
          files = diff.files.map((f) => f.path)
        } else {
          const seen = new Set<string>()
          for (let j = 0; j < engine.phases.length; j++) {
            const doc = await readHandoff(
              cwd,
              handoffFileName(dir, j, engine.phases[j].persona),
            )
            for (const f of doc?.files_touched ?? []) seen.add(f)
          }
          files = [...seen]
        }
        await insertDelivery({
          projectId,
          task,
          planSummary: engine.plannerSummary,
          filesTouched: files,
          costUsd: finalCost,
          agent: engine.execAgent,
          model: engine.execModel,
        })
      } catch {
        // entrega não gravada não invalida a missão — só perde o recall futuro.
      }

      // ── M2: destila UMA lição das correções REAIS que foram resolvidas ──
      // Estágio 1 do funil: distillLesson grava como CANDIDATE (não injeta até
      // ser promovida na auditoria) — sinal do loop é mais fraco que o save
      // explícito do Linear.
      if (engine.corrections.length && helperModel) {
        void distillLesson({
          projectId,
          cwd,
          helperModel,
          reviewerFeedback: engine.corrections.join("\n\n---\n\n"),
        })
      }
    },

    // Stop de verdade: cancela o run da fase corrente via cancel_agent e marca
    // aborted; fases feitas ficam no estado (nada se perde — está no worktree).
    // Se estava PAUSADA num gate, libera o loop (resolve com null).
    abort: (convId) => {
      const run = get().byConv[convId]
      if (!run || !isActive(run.status)) return
      const idx = run.current
      if (idx >= 0 && idx < run.phases.length) {
        void cancelAgent(phaseRunId(run.id, idx))
      }
      patchConv(convId, (cur) => ({
        status: "aborted",
        gate: null,
        recovery: null,
        phases: cur.phases.map((ph, i) =>
          i === idx && ph.status === "running"
            ? // o fim congela AQUI: o processo morreu neste instante, e sem o
              // carimbo a fase interrompida ficaria sem duração nenhuma.
              { ...ph, status: "aborted", endedAt: Date.now() }
            : ph,
        ),
      }))
      // libera o loop se estava pausado num gate OU numa recuperação (resolve
      // null; o while checa status !== "running" e sai sem forçar error).
      gateWaiters.get(run.id)?.(null)
      recoveryWaiters.get(run.id)?.(null)
      // marco em disco: aborted é terminal — o boot não oferece retomada.
      persist(convId)
      // marco terminal no fio (fire-and-forget: nunca segura o Stop; o
      // appendItems no-opa se a conversa já saiu de byId, ex. deleção).
      void recordHistory(convId, [
        {
          kind: "result",
          id: crypto.randomUUID(),
          ok: false,
          costUsd: run.costTotal,
          text: "Missão interrompida pelo usuário (Stop)",
        },
      ])
    },

    clear: (convId) =>
      set((s) => {
        // gate/recovery pendente em missão descartada → libera o loop (null).
        const run = s.byConv[convId]
        if (run) {
          gateWaiters.get(run.id)?.(null)
          recoveryWaiters.get(run.id)?.(null)
        }
        // plumbing por conversa sai junto do run (sem entrada órfã): um launch
        // futuro re-semeia os dois antes do primeiro persist.
        missionCwd.delete(convId)
        missionReview.delete(convId)
        const rest = { ...s.byConv }
        delete rest[convId]
        return { byConv: rest }
      }),

    answerGate: (convId, answers) => {
      const run = get().byConv[convId]
      if (!run?.gate) return
      // string[] legado (UI atual) vira GateAnswer[] sem anexos — retrocompat.
      gateWaiters.get(run.id)?.(normalizeGateAnswers(answers))
    },

    resolveRecovery: (convId, choice) => {
      const run = get().byConv[convId]
      if (!run?.recovery) return
      recoveryWaiters.get(run.id)?.(choice)
    },

    abortRecovery: (convId) => {
      const run = get().byConv[convId]
      if (!run?.recovery) return
      recoveryWaiters.get(run.id)?.(null)
    },
  }
})
