// Store dos AGENT PRESETS (Sprint 3 · E2): espelho em memória da tabela
// agent_presets (lib/db) pro composer (seletor de persona) e pras Settings
// (CRUD) lerem a MESMA lista sem re-query. Fonte de verdade é o SQLite; toda
// mutação passa pelo CRUD do db.ts (que versiona + recomputa digest) e o
// store só reflete o retorno.

import { create } from "zustand"
import {
  createPreset as dbCreatePreset,
  deletePreset as dbDeletePreset,
  isTauri,
  listPresets as dbListPresets,
  updatePreset as dbUpdatePreset,
  type AgentPreset,
  type AgentPresetInput,
} from "@/lib/db"

interface PresetsState {
  list: AgentPreset[]
  loaded: boolean
  /** Carrega/recarrega a lista do banco (no-op fora do Tauri). */
  load: () => Promise<void>
  create: (p: AgentPresetInput) => Promise<AgentPreset | null>
  update: (
    id: string,
    patch: Partial<AgentPresetInput>,
  ) => Promise<AgentPreset | null>
  remove: (id: string) => Promise<void>
}

function byName(a: AgentPreset, b: AgentPreset): number {
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
}

export const usePresets = create<PresetsState>((set, get) => ({
  list: [],
  loaded: false,

  load: async () => {
    if (!isTauri()) {
      set({ loaded: true })
      return
    }
    try {
      const list = await dbListPresets()
      set({ list, loaded: true })
    } catch (e) {
      console.warn("[presets] falha ao carregar do banco:", e)
      set({ loaded: true })
    }
  },

  create: async (p) => {
    const created = await dbCreatePreset(p)
    if (created) set({ list: [...get().list, created].sort(byName) })
    return created
  },

  update: async (id, patch) => {
    const updated = await dbUpdatePreset(id, patch)
    if (updated) {
      set({
        list: get()
          .list.map((x) => (x.id === id ? updated : x))
          .sort(byName),
      })
    }
    return updated
  },

  remove: async (id) => {
    await dbDeletePreset(id)
    set({ list: get().list.filter((x) => x.id !== id) })
  },
}))
