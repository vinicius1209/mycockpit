// MOTOR do modo Mission (docs/mission-mode.md §3, M1): pipeline SEQUENCIAL de
// agents heterogêneos numa conversa. Store IRMÃO do useChat, modelado no
// store/fusion.ts (set síncrono, guarda anti-duplo-start, custo acumulado).
// Feature INDEPENDENTE do SDD — nada aqui importa lib/sdd.ts.
import { create } from "zustand"
import { cancelAgent } from "@/lib/agent"
import type {
  MissionPhaseDef,
  MissionPhaseRun,
  MissionPreset,
  MissionRun,
  MissionStatus,
} from "@/lib/missionTypes"
import { buildHandoff } from "@/lib/handoff"
import { loadGitDiff } from "@/lib/git"
import { insertDelivery } from "@/lib/db"
import {
  buildLearningBlocks,
  distillLesson,
  markLessonsUsed,
} from "@/lib/learning"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import {
  checkBudget,
  phasePrompt,
  phaseText,
  reviewerApproved,
  runPhase,
  type PhaseResult,
} from "@/lib/mission"
import {
  changedFilesRef,
  formatPriorHandoffs,
  handoffFileName,
  readHandoff,
  type PriorHandoff,
} from "@/lib/missionHandoff"

export interface MissionState {
  /** Missão por conversa (uma por vez; guarda anti-duplo-start no launch). */
  byConv: Record<string, MissionRun>

  launch: (
    convId: string,
    preset: MissionPreset,
    task: string,
    projectId: string,
    projectPath: string,
    permission: string,
  ) => Promise<void>

  abort: (convId: string) => void

  clear: (convId: string) => void
}

/** Máx. de rodadas de correção quando o reviewer reprova (cada uma = executor
 *  corretivo + re-review). Limita custo/loop; o teto de US$ ainda vale por cima. */
const MAX_REVIEW_LOOPS = 2

/** MissionRun em execução ainda tem fase corrente rodando/na fila. */
function isActive(status: MissionStatus): boolean {
  return status === "running"
}

/** Cria o registro de fase (MissionPhaseRun) em estado inicial (fila). */
function queuedRun(def: MissionPhaseDef): MissionPhaseRun {
  return { def, status: "queued", attempt: 1, costUsd: 0, startedAt: null }
}

/** Acha a def do executor mais recente ANTES do índice `i` (p/ reinjetar a
 *  correção). null se não houver executor antes do reviewer. */
function lastExecutorBefore(
  phases: MissionPhaseDef[],
  i: number,
): MissionPhaseDef | null {
  for (let j = i - 1; j >= 0; j--) {
    if (phases[j].persona === "executor") return phases[j]
  }
  return null
}

