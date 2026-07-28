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
  dedupeByScope,
  readAllAgentDefs,
  saveAgentDef,
  slugify,
  type AgentDef,
  type PresetScope,
} from "@/lib/agentDefs"
import { isTauri, listPresets, type AgentPresetInput } from "@/lib/db"

interface PresetsState {
  /** O que a UI mostra: deduplicado, projeto vence global no mesmo slug. */
  list: AgentDef[]
  /** TODAS as personas em disco, inclusive as SOMBREADAS pela dedup. Só serve
   *  pra alocar slug: sem isto, criar uma global com o nome de uma global já
   *  escondida por uma do projeto sobrescreveria o arquivo escondido. */
  todas: AgentDef[]
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

/** Lê o disco tolerando falha: a UI não pode ficar sem a lista porque uma
 *  leitura engasgou (quem PRECISA distinguir erro de ausência é o
 *  resolveFirstTurnPersona, que usa o getAgentDef, esse sim lança). */
async function lerTodas(projectPath: string | null): Promise<AgentDef[]> {
  try {
    return await readAllAgentDefs(projectPath)
  } catch (e) {
    console.warn("[personas] falha ao listar", e)
    return []
  }
}

export const usePresets = create<PresetsState>((set, get) => ({
  list: [],
  todas: [],
  loaded: false,
  projectPath: null,

  load: async (projectPath) => {
    if (!isTauri()) {
      set({ loaded: true, projectPath })
      return
    }
    let todas = await lerTodas(projectPath)
    if (await migrarLegado(todas)) todas = await lerTodas(projectPath)
    set({ todas, list: dedupeByScope(todas), loaded: true, projectPath })
  },

  create: async (p, scope) => {
    const { todas, projectPath } = get()
    if (scope === "projeto" && !projectPath) {
      toast.error("Abra um projeto para criar uma persona só dele.")
      return null
    }
    try {
      const criada = await saveAgentDef({
        projectPath,
        scope,
        slug: slugLivre(slugify(p.name), scope, todas),
        input: p,
        version: 1,
      })
      const proximas = [...todas, criada]
      set({ todas: proximas, list: dedupeByScope(proximas) })
      return criada
    } catch (e) {
      console.error("[personas] falha ao criar", e)
      toast.error("Não consegui gravar a persona.")
      return null
    }
  },

  update: async (id, patch) => {
    const { todas, projectPath } = get()
    const cur = todas.find((d) => d.id === id)
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
      const proximas = todas.map((d) => (d.id === id ? nova : d))
      set({ todas: proximas, list: dedupeByScope(proximas) })
      return nova
    } catch (e) {
      console.error("[personas] falha ao salvar", e)
      toast.error("Não consegui gravar a persona.")
      return null
    }
  },

  remove: async (id) => {
    const { todas, projectPath } = get()
    const cur = todas.find((d) => d.id === id)
    if (!cur) return
    try {
      await deleteAgentDef(projectPath, cur.scope, cur.slug)
      const proximas = todas.filter((d) => d.id !== id)
      set({ todas: proximas, list: dedupeByScope(proximas) })
    } catch (e) {
      console.error("[personas] falha ao apagar", e)
      toast.error("Não consegui apagar a persona.")
    }
  },
}))
