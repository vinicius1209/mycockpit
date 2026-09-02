// Migração do estado persistido (mc.app) — o risco nº 1 do corte do Escritório
// (office-removal-plan R2): um viewMode órfão persistido abriria o app num modo
// que não existe (tela branca) pra todo usuário existente. migratePersistedApp
// é pura de propósito pra travar isto aqui, sem montar o store.

import { describe, expect, it } from "vitest"

import { migratePersistedApp } from "@/store/app"

function viewModeAfter(persistedViewMode: string, fromVersion: number): string {
  const out = migratePersistedApp({ viewMode: persistedViewMode }, fromVersion) as {
    viewMode?: string
  }
  return out.viewMode ?? "(ausente)"
}

describe("migratePersistedApp — viewMode órfão nunca vira modo de boot", () => {
  it('v3→v4: "office" persistido cai no Trabalho ("linear")', () => {
    expect(viewModeAfter("office", 3)).toBe("linear")
  })

  it("v3→v4: valor órfão qualquer (lixo futuro) também cai em \"linear\"", () => {
    expect(viewModeAfter("holodeck", 3)).toBe("linear")
    expect(viewModeAfter("", 3)).toBe("linear")
  })

  it("v3→v4: modos vivos são preservados", () => {
    expect(viewModeAfter("sdd", 3)).toBe("sdd")
    expect(viewModeAfter("painel", 3)).toBe("painel")
    expect(viewModeAfter("linear", 3)).toBe("linear")
  })

  it("viewMode ausente segue ausente (o merge aplica o default do store)", () => {
    const out = migratePersistedApp({}, 3) as { viewMode?: string }
    expect(out.viewMode).toBeUndefined()
  })

  it('v2→v3 intacto: "fusion" vira "linear"', () => {
    expect(viewModeAfter("fusion", 2)).toBe("linear")
  })

  it("v<2 intacto: estado persistido marca onboarded=true (usuário existente)", () => {
    const out = migratePersistedApp({ viewMode: "office" }, 1) as unknown as {
      settings?: Record<string, unknown>
      viewMode?: string
    }
    expect(out.settings?.onboarded).toBe(true)
    // e a normalização v4 pega o office antigo no MESMO passo
    expect(out.viewMode).toBe("linear")
  })

  it("preenche userProfile e userPreferences com defaults quando ausentes", () => {
    const out = migratePersistedApp({ settings: { conversationScale: 1.2 } }, 3) as unknown as {
      settings: {
        userProfile?: { name: string }
        userPreferences?: { chatAuthorDisplay: string }
        conversationScale: number
      }
    }
    expect(out.settings.userProfile?.name).toBe("")
    expect(out.settings.userPreferences?.chatAuthorDisplay).toBe("you")
    expect(out.settings.conversationScale).toBe(1.2)
  })
})
