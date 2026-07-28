// MIGRAÇÃO das personas: SQLite (agent_presets, global e invisível ao git) →
// arquivos `~/.mycockpit/agents/*.md`. O ponto delicado é o ID: conversas
// antigas carimbaram o UUID da tabela, então o arquivo migrado precisa
// PRESERVAR esse id no frontmatter — senão elas passariam a achar que a persona
// foi apagada e o usuário levaria um aviso falso de "preset apagado".

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentPreset } from "@/lib/db"

const h = vi.hoisted(() => ({
  legado: [] as AgentPreset[],
  arquivos: [] as { slug: string; scope: string; content: string }[],
  listaThrows: false,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  listPresets: vi.fn(async () => {
    if (h.listaThrows) throw new Error("banco indisponível")
    return h.legado
  }),
}))
// agentDefs com as funções PURAS reais (slugify/serialize têm testes próprios);
// só o disco é fingido, guardando o que foi gravado.
vi.mock("@/lib/agentDefs", async (orig) => {
  const real = await orig<typeof import("@/lib/agentDefs")>()
  return {
    ...real,
    readAllAgentDefs: vi.fn(async () =>
      h.arquivos.map((a) => ({
        ...real.defFieldsFrom({
          slug: a.slug,
          scope: a.scope as "projeto" | "global",
          path: `/fake/${a.slug}.md`,
          content: a.content,
          updated_at: 1,
        }),
        digest: "d",
      })),
    ),
    saveAgentDef: vi.fn(async (opts: Parameters<typeof real.saveAgentDef>[0]) => {
      const content = real.serializeAgentDef({
        ...opts.input,
        version: opts.version,
        id: opts.id,
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
    }),
    deleteAgentDef: vi.fn(async () => {}),
  }
})

import { listPresets } from "@/lib/db"
import { saveAgentDef } from "@/lib/agentDefs"
import { usePresets } from "./presets"

function legado(patch: Partial<AgentPreset> = {}): AgentPreset {
  return {
    id: "uuid-antigo",
    name: "UI Engineer",
    personalityMd: "Cuida da interface.",
    skills: ["revisar-pr"],
    policy: "nunca commita sem pedir",
    backend: "codex",
    model: "gpt-x",
    effort: "high",
    digest: "d-antigo",
    version: 4,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  h.legado = []
  h.arquivos = []
  h.listaThrows = false
  usePresets.setState({ list: [], loaded: false, projectPath: null })
  // a migração roda 1× por MÓDULO; recarrega pra cada teste começar do zero.
  vi.resetModules()
})

/** Importa uma instância FRESCA do store (com o flag de migração zerado). */
async function storeFresco() {
  const m = await import("./presets")
  return m.usePresets
}

describe("migração do SQLite para arquivo", () => {
  it("persona antiga vira arquivo GLOBAL preservando o id carimbado", async () => {
    h.legado = [legado()]
    const store = await storeFresco()
    await store.getState().load(null)

    expect(saveAgentDef).toHaveBeenCalledTimes(1)
    const gravado = h.arquivos[0]
    expect(gravado.scope).toBe("global") // era o escopo da tabela: sem projeto
    expect(gravado.slug).toBe("ui-engineer")
    expect(gravado.content).toContain("id: uuid-antigo")
    expect(gravado.content).toContain("version: 4") // não zera o histórico
    expect(gravado.content).toContain("Cuida da interface.")
  })

  it("o que JÁ virou arquivo não é migrado de novo (sem duplicar)", async () => {
    h.legado = [legado()]
    h.arquivos = [
      { slug: "ui-engineer", scope: "global", content: "---\nid: uuid-antigo\nname: UI Engineer\n---\nx" },
    ]
    const store = await storeFresco()
    await store.getState().load(null)
    expect(saveAgentDef).not.toHaveBeenCalled()
  })

  it("roda UMA vez por sessão (o 2º load não reescreve nada)", async () => {
    h.legado = [legado()]
    const store = await storeFresco()
    await store.getState().load(null)
    vi.mocked(listPresets).mockClear()
    await store.getState().load(null)
    expect(listPresets).not.toHaveBeenCalled()
  })

  it("banco indisponível não impede listar o que já é arquivo", async () => {
    // regressão do princípio: a migração é best-effort, o app não pode ficar
    // sem personas porque o SQLite legado engasgou.
    h.listaThrows = true
    h.arquivos = [
      { slug: "revisor", scope: "global", content: "---\nname: Revisor\n---\ncorpo" },
    ]
    const store = await storeFresco()
    await store.getState().load(null)
    expect(store.getState().list.map((d) => d.name)).toEqual(["Revisor"])
    expect(store.getState().loaded).toBe(true)
  })

  it("sem nada no banco, nada é gravado", async () => {
    const store = await storeFresco()
    await store.getState().load(null)
    expect(saveAgentDef).not.toHaveBeenCalled()
    expect(store.getState().list).toEqual([])
  })
})

describe("alocação de slug", () => {
  it("não sobrescreve a persona GLOBAL escondida por uma do projeto", async () => {
    // A lista da UI é deduplicada (projeto vence global no mesmo slug). Se a
    // alocação de slug olhasse só pra ela, criar uma global chamada "Revisor"
    // acharia o slug livre e gravaria por cima do ~/.mycockpit/agents/revisor.md
    // que existe e está apenas SOMBREADO. Perda silenciosa de arquivo.
    h.arquivos = [
      { slug: "revisor", scope: "global", content: "---\nname: Revisor\n---\nantigo" },
      { slug: "revisor", scope: "projeto", content: "---\nname: Revisor\n---\ndo projeto" },
    ]
    const store = await storeFresco()
    await store.getState().load("/proj")
    expect(store.getState().list).toHaveLength(1) // a UI mostra uma só
    expect(store.getState().todas).toHaveLength(2) // o disco tem duas

    await store.getState().create(
      {
        name: "Revisor",
        personalityMd: "novo",
        skills: [],
        policy: null,
        backend: "codex",
        model: null,
        effort: null,
      },
      "global",
    )
    const slug = vi.mocked(saveAgentDef).mock.calls[0][0].slug
    expect(slug).toBe("revisor-2")
  })

  it("slug repetido no MESMO escopo também ganha sufixo", async () => {
    h.arquivos = [
      { slug: "revisor", scope: "global", content: "---\nname: Revisor\n---\nx" },
      { slug: "revisor-2", scope: "global", content: "---\nname: Revisor\n---\ny" },
    ]
    const store = await storeFresco()
    await store.getState().load(null)
    await store.getState().create(
      {
        name: "Revisor",
        personalityMd: "z",
        skills: [],
        policy: null,
        backend: "codex",
        model: null,
        effort: null,
      },
      "global",
    )
    expect(vi.mocked(saveAgentDef).mock.calls[0][0].slug).toBe("revisor-3")
  })
})
