// Dona ÚNICA da sonda de modos.
//
// Mesma doutrina de store/editors e store/worktrees: um lugar pergunta à
// máquina, todas as superfícies leem a store. Aqui isso pesa mais que nos
// outros dois — a sonda spawna o `--help` de cada motor, e um probe por
// componente seria N processos pro mesmo fato.
//
// UMA vez por sessão, não por render nem por timer: o motor não troca de modos
// enquanto o app está aberto. Quem atualizar a CLI no meio reabre o app — que é
// o gesto que a atualização já pede de qualquer forma.

import { create } from "zustand"
import { detectModes, type DetectedModes } from "@/lib/agentModes"
import { isTauri } from "@/lib/db"

interface AgentModesState {
  /** Por agent. Ausente = ainda não perguntou; `known: false` = perguntou e
   *  não deu — que NÃO é o mesmo que "não tem modo". */
  byAgent: Record<string, DetectedModes>
  ensure: (agents: readonly string[]) => void
}

export const useAgentModes = create<AgentModesState>((set, get) => ({
  byAgent: {},

  ensure: (agents) => {
    if (!isTauri()) return // browser/dev: não há binário pra perguntar
    for (const agent of agents) {
      if (get().byAgent[agent]) continue
      // Marca ANTES do await: sem isto, duas superfícies montando no mesmo
      // frame spawnam dois `--help` do mesmo motor.
      set((s) => ({
        byAgent: { ...s.byAgent, [agent]: { agent, ids: [], known: false } },
      }))
      void detectModes(agent)
        .then((m) => set((s) => ({ byAgent: { ...s.byAgent, [agent]: m } })))
        .catch(() => {}) // fica `known: false`, que é a resposta honesta
    }
  },
}))
