// ESQUELETO/CONTRATO do store do Mission — a API pública abaixo é estável
// (UI e Settings codam contra ela); a implementação do orquestrador entra
// na sequência (ver docs/mission-mode.md §3). Modelado no store/fusion.ts.
import { create } from "zustand"
import type { MissionPreset, MissionRun } from "@/lib/missionTypes"

export interface MissionState {
  /** Missão por conversa (uma por vez; guarda anti-duplo-start no launch). */
  byConv: Record<string, MissionRun>

  /** Dispara uma missão na conversa: roda as fases em sequência (handoff +
   *  git diff entre fases), respeitando maxCostUsd. Ignora se já há missão
   *  rodando na conversa. */
  launch: (
    convId: string,
    preset: MissionPreset,
    task: string,
    projectPath: string,
    permission: string,
  ) => Promise<void>

  /** Aborta a missão da conversa (cancela o run corrente; fases feitas ficam). */
  abort: (convId: string) => void

  /** Remove a missão terminada do estado (fechar a timeline). */
  clear: (convId: string) => void
}

export const useMission = create<MissionState>((set, get) => ({
  byConv: {},

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  launch: async (_convId, _preset, _task, _projectPath, _permission) => {
    // implementação do orquestrador: ver docs/mission-mode.md §3 (M1)
    void set
    void get
  },

  abort: (_convId) => {},

  clear: (convId) =>
    set((s) => {
      const rest = { ...s.byConv }
      delete rest[convId]
      return { byConv: rest }
    }),
}))
