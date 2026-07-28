// Store das PERSONAS (antigos agent_presets): espelho em memória dos arquivos
// `.mycockpit/agents/*.md` pro composer (seletor) e pras Settings (CRUD).
//
// A fonte de verdade mudou de lugar: era a tabela agent_presets do SQLite,
// agora é o ARQUIVO (lib/agentDefs) — versionável, revisável em PR e com escopo
// por projeto, que o banco global não tinha. O SQLite fica só como origem da
// MIGRAÇÃO das personas antigas, uma vez por sessão.

import { create } from "zustand"
import { toast } from "sonner"
import {
  deleteAgentDef,
  listAgentDefs,
  saveAgentDef,
  slugify,
  type AgentDef,
  type PresetScope,
} from "@/lib/agentDefs"
import { isTauri, listPresets, type AgentPresetInput } from "@/lib/db"

interface PresetsState {
  list: AgentDef[]
  loaded: boolean
  /** Projeto cujas personas estão carregadas (null = só as globais). */
  projectPath: string | null
  load: (projectPath: string | null) => Promise<void>
  create: (
    p: AgentPresetInput,
    scope: PresetScope,
  ) => Promise<AgentDef | null>
  update: (
    id: string,
    patch: Partial<AgentPresetInput>,
  ) => Promise<AgentDef | null>
  remove: (id: string) => Promise<void>
}

/** Slug livre naquele escopo: "revisor", "revisor-2", "revisor-3"… Evita que
 *  duas personas de mesmo nome se sobrescrevam em silêncio. */
function slugLivre(base: string, scope: PresetScope, list: AgentDef[]): string {
  const usados = new Set(
    list.filter((d) => d.scope === scope).map((d) => d.slug),
  )
  if (!usados.has(base)) return base
  for (let i = 2; ; i++) {
    const t = `${base}-${i}`
    if (!usados.has(t)) return t
  }
}

/** Migração única por sessão: personas que só existiam no SQLite viram arquivo
 *  GLOBAL (era o escopo delas — a tabela não tinha projeto), preservando o id
 *  UUID no frontmatter pra que conversas já carimbadas continuem resolvendo.
 *  Best-effort: falhar aqui não pode impedir o app de listar o que já é arquivo. */
let migrou = false
async function migrarLegado(existentes: AgentDef[]): Promise<boolean> {
  if (migrou || !isTauri()) return false
  migrou = true
  try {
    const antigos = await listPresets()
    if (antigos.length === 0) return false
    const jaTem = new Set(existentes.map((d) => d.id))
    let n = 0
    for (const p of antigos) {
      if (jaTem.has(p.id)) continue
      await saveAgentDef({
        projectPath: null,
        scope: "global",
        slug: slugLivre(slugify(p.name), "global", existentes),
        input: {
          name: p.name,
          personalityMd: p.personalityMd,
          skills: p.skills,
          policy: p.policy,
          backend: p.backend,
          model: p.model,
          effort: p.effort,
        },
        version: p.version,
        id: p.id, // preserva o carimbo das conversas antigas
      })
      n++
    }
    if (n > 0) {
      toast(
        `${n} ${n === 1 ? "persona migrada" : "personas migradas"} para ~/.mycockpit/agents (agora são arquivos).`,
      )
    }
    return n > 0
  } catch (e) {
    console.warn("[personas] migração do banco falhou", e)
    return false
  }
}

export const usePresets = create<PresetsState>((set, get) => ({
  list: [],
  loaded: false,
  projectPath: null,

  load: async (projectPath) => {
    if (!isTauri()) {
      set({ loaded: true, projectPath })
      return
    }
    let list = await listAgentDefs(projectPath)
    if (await migrarLegado(list)) list = await listAgentDefs(projectPath)
    set({ list, loaded: true, projectPath })
  },

  create: async (p, scope) => {
    const { list, projectPath } = get()
    if (scope === "projeto" && !projectPath) {
      toast.error("Abra um projeto para criar uma persona só dele.")
      return null
    }
    try {
      const criada = await saveAgentDef({
        projectPath,
        scope,
        slug: slugLivre(slugify(p.name), scope, list),
        input: p,
        version: 1,
      })
      set({ list: [...list, criada] })
      return criada
    } catch (e) {
      console.error("[personas] falha ao criar", e)
      toast.error("Não consegui gravar a persona.")
      return null
    }
  },

  update: async (id, patch) => {
    const { list, projectPath } = get()
    const cur = list.find((d) => d.id === id)
    if (!cur) return null
    try {
      // version + 1 e digest recomputado (saveAgentDef faz o digest): conversas
      // antigas guardam o digest anterior e o drift do S3.4 detecta a mudança.
      const nova = await saveAgentDef({
        projectPath,
        scope: cur.scope,
        slug: cur.slug, // renomear a persona muda o `name`, não o arquivo
        input: {
          name: patch.name ?? cur.name,
          personalityMd: patch.personalityMd ?? cur.personalityMd,
          skills: patch.skills ?? cur.skills,
          policy: patch.policy !== undefined ? patch.policy : cur.policy,
          backend: patch.backend ?? cur.backend,
          model: patch.model !== undefined ? patch.model : cur.model,
          effort: patch.effort !== undefined ? patch.effort : cur.effort,
        },
        version: cur.version + 1,
        // id legado (UUID) tem que sobreviver à edição, senão a conversa
        // carimbada passaria a achar que a persona foi apagada.
        id: cur.id.includes(":") ? undefined : cur.id,
      })
      set({ list: list.map((d) => (d.id === id ? nova : d)) })
      return nova
    } catch (e) {
      console.error("[personas] falha ao salvar", e)
      toast.error("Não consegui gravar a persona.")
      return null
    }
  },

  remove: async (id) => {
    const { list, projectPath } = get()
    const cur = list.find((d) => d.id === id)
    if (!cur) return
    try {
      await deleteAgentDef(projectPath, cur.scope, cur.slug)
      set({ list: list.filter((d) => d.id !== id) })
    } catch (e) {
      console.error("[personas] falha ao apagar", e)
      toast.error("Não consegui apagar a persona.")
    }
  },
}))
