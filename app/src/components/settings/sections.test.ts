import { describe, expect, it } from "vitest"
import {
  DEFAULT_SECTION,
  LEGACY_SECTION_IDS,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  resolveSection,
  sectionDef,
  sectionsByGroup,
} from "./sections"

describe("resolveSection", () => {
  it("devolve o próprio id quando a seção existe", () => {
    expect(resolveSection("dictation")).toBe("dictation")
    expect(resolveSection("ledger")).toBe("ledger")
  })

  it("traduz o id legado 'tools' para a seção que ficou com as CLIs", () => {
    expect(resolveSection("tools")).toBe("machine")
  })

  it("traduz o id legado 'agents' (padrões de nova conversa) para 'new-chats'", () => {
    expect(resolveSection("agents")).toBe("new-chats")
  })

  it("id desconhecido cai na seção default, nunca em tela branca", () => {
    expect(resolveSection("secao-que-nunca-existiu")).toBe(DEFAULT_SECTION)
  })

  it("valor ausente ou de outro tipo também cai no default", () => {
    expect(resolveSection(null)).toBe(DEFAULT_SECTION)
    expect(resolveSection(undefined)).toBe(DEFAULT_SECTION)
    expect(resolveSection(42)).toBe(DEFAULT_SECTION)
    expect(resolveSection({ id: "ledger" })).toBe(DEFAULT_SECTION)
  })

  it("seção escondida por falta de capability não vira destino", () => {
    // build sem motor com hooks: "hooks" some do rail, e quem pedir "hooks"
    // cai na primeira seção disponível em vez de abrir um painel vazio.
    const disponiveis = SETTINGS_SECTIONS.filter((s) => s.id !== "hooks").map(
      (s) => s.id,
    )
    expect(resolveSection("hooks", disponiveis)).toBe(disponiveis[0])
    expect(resolveSection("ledger", disponiveis)).toBe("ledger")
  })

  it("id legado resolve dentro da lista disponível", () => {
    expect(resolveSection("tools", ["machine", "ledger"])).toBe("machine")
    // destino do legado indisponível → primeira disponível, nunca em branco.
    expect(resolveSection("tools", ["ledger", "about"])).toBe("ledger")
  })

  it("todo apelido legado aponta para uma seção que existe hoje", () => {
    const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id))
    for (const [legado, alvo] of Object.entries(LEGACY_SECTION_IDS)) {
      expect(ids.has(alvo), `${legado} → ${alvo}`).toBe(true)
    }
  })

  it("nenhum apelido legado colide com um id vivo", () => {
    const ids = new Set<string>(SETTINGS_SECTIONS.map((s) => s.id))
    for (const legado of Object.keys(LEGACY_SECTION_IDS)) {
      expect(ids.has(legado), `${legado} ainda é um id vivo`).toBe(false)
    }
  })
})

describe("registro das seções", () => {
  it("não tem id duplicado", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("toda seção declara um grupo existente", () => {
    const grupos = new Set(SETTINGS_GROUPS.map((g) => g.id))
    for (const s of SETTINGS_SECTIONS) {
      expect(grupos.has(s.group), `${s.id} → ${s.group}`).toBe(true)
    }
  })

  it("sectionDef devolve os metadados da seção pedida", () => {
    expect(sectionDef("machine").title).toBe("Agentes na máquina")
    expect(sectionDef("ledger").question).toContain("janela do plano")
  })

  it("nenhuma pergunta de seção usa travessão (copy da casa)", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(s.question ?? "", s.id).not.toContain("—")
      expect(s.label, s.id).not.toContain("—")
    }
  })
})

describe("sectionsByGroup", () => {
  it("preserva a ordem do rail e não perde nenhuma seção", () => {
    const achatado = sectionsByGroup().flatMap((entry) =>
      entry.sections.map((s) => s.id),
    )
    expect(achatado).toEqual(SETTINGS_SECTIONS.map((s) => s.id))
  })

  it("mantém os grupos na ordem declarada", () => {
    expect(sectionsByGroup().map((entry) => entry.group.id)).toEqual([
      "interface",
      "conversas",
      "agentes",
      "capacidades",
      "extensoes",
      "conexoes",
      "app",
    ])
  })

  it("grupo sem nenhuma seção não vira rótulo órfão no rail", () => {
    // Todos os grupos declarados hoje têm seção; a garantia é a do filtro:
    // nenhum grupo entra na lista com zero seções.
    for (const entry of sectionsByGroup()) {
      expect(entry.sections.length).toBeGreaterThan(0)
    }
  })
})
