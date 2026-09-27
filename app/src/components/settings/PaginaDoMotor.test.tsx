// ADR-268: a página do motor diz, por capability, como cada canal da Frota
// chega. O incidente: o Agy precisava de um cadastro que o Claude não precisa,
// e nenhuma tela explicava a diferença (26/09/2026).
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { AGENTS } from "@/lib/agents"
import { PaginaDoMotor, comoOAcompanhamentoChega } from "./PaginaDoMotor"

vi.mock("@/lib/workMcpSetup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workMcpSetup")>()),
  workMcpStatus: vi.fn(async () => ({ agent: "agy", state: "absent", checkedAt: 0, detail: null })),
  browserMcpStatus: vi.fn(async () => ({ agent: "agy", state: "absent", checkedAt: 0, detail: null })),
  desktopMcpStatus: vi.fn(async () => ({ agent: "agy", state: "absent", checkedAt: 0, detail: null })),
}))

const global = AGENTS.find((a) => a.kind === "agent" && a.available && a.workMcpGlobalEnv)!
const porTurno = AGENTS.find((a) => a.kind === "agent" && a.available && a.workMcp && !a.workMcpGlobalEnv)!
const semCanal = AGENTS.find((a) => a.kind === "agent" && a.available && !a.workMcp)

describe("como o acompanhamento chega a cada motor", () => {
  it("vem da capability, nunca do nome", () => {
    expect(comoOAcompanhamentoChega({ workMcp: true, workMcpGlobalEnv: true })).toBe("cadastro")
    expect(comoOAcompanhamentoChega({ workMcp: true, workMcpGlobalEnv: false })).toBe("automatico")
    expect(comoOAcompanhamentoChega({ workMcp: false, workMcpGlobalEnv: false })).toBe("sem-caminho")
  })
})

describe("PaginaDoMotor", () => {
  it("motor de cadastro global: o acompanhamento traz o gesto de conectar", () => {
    const html = renderToStaticMarkup(<PaginaDoMotor agent={global} onAbrir={vi.fn()} />)
    expect(html).toContain("Acompanhamento")
    expect(html).toContain("a Frota se cadastra uma vez no CLI")
    expect(html).toContain("Reverificar o acompanhamento")
    expect(html).not.toContain("Automático, a cada turno")
  })

  it("motor por turno: automático, sem botão nenhum", () => {
    const html = renderToStaticMarkup(<PaginaDoMotor agent={porTurno} onAbrir={vi.fn()} />)
    expect(html).toContain("Automático, a cada turno")
    expect(html).not.toContain("Reverificar o acompanhamento")
  })

  it("motor sem o canal diz que não tem, em vez de prometer", () => {
    if (!semCanal) return
    const html = renderToStaticMarkup(<PaginaDoMotor agent={semCanal} onAbrir={vi.fn()} />)
    expect(html).toContain("Sem caminho neste motor")
  })

  it("sessões no terminal só aparecem em motor com hooks", () => {
    for (const a of AGENTS.filter((x) => x.kind === "agent" && x.available)) {
      const html = renderToStaticMarkup(<PaginaDoMotor agent={a} onAbrir={vi.fn()} />)
      expect(html.includes("Sessões no terminal"), a.id).toBe(a.hooksStatus)
    }
  })

  it("a página não fala a língua do código", () => {
    const html = renderToStaticMarkup(<PaginaDoMotor agent={global} onAbrir={vi.fn()} />)
    expect(html).not.toMatch(/binding|frota-work|provider/i)
    expect(html).not.toContain("—")
  })
})