/** runId estável por fase p/ cancelamento (index-based, uma missão por conv). */
function phaseRunId(missionId: string, phaseIdx: number): string {
  return `${missionId}::phase-${phaseIdx}`
}

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

  return {
    byConv: {},

    launch: async (convId, preset, task, projectId, projectPath, permission) => {
      // guarda anti-duplo-start (padrão do Fusion): missão rodando → ignora.
      const existing = get().byConv[convId]
      if (existing && isActive(existing.status)) return

      // cwd: worktree da conversa se houver, senão a pasta do projeto.
      const conv = useChat.getState().byId[convId]
      const cwd = conv?.worktreePath ?? projectPath

      // Modelo helper (Haiku) p/ destilar lições (M2). Config por projeto vence o
      // default global; null = destilação desligada (mesma regra das sugestões).
      const appState = useApp.getState()
      const projCfg = appState.mycockpit[projectId]
      const helperModel = projCfg
        ? projCfg.helper
        : appState.settings.helperModel

      const missionId = crypto.randomUUID()
      const run: MissionRun = {
        id: missionId,
        convId,
        presetName: preset.name,
        task,
        phases: preset.phases.map((def) => ({
          def,
          status: "queued",
          attempt: 1,
          costUsd: 0,
          startedAt: null,
        })),
        current: 0,
        costTotal: 0,
        maxCostUsd: preset.maxCostUsd,
        status: "running",
        startedAt: Date.now(),
      }
      set((s) => ({ byConv: { ...s.byConv, [convId]: run } }))

      // itens da fase anterior (p/ fallback do handoff) — o diff sai do worktree.
      let prevItems: ChatItem[] = []
      // lista MUTÁVEL: o loop de correção do M2 acrescenta fases (executor
      // corretivo + re-review) quando o reviewer reprova, até MAX_REVIEW_LOOPS.
      const phases: MissionPhaseDef[] = [...preset.phases]
      let reviewLoops = 0
      // M2: feedbacks de reprovação do reviewer que dispararam correção. Só
      // destilamos lição se a missão terminar "done" (a correção foi REAL e
      // resolvida — evento de alto sinal reprovado→corrigido→aprovado).
      const corrections: string[] = []
      // M1: matéria-prima da entrega (gravada no fim, se "done"). O plano vem do
      // 1º planner; agent/model do 1º executor (quem de fato mexeu no código).
      let plannerSummary = ""
      let execAgent = ""
      let execModel: string | null = null
      let i = 0

      while (i < phases.length) {
        // abortada por fora (byConv sumiu ou marcada aborted) → para o loop.
        const now = get().byConv[convId]
        if (!now || now.status !== "running") return

        // budget HARD antes de gastar na próxima fase (risco nº1 do design).
        const budget = checkBudget(now.costTotal, now.maxCostUsd)
        if (!budget.ok) {
          patchConv(convId, { status: "error", current: i })
          patchPhase(convId, i, (ph) => ({
            ...ph,
            status: "error",
            error: budget.reason,
          }))
          return
        }

        const def = phases[i]
        const handoffPath = handoffFileName(i, def.persona)

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
            const pdef = phases[j]
            const doc = await readHandoff(cwd, handoffFileName(j, pdef.persona))
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

        const prompt = phasePrompt({
          persona: def.persona,
          task,
          handoffPath,
          priorHandoffs,
          changedFiles,
          fallbackContext,
          instructions: def.instructions,
          recallBlock: learn.recall,
          lessonsBlock: learn.lessons,
        })

        patchConv(convId, { current: i })
        patchPhase(convId, i, (ph) => ({
          ...ph,
          status: "running",
          startedAt: Date.now(),
        }))

        const result: PhaseResult = await runPhase({
          runId: phaseRunId(missionId, i),
          convId,
          agent: def.agent,
          model: def.model,
          effort: def.effort,
          prompt,
          cwd,
          permission,
          maxRetries: def.maxRetries,
          onProgress: (attempt, items) =>
            patchPhase(convId, i, (ph) => ({ ...ph, attempt, items } as MissionPhaseRun)),
        })

        // abortada DURANTE a fase (o run saiu por cancel) → não sobrescreve.
        const after = get().byConv[convId]
        if (!after || after.status !== "running") return

        patchConv(convId, (cur) => ({ costTotal: cur.costTotal + result.costUsd }))
        patchPhase(convId, i, (ph) => ({
          ...ph,
          status: result.ok ? "done" : "error",
          costUsd: result.costUsd,
          error: result.error,
        }))

        if (!result.ok) {
          patchConv(convId, { status: "error", current: i })
          return
        }

        prevItems = result.items

        // M1: captura o plano (1º planner) e o executor (1º executor) p/ a
        // entrega. `phaseText` já filtra só o texto (sem tool calls).
        if (def.persona === "planner" && !plannerSummary) {
          plannerSummary = phaseText(result.items)
        }
        if (def.persona === "executor" && !execAgent) {
          execAgent = def.agent
          execModel = def.model
        }

        // M2 — loop de correção: reviewer terminou mas NÃO aprovou → reinjeta as
        // correções num executor corretivo + re-review, até MAX_REVIEW_LOOPS
        // (e sempre sob o teto de custo, checado no topo do while).
        if (
          def.persona === "reviewer" &&
          reviewLoops < MAX_REVIEW_LOOPS &&
          !reviewerApproved(result.items)
        ) {
          const execDef = lastExecutorBefore(phases, i)
          if (execDef) {
            reviewLoops++
            const round = reviewLoops
            const feedback = phaseText(result.items)
            corrections.push(feedback)
            const corrective: MissionPhaseDef = {
              ...execDef,
              id: `fix-${round}-${missionId.slice(0, 6)}`,
              label: `Corrigir (rodada ${round})`,
              instructions:
                "O reviewer NÃO aprovou. Corrija exatamente estes pontos e nada " +
                `além do necessário:\n\n${feedback}`,
            }
            const rereview: MissionPhaseDef = {
              ...def,
              id: `rereview-${round}-${missionId.slice(0, 6)}`,
              label: `Revisar (rodada ${round})`,
            }
            phases.push(corrective, rereview)
            patchConv(convId, (cur) => ({
              phases: [
                ...cur.phases,
                queuedRun(corrective),
                queuedRun(rereview),
              ],
            }))
          }
        }

        i++
      }

      // todas as fases passaram → done, current aponta além do fim.
      const finalCost = get().byConv[convId]?.costTotal ?? 0
      patchConv(convId, { status: "done", current: phases.length })

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
          for (let j = 0; j < phases.length; j++) {
            const doc = await readHandoff(cwd, handoffFileName(j, phases[j].persona))
            for (const f of doc?.files_touched ?? []) seen.add(f)
          }
          files = [...seen]
        }
        await insertDelivery({
          projectId,
          task,
          planSummary: plannerSummary,
          filesTouched: files,
          costUsd: finalCost,
          agent: execAgent,
          model: execModel,
        })
      } catch {
        // entrega não gravada não invalida a missão — só perde o recall futuro.
      }

      // ── M2: destila UMA lição das correções REAIS que foram resolvidas ──
      // Estágio 1 do funil: distillLesson grava como CANDIDATE (não injeta até
      // ser promovida na auditoria) — sinal do loop é mais fraco que o save
      // explícito do Linear.
      if (corrections.length && helperModel) {
        void distillLesson({
          projectId,
          cwd,
          helperModel,
          reviewerFeedback: corrections.join("\n\n---\n\n"),
        })
      }
    },

    // Stop de verdade: cancela o run da fase corrente via cancel_agent e marca
    // aborted; fases feitas ficam no estado (nada se perde — está no worktree).
    abort: (convId) => {
      const run = get().byConv[convId]
      if (!run || !isActive(run.status)) return
      const idx = run.current
      if (idx >= 0 && idx < run.phases.length) {
        void cancelAgent(phaseRunId(run.id, idx))
      }
      patchConv(convId, (cur) => ({
        status: "aborted",
        phases: cur.phases.map((ph, i) =>
          i === idx && ph.status === "running" ? { ...ph, status: "aborted" } : ph,
        ),
      }))
    },

    clear: (convId) =>
      set((s) => {
        const rest = { ...s.byConv }
        delete rest[convId]
        return { byConv: rest }
      }),
  }
})
