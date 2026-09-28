// MOTOR do modo Mission (docs/mission-mode.md §3, M1): pipeline SEQUENCIAL de
// agents heterogêneos numa conversa. Store IRMÃO do useChat, modelado no
// store/fusion.ts (set síncrono, guarda anti-duplo-start, custo acumulado).
import { create } from "zustand"
import { cancelAgent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type {
  GateAnswer,
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
import { recordTurnCost, upsertMission } from "@/lib/db"
import { blocoDaDoutrina, readDoctrine } from "@/lib/doctrine"
import { buildLearningBlocks, markLessonsUsed } from "@/lib/learning"
import {
  errorMark,
  finishMarks,
  recordDelivery,
  recordLesson,
} from "@/lib/missionDelivery"
import {
  awaitRelease,
  clearReleaseWaiter,
  forgetInterrupt,
  isWaitingRelease,
  markInterrupt,
  missionCwd,
  missionReview,
  releaseWaiter,
  takeInterrupt,
} from "@/lib/missionHold"
import { useApp } from "@/store/app"
import { helperDoProjeto } from "@/lib/helperDoProjeto"
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
  nextTransition,
  rerunBudget,
} from "@/lib/missionEngine"
import {
  continueInterruptedMissionVisit,
  routeCompletedMissionVisit,
} from "@/lib/missionGraphRunTransition"
import { initializeMissionGraphRun } from "@/lib/missionGraphRunInit"
import {
  changedFilesRef,
  formatPriorHandoffs,
  readHandoff,
  type PriorHandoff,
} from "@/lib/missionHandoff"
import { ensureMissionCwd } from "@/lib/missionWorktree"
import { clearUnattendedRun, markUnattendedRun } from "@/lib/unattendedRuns"
import { handoffFileName } from "@/lib/missionPaths"
import { expandEmbeddedDraft } from "@/lib/slashDispatch"
import {
  ensureMissionsGitignore,
  readInterruptedFor,
  runToState,
  shouldOfferResume,
  writeActivePointer,
  writeRunState,
  type InterruptedMission,
  type MissionRunState,
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
    /** Interno (retomada): snapshot do run-state.json. O launch começa na fase
     *  corrente, com as anteriores como done e o custo somando ao teto; o
     *  prompt se reconstrói dos handoffs em disco. Gate ou recovery pendentes
     *  no crash não sobrevivem: a fase re-roda e re-pergunta. */
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

  /** Gate humano: entrega as respostas e retoma. answers[i] responde
   *  gate.questions[i] (em branco = o agente decide). Aceita GateAnswer[]
   *  (texto e anexos) ou string[]; anexos vão para a próxima fase, filtrados
   *  pelas capacidades do agent dela (sem suporte vira notice). */
  answerGate: (convId: string, answers: GateAnswer[] | string[]) => void

  /** Recuperação: troca a def da fase corrente e re-roda a mesma fase. No-op
   *  sem recovery pendente. */
  resolveRecovery: (convId: string, choice: RecoveryChoice) => void

  /** Recuperação: desistiu, a missão vai a error. No-op sem recovery. */
  abortRecovery: (convId: string) => void

  /** R7 — SEGURAR NO FIM DESTA FASE (reversível): a fase corrente termina
   *  normal e a PRÓXIMA não começa sem você. Parada a missão, o gesto de
   *  desligar deixa de existir e vira `releaseHold`. */
  holdAfterPhase: (convId: string, on: boolean) => void

  /** Interromper esta fase (irreversível): mata o processo agora, o que foi
   *  escrito fica no worktree, a fase fica `aborted` e a missão segura (matar
   *  tudo é o Parar). */
  interruptPhase: (convId: string) => void

  /** Solta a missão que segurava. No-op sem hold. */
  releaseHold: (convId: string) => void
}

/** MissionRun em execução ainda tem fase corrente rodando/na fila. */
function isActive(status: MissionStatus): boolean {
  return status === "running"
}

/** runId estável por fase p/ cancelamento (index-based, uma missão por conv). */
function phaseRunId(missionId: string, phaseIdx: number): string {
  return `${missionId}::phase-${phaseIdx}`
}

/** Gate humano: resolvedores das missões pausadas (por missionId). O loop do
 *  launch fica aguardando; answerGate resolve com as respostas (já normalizadas
 *  p/ GateAnswer[]), abort com null. */
const gateWaiters = new Map<string, (answers: GateAnswer[] | null) => void>()

/** Resolvedores das missões pausadas numa falha recuperável, por missionId, no
 *  padrão do gate: resolver com a escolha re-roda, com null desiste. */
const recoveryWaiters = new Map<string, (choice: RecoveryChoice | null) => void>()

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

  /** Persiste o checkpoint a cada marco sem interromper a missão. Falhas ficam
   *  visíveis em `checkpointWarning`; gates pendentes reexecutam após restart. */
  const persist = (
    convId: string,
    gateDecisions?: string | null,
  ): Promise<void> => {
    const run = get().byConv[convId]
    const cwd = missionCwd.get(convId)
    if (!run || !cwd) return Promise.resolve()
    const runId = run.id
    const checkpoint = writeRunState(
      cwd,
      runToState(run, gateDecisions, missionReview.get(convId)),
    )
    // Regrava o ponteiro a cada marco para recuperar uma falha transitória no launch.
    const pointer = writeActivePointer(cwd, convId, run.dir)
    // Disco guarda os artefatos; o banco mantém o índice navegável.
    indexMission(convId)
    return Promise.all([checkpoint, pointer]).then(([stateError, pointerError]) => {
      const warning = stateError ?? pointerError
      const live = get().byConv[convId]
      if (live?.id === runId && (live.checkpointWarning ?? null) !== warning) {
        patchConv(convId, { checkpointWarning: warning })
      }
    })
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

  /** Marco terminal de erro no fio e o aviso (ADR-013; composição pura em
   *  lib/missionDelivery). Abort seu não passa por aqui. */
  const recordError = (
    convId: string,
    reason: string,
    outcome: "falha" | "teto",
  ) => {
    const run = get().byConv[convId]
    if (run) notifyMissionEnd({ missionId: run.id, convId, outcome, costUsd: run.costTotal, detail: reason })
    return recordHistory(convId, [errorMark(run?.costTotal ?? 0, reason)])
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
      // O snapshot do arquivo, não o plano global atual, governa a retomada.
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

      // Snapshot e semente entram no store antes do primeiro await: isso fecha
      // a janela de duplo clique sem deixar um run fantasma se o preparo falhar.
      const initialized = initializeMissionGraphRun({
        convId,
        preset,
        task,
        resume,
        newMissionId: crypto.randomUUID(),
        now: Date.now(),
        visitNonce: () => crypto.randomUUID().slice(0, 8),
      })
      if (!initialized.ok) {
        await recordHistory(convId, [
          noticeItem(`Missão não lançada: ${initialized.error}`),
        ])
        return
      }
      preset = initialized.preset
      let engine = initialized.engine
      const { run, missionId, dir, startPhase } = initialized
      const priorInterrupted = get().interrupted[convId]
      set((s) => {
        const interrupted = { ...s.interrupted }
        delete interrupted[convId]
        return { byConv: { ...s.byConv, [convId]: run }, interrupted }
      })

      // Retomada preserva o cwd; launch novo garante worktree ou pede fallback.
      const conv = useChat.getState().byId[convId]
      const ensured = await ensureMissionCwd({
        convId,
        projectPath,
        worktreePath: conv?.worktreePath ?? null,
        resume: !!resume,
      })
      if (!ensured.ok) {
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
      // Memória do loop de revisão antes do primeiro marco: um crash logo após
      // a retomada não pode zerar o clamp.
      missionReview.set(convId, {
        loops: engine.reviewLoops,
        last: engine.lastReview,
      })

      // Modelo helper (Haiku) p/ destilar lições (M2); null = destilação
      // desligada. Mesma régua das sugestões e do recibo de turno.
      const helperModel = helperDoProjeto(projectId)

      // Doutrina do projeto lida uma vez e injetada em todas as fases: cada fase
      // é um CLI novo, e codex/agy não leem CLAUDE.md. Lê da raiz, não do
      // worktree, que só teria o arquivo depois do 1º commit.
      const doctrineBlock = blocoDaDoutrina(await readDoctrine(projectPath))

      // garante que os artefatos fiquem FORA do git mesmo num worktree fresco
      // (o onboarding pode não ter semeado o .frota/.gitignore ali).
      void ensureMissionsGitignore(cwd)

      // marco: largada no fio da conversa (task + resumo do preset). O launcher
      // já garantiu byId (ensureConversationLoaded) — Escritório e Trabalho.
      // Na retomada a task JÁ está no fio — só o notice de retomada entra.
      await recordHistory(
        convId,
        resume
          ? [
              noticeItem(
                `⟳ Missão retomada na visita ${startPhase + 1} · ${engine.phases[startPhase]?.label ?? "fase atual"} · preset ${preset.name}`,
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
                `🚀 Missão iniciada · preset ${preset.name} · ${preset.phases.length} ${preset.phases.length === 1 ? "fase" : "fases"}`,
              ),
            ],
      )
      // Marco em disco do início ou da retomada.
      persist(convId, resume?.gateDecisions ?? null)

      // Estado efêmero dos handoffs entre visitas.
      let prevItems: ChatItem[] = []
      let gateDecisions: string | null = resume?.gateDecisions ?? null
      let gateAttachments: Attachment[] = []

      // Gate v2 espera no checkpoint sem repetir a visita anterior.
      if (resume?.gate) {
        const pending = resume.gate
        const answers = await new Promise<GateAnswer[] | null>((resolve) => {
          gateWaiters.set(missionId, resolve)
        })
        gateWaiters.delete(missionId)
        const live = get().byConv[convId]
        if (!live || live.status !== "running" || answers === null) return
        gateDecisions = buildGateDecisionsBlock(
          pending.questions,
          answers.map((answer) => answer.text),
        )
        const nextIndex = pending.phase + 1
        const nextAgent = engine.phases[nextIndex]?.agent ?? ""
        gateAttachments = splitGateAttachments(
          answers,
          agentCaps(nextAgent),
        ).kept
        engine = { ...engine, current: nextIndex }
        patchConv(convId, { gate: null, current: nextIndex })
        await persist(convId, gateDecisions)
      }

      // Recovery v2 troca o motor e conserva a mesma visita.
      if (resume?.recovery) {
        const choice = await new Promise<RecoveryChoice | null>((resolve) => {
          recoveryWaiters.set(missionId, resolve)
        })
        recoveryWaiters.delete(missionId)
        const live = get().byConv[convId]
        if (!live || live.status !== "running") return
        if (!choice) {
          const reason = resume.recovery.error || "recuperação abandonada"
          patchConv(convId, { recovery: null, status: "error" })
          await recordError(convId, reason, "falha")
          await persist(convId)
          return
        }
        engine = applyRecoveryChoice(engine, choice)
        patchPhase(convId, engine.current, (phase) => ({
          ...phase,
          def: engine.phases[engine.current],
          status: "queued",
          error: undefined,
        }))
        patchConv(convId, { recovery: null })
        await persist(convId, gateDecisions)
      }
      // Nonce mantém o ledger de custo único entre launches e retomadas.
      let costInvocation = 0
      const costNonce = Date.now().toString(36)

      fases: while (engine.current < engine.phases.length) {
        const i = engine.current
        // abortada por fora (byConv sumiu ou marcada aborted) → para o loop.
        const now = get().byConv[convId]
        if (!now || now.status !== "running") return

        // Budget hard antes de iniciar a visita.
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

        // Fase 1 = a task; as seguintes = o blackboard (.mission/*.json) e a
        // lista de arquivos mudados. O código fica no worktree, não no prompt.
        // Sem JSON, cai no tail do transcript (buildHandoff).
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

        // `/comando` na task expande para o motor DESTA fase: a task vai
        // embutida no prompt, então até comando nativo precisa do corpo. Sem
        // match, segue texto. O fio guarda a task digitada.
        const phaseExpansion = await expandEmbeddedDraft(task, cwd, def.agent)
        const phaseTask = phaseExpansion.text

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
        // O marco leva o gate consumido por esta fase: um crash retoma com as
        // mesmas decisões suas.
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

        // Recovery reexecuta esta visita; custo acumula em cada tentativa.
        let result: PhaseResult
        while (true) {
          const cur = engine.phases[i]
          // O watchdog mantém a missão desassistida viva entre gates.
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
              instructionSources: phaseExpansion.instructionSources,
              maxRetries: cur.maxRetries,
              // anexos: 1ª fase (i === 0) = os do launcher, junto do pedido
              // original; fase seguinte a um GATE = os das respostas ricas
              // (phaseGateAtts). As demais herdam o contexto pelo handoff/worktree.
              attachments: i === 0 ? attachments : phaseGateAtts,
              // o carimbo da ÚLTIMA SAÍDA sai daqui porque aqui é o único
              // lugar que vê TODO evento (R5, duas idades): o `ts` do item não
              // serve, texto crescendo por deltas mantém o do primeiro byte.
              onProgress: (attempt, items) =>
                patchPhase(convId, i, (ph) => ({
                  ...ph,
                  attempt,
                  items,
                  lastOutputAt: Date.now(),
                } as MissionPhaseRun)),
              // Uma linha de ledger por tentativa, inclusive em falha/teto.
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

          // Teto intra-fase vem antes do recuperável: o cancel do corte pode
          // deixar rastro de "limite", e teto estourado não vira recuperação.
          const fail = failureTransition(result, i, after.maxCostUsd, engine.phases[i])
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

          // VOCÊ mandou interromper ESTA fase (R7): o cancelamento é o gesto,
          // não um defeito — a fase fica incompleta e a missão SEGURA.
          if (takeInterrupt(missionId)) {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "aborted",
              costUsd: ph.costUsd + result.costUsd,
              costSource: result.costSource,
              endedAt: Date.now(),
              error: "interrompida por você",
            }))
            patchConv(convId, { hold: { phase: i, reason: "interrompida" } })
            persist(convId)
            const lbl = engine.phases[i].label
            await recordHistory(convId, [
              noticeItem(
                `Fase ${i + 1} · ${lbl} interrompida por você. O que ela escreveu continua no worktree; a missão está segurando.`,
              ),
            ])
            const segue = await awaitRelease(missionId)
            clearReleaseWaiter(missionId)
            const depois = get().byConv[convId]
            if (!depois || depois.status !== "running" || segue !== true) return
            patchConv(convId, { hold: null })
            const continuation = continueInterruptedMissionVisit({
              engine,
              run: depois,
              phaseIndex: i,
              nextVisitId: `${missionId}:visit:${i + 1}:${crypto.randomUUID().slice(0, 8)}`,
              at: Date.now(),
            })
            if (continuation.kind === "error") {
              patchConv(convId, { status: "error", current: i })
              await recordError(convId, continuation.reason, "falha")
              await persist(convId)
              return
            }
            engine = continuation.engine
            patchConv(convId, continuation.patch)
            await persist(convId)
            // `continue fases`, não `break`: o resto da iteração é sobre uma
            // fase que TERMINOU, e esta foi morta (o break pularia uma fase).
            continue fases
          }

          // Falha funcional depois dos retries: registra o resultado da visita
          // e deixa o grafo decidir se existe uma rota `failure`. Infraestrutura
          // recuperável e teto já foram tratados acima e nunca viram branch.
          if (fail.kind === "falha") {
            patchPhase(convId, i, (ph) => ({
              ...ph,
              status: "error",
              costUsd: ph.costUsd + result.costUsd,
              costSource: result.costSource,
              endedAt: Date.now(),
              error: fail.error,
            }))
            break
          }

          // Falha recuperável: pausa em recovery e espera a sua escolha.
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
          // Recovery pendente avisa (sino e SO): a missão espera você trocar de
          // agent. Um aviso por episódio por construção: este é o único ponto
          // que abre recovery.
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
            // Desistiu: a missão vai a error.
            patchConv(convId, { status: "error", current: i })
            await recordError(convId, fail.abandonReason, "falha")
            persist(convId)
            return
          }
          // Teto também no re-run: o do topo só roda ao entrar numa fase nova, e
          // re-rodar a fase que falhou é o caminho mais caro. Recusa a
          // recuperação já estourada em vez de gastar e morrer.
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
              `Visita ${i + 1} · ${engine.phases[i].label} (${engine.phases[i].agent}) · ${result.ok ? "concluída" : "falhou; avaliando rota"} · US$ ${phCost.toFixed(2)}`,
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

        // Captura entrega/veredito; correções existem somente no grafo.
        const doneStep = afterPhaseDone(
          engine,
          result.items,
          missionId,
          Date.now(),
          false,
        )
        engine = doneStep.state
        if (doneStep.review) {
          // espelho vivo do persist: o próximo marco grava o veredito fresco
          // (e as rodadas já disparadas — memória do clamp através de crash).
          missionReview.set(convId, {
            loops: engine.reviewLoops,
            last: doneStep.review,
          })
        }

        const graphStep = routeCompletedMissionVisit({
          engine,
          run: get().byConv[convId],
          phaseIndex: i,
          resultOk: result.ok,
          failureReason: result.ok ? undefined : result.error,
          review: doneStep.review,
          nextVisitId: `${missionId}:visit:${i + 1}:${crypto.randomUUID().slice(0, 8)}`,
          at: Date.now(),
        })
        patchPhase(convId, i, (phase) => ({
          ...phase,
          outcome: graphStep.outcome,
        }))
        if (graphStep.kind === "error") {
          patchConv(convId, { status: "error", current: i })
          await recordError(convId, graphStep.reason, "falha")
          await persist(convId)
          return
        }
        engine = graphStep.engine
        if (graphStep.kind === "review-caveat") {
          missionReview.set(convId, {
            loops: graphStep.reviewLoops,
            last: doneStep.review,
          })
          break fases
        }
        if (graphStep.kind === "advance") {
          if (doneStep.review && !doneStep.review.approved) {
            missionReview.set(convId, {
              loops: graphStep.reviewLoops,
              last: doneStep.review,
            })
          }
          patchConv(convId, (cur) => ({
            phases: [...cur.phases, graphStep.nextRun],
            execution: graphStep.execution,
          }))
          // Transição + visita pousam antes do próximo agent.
          await persist(convId)
        }

        // Gate humano: a fase deixou perguntas e há próxima fase, então pausa
        // até você responder; as respostas viram diretriz da próxima. A
        // política do preset decide: "agente" (clássico), "nunca" (as perguntas
        // viram notice) ou "sempre-apos-planejar" (gate após a fase 1).
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
          // Gate aberto faz parte do checkpoint v2.
          persist(convId)
          {
            const projName =
              useApp.getState().projects.find((p) => p.id === projectId)?.name ??
              ""
            notifyGate(convId, projName, engine.phases[i].label)
          }
          // Waiter antes do record: o await do marco não pode deixar o
          // answerGate resolver no vazio.
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
          // Marco com as suas respostas (anexos viram "+ N anexos").
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
          // Decisões são reinjetadas na visita seguinte mesmo após restart.
          persist(convId, gateDecisions)
        }

        // ── SEGURAR NO FIM DESTA FASE (R7): a fase acabou normal; a PRÓXIMA
        // é que não começa sem você.
        if (get().byConv[convId]?.hold?.reason === "pedido") {
          patchConv(convId, { hold: { phase: i, reason: "pedido" } })
          persist(convId)
          await recordHistory(convId, [
            noticeItem(
              `Missão segurando no fim da fase ${i + 1} · ${engine.phases[i].label}, a seu pedido. A próxima só começa quando você mandar.`,
            ),
          ])
          const segue = await awaitRelease(missionId)
          clearReleaseWaiter(missionId)
          const dps = get().byConv[convId]
          if (!dps || dps.status !== "running" || segue !== true) return
          patchConv(convId, { hold: null })
        }

        engine = advance(engine)
      }

      // Todas as fases passaram. Se a última revisão reprovou e as rodadas
      // esgotaram, é done COM RESSALVA: a entrega aconteceu, só não foi
      // aprovada, e isso aparece no status, no fio e no resumo.
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
      // O desfecho avisa (sino e SO, dedupe por missão). A ressalva pede que
      // você revise o parecer antes de confiar.
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

      // marco de conclusão: composição pura em missionDelivery.finishMarks.
      {
        const runNow = get().byConv[convId]
        await recordHistory(
          convId,
          finishMarks({
            presetName: preset.name,
            finalCost,
            maxCostUsd: runNow?.maxCostUsd ?? null,
            reviewCaveat,
            doneSummary: runNow?.doneSummary ?? null,
          }),
        )
      }

      // Fechamento (M1 entrega + M2 lição): lib/missionDelivery.
      {
        const close = {
          projectId,
          cwd,
          dir,
          task,
          phases: engine.phases,
          plannerSummary: engine.plannerSummary,
          execAgent: engine.execAgent,
          execModel: engine.execModel,
          costUsd: finalCost,
          corrections: engine.corrections,
          helperModel: helperModel ?? null,
        }
        await recordDelivery(close)
        recordLesson(close)
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
      releaseWaiter(run.id, null)
      forgetInterrupt(run.id)
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
          releaseWaiter(run.id, null)
          forgetInterrupt(run.id)
        }
        // O plumbing por conversa sai junto do run; um launch futuro re-semeia.
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

    holdAfterPhase: (convId, on) => {
      const run = get().byConv[convId]
      if (!run || !isActive(run.status)) return
      // segurando de verdade não é mais pedido reversível (aí é releaseHold).
      if (run.hold && isWaitingRelease(run.id)) return
      patchConv(convId, {
        hold: on ? { phase: run.current, reason: "pedido" } : null,
      })
    },

    interruptPhase: (convId) => {
      const run = get().byConv[convId]
      if (!run || !isActive(run.status)) return
      if (run.phases[run.current]?.status !== "running") return
      markInterrupt(run.id) // a INTENÇÃO entra ANTES do cancel (fail-closed)
      void cancelAgent(phaseRunId(run.id, run.current))    },

    releaseHold: (convId) => {
      const run = get().byConv[convId]
      if (!run) return
      // sem loop esperando, é só um PEDIDO (a fase não terminou): reversível.
      if (!isWaitingRelease(run.id)) {
        if (run.hold?.reason === "pedido") patchConv(convId, { hold: null })
        return
      }
      releaseWaiter(run.id, true)
    },

    abortRecovery: (convId) => {
      const run = get().byConv[convId]
      if (!run?.recovery) return
      recoveryWaiters.get(run.id)?.(null)
    },
  }
})
