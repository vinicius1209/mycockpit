// MOTOR do modo Mission (docs/mission-mode.md §3, M1): pipeline SEQUENCIAL de
// agents heterogêneos numa conversa. Store IRMÃO do useChat, modelado no
// store/fusion.ts (set síncrono, guarda anti-duplo-start, custo acumulado).
// Feature INDEPENDENTE do SDD — nada aqui importa lib/sdd.ts.
import { create } from "zustand"
import { cancelAgent } from "@/lib/agent"
import type {
  MissionPhaseRun,
  MissionPreset,
  MissionRun,
  MissionStatus,
} from "@/lib/missionTypes"
import { buildHandoff } from "@/lib/handoff"
import { loadGitDiff } from "@/lib/git"
import { useChat, type ChatItem } from "@/store/chat"
import {
  checkBudget,
  diffToText,
  phasePrompt,
  runPhase,
  type PhaseResult,
} from "@/lib/mission"

export interface MissionState {
  /** Missão por conversa (uma por vez; guarda anti-duplo-start no launch). */
  byConv: Record<string, MissionRun>

  launch: (
    convId: string,
    preset: MissionPreset,
    task: string,
    projectPath: string,
    permission: string,
  ) => Promise<void>

  abort: (convId: string) => void

  clear: (convId: string) => void
}

/** MissionRun em execução ainda tem fase corrente rodando/na fila. */
function isActive(status: MissionStatus): boolean {
  return status === "running"
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

    launch: async (convId, preset, task, projectPath, permission) => {
      // guarda anti-duplo-start (padrão do Fusion): missão rodando → ignora.
      const existing = get().byConv[convId]
      if (existing && isActive(existing.status)) return

      // cwd: worktree da conversa se houver, senão a pasta do projeto.
      const conv = useChat.getState().byId[convId]
      const cwd = conv?.worktreePath ?? projectPath

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

      // itens da fase anterior (p/ buildHandoff) — o diff sai do worktree.
      let prevItems: ChatItem[] = []

      for (let i = 0; i < preset.phases.length; i++) {
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

        const def = preset.phases[i]

        // fase 1 = task pura; fases seguintes = handoff (tail do chat anterior)
        // + git diff acumulado do worktree (verdade primária, design §4).
        let handoffText: string | null = null
        let diffText: string | null = null
        if (i > 0) {
          handoffText = buildHandoff(prevItems)
          const diff = await loadGitDiff(cwd)
          diffText = diffToText(diff)
          // reviewer recebe o DIFF; o handoff dele é o plano da fase anterior.
        }

        const prompt = phasePrompt(
          def.persona,
          task,
          handoffText,
          diffText,
          def.instructions,
        )

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
      }

      // todas as fases passaram → done, current aponta além do fim.
      patchConv(convId, { status: "done", current: preset.phases.length })
      // Persistência: OPCIONAL no M1 (fica em memória). TODO(M2): espelhar o
      // padrão saveFusionRun (lib/db) p/ a missão sobreviver ao restart.
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
