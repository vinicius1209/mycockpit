import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))

import type { WorkEvent } from "@/lib/work"
import { abaParaSeguir } from "./useNavegadorDoProjeto"

// Forma do evento que o gateway emite depois de cada ação (browser_gateway.rs).
const usou = (targetId: string | null, projectPath = "/Users/me/projetos/landing-prime"): WorkEvent => ({
  kind: "browser_agent_active",
  data: { runId: "r-1", convId: "c-1", projectPath, targetId },
})

describe("a vista do navegador segue a aba do agente (ADR-231)", () => {
  it("o agente foi para outra aba: a vista vai junto", () => {
    expect(abaParaSeguir(usou("B"), "/Users/me/projetos/landing-prime", "A", false)).toBe("B")
  })

  it("já na mesma aba, ou sem aba informada: nada muda", () => {
    expect(abaParaSeguir(usou("A"), "/Users/me/projetos/landing-prime", "A", false)).toBeNull()
    expect(abaParaSeguir(usou(null), "/Users/me/projetos/landing-prime", "A", false)).toBeNull()
  })

  it("com a pessoa pilotando, a aba é dela", () => {
    expect(abaParaSeguir(usou("B"), "/Users/me/projetos/landing-prime", "A", true)).toBeNull()
  })

  it("agente de outro projeto não mexe nesta vista", () => {
    expect(abaParaSeguir(usou("B", "/Users/me/projetos/sicredi"), "/Users/me/projetos/landing-prime", "A", false)).toBeNull()
  })
})

describe("a vista de uma conversa não segue o agente de outra (ADR-244)", () => {
  it("evento do agente de outra conversa é ignorado; o da própria, seguido", () => {
    const projeto = "/Users/me/projetos/landing-prime"
    expect(abaParaSeguir(usou("B"), projeto, "A", false, "c-2")).toBeNull()
    expect(abaParaSeguir(usou("B"), projeto, "A", false, "c-1")).toBe("B")
  })

  it("a janela avulsa do projeto (sem conversa) segue qualquer uma", () => {
    expect(abaParaSeguir(usou("B"), "/Users/me/projetos/landing-prime", "A", false, null)).toBe("B")
  })
})
