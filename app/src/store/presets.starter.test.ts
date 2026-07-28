// Equipe inicial (installStarterTeam): semeia 6 especialistas GLOBAIS no
// primeiro uso e é IDEMPOTENTE — rodar de novo não duplica nem sobrescreve o
// que já existe. Reusa o CRUD (create → saveAgentDef), então grava arquivos
// `.mycockpit/agents/*.md` normais.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentDef } from "@/lib/agentDefs"

const h = vi.hoisted(() => ({
  arquivos: [] as { slug: string; scope: string; content: string }[],
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  listPresets: vi.fn(async () => []),
}))
// funções puras reais (slugify/serialize têm testes próprios); só o disco é
// fingido, guardando o que foi gravado.
vi.mock("@/lib/agentDefs", async (orig) => {
  const real = await orig<typeof import("@/lib/agentDefs")>()
  return {
    ...real,
    readAllAgentDefs: vi.fn(async () => []),
    saveAgentDef: vi.fn(
      async (opts: Parameters<typeof real.saveAgentDef>[0]) => {
        const content = real.serializeAgentDef({
          ...opts.input,
          version: opts.version,
          id: opts.id,
          slug: opts.slug,
        })
        h.arquivos.push({ slug: opts.slug, scope: opts.scope, content })
        return {
          ...real.defFieldsFrom({
            slug: opts.slug,
            scope: opts.scope,
            path: `/fake/${opts.slug}.md`,
            content,
            updated_at: 1,
          }),
          digest: "d",
        }
      },
    ),
    deleteAgentDef: vi.fn(async () => {}),
  }
})

import { saveAgentDef } from "@/lib/agentDefs"
import { usePresets } from "./presets"
import { STARTER_TEAM } from "@/lib/marketplace"

/** AgentDef mínimo pra povoar `todas` (só o que o installStarterTeam olha). */
function jaExiste(slug: string): AgentDef {
  return { scope: "global", slug, id: `global:${slug}` } as AgentDef
}

beforeEach(() => {
  vi.clearAllMocks()
  h.arquivos = []
  usePresets.setState({ list: [], todas: [], loaded: true, projectPath: null })
})

describe("installStarterTeam", () => {
  it("cria os 6 especialistas no escopo global", async () => {
    const n = await usePresets.getState().installStarterTeam()
    expect(n).toBe(STARTER_TEAM.length)
    expect(n).toBe(6)
    expect(saveAgentDef).toHaveBeenCalledTimes(6)
    expect(h.arquivos.every((a) => a.scope === "global")).toBe(true)
    expect(h.arquivos.map((a) => a.slug).sort()).toEqual([
      "aline",
      "iris",
      "marco",
      "nero",
      "testa",
      "vault",
    ])
    // a store recarrega: o grid popula
    expect(usePresets.getState().list).toHaveLength(6)
  })

  it("é idempotente: rodar 2× não duplica nem sobrescreve", async () => {
    await usePresets.getState().installStarterTeam()
    vi.clearAllMocks()
    const n2 = await usePresets.getState().installStarterTeam()
    expect(n2).toBe(0)
    expect(saveAgentDef).not.toHaveBeenCalled()
    expect(usePresets.getState().list).toHaveLength(6)
  })

  it("pula só o slug que já existe e cria o resto (não sobrescreve o do usuário)", async () => {
    usePresets.setState({
      todas: [jaExiste("aline")],
      list: [jaExiste("aline")],
    })
    const n = await usePresets.getState().installStarterTeam()
    expect(n).toBe(5)
    // não regravou a Aline existente
    expect(h.arquivos.map((a) => a.slug)).not.toContain("aline")
    expect(saveAgentDef).toHaveBeenCalledTimes(5)
  })
})
