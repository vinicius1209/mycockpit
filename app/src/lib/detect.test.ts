import { describe, expect, it } from "vitest"
import { updateAvailable, toProbeMap, type DetectedTool } from "@/lib/detect"

function p(version: string | null, latest: string | null) {
  return { version, latest }
}

describe("updateAvailable", () => {
  it("acusa update quando latest é maior", () => {
    expect(updateAvailable(p("2.1.209", "2.1.300"))).toBe(true)
    expect(updateAvailable(p("2.1.209", "2.2.0"))).toBe(true)
    expect(updateAvailable(p("2.1.209", "3.0.0"))).toBe(true)
  })

  it("compara por segmentos NUMÉRICOS, não lexicográfico", () => {
    // "9" < "10" numericamente (lexicográfico diria o contrário)
    expect(updateAvailable(p("2.9.0", "2.10.0"))).toBe(true)
    expect(updateAvailable(p("2.10.0", "2.9.0"))).toBe(false)
  })

  it("igual ou instalada mais nova → false", () => {
    expect(updateAvailable(p("2.1.209", "2.1.209"))).toBe(false)
    expect(updateAvailable(p("2.2.0", "2.1.209"))).toBe(false)
  })

  it("segmento ausente conta como 0", () => {
    expect(updateAvailable(p("2.1", "2.1.1"))).toBe(true)
    expect(updateAvailable(p("2.1.0", "2.1"))).toBe(false)
  })

  it("null/indisponível → false (nunca acusa sem certeza)", () => {
    expect(updateAvailable(p(null, "2.1.300"))).toBe(false)
    expect(updateAvailable(p("2.1.209", null))).toBe(false)
    expect(updateAvailable(p(null, null))).toBe(false)
  })

  it("strings sem versão comparável → false", () => {
    expect(updateAvailable(p("abc", "2.1.300"))).toBe(false)
    expect(updateAvailable(p("2.1.209", "latest"))).toBe(false)
  })

  it("tolera prefixo/sufixo em volta da versão", () => {
    expect(updateAvailable(p("v2.1.209", "v2.1.300"))).toBe(true)
    expect(updateAvailable(p("2.1.209 (Claude Code)", "2.1.300"))).toBe(true)
    expect(updateAvailable(p("codex-cli 0.48.0", "0.50.1"))).toBe(true)
  })
})

describe("toProbeMap", () => {
  it("carrega latest pro snapshot (e tolera Rust antigo sem o campo)", () => {
    const tools = [
      {
        id: "claude-code",
        installed: true,
        version: "2.1.209",
        auth: "ok",
        detail: null,
        latest: "2.1.300",
      },
      // Rust antigo (sem `latest` no payload) → null, nunca undefined
      {
        id: "codex",
        installed: true,
        version: "0.48.0",
        auth: "ok",
        detail: null,
      } as unknown,
    ] as DetectedTool[]
    const map = toProbeMap(tools, 123)
    expect(map["claude-code"].latest).toBe("2.1.300")
    expect(map["claude-code"].checkedAt).toBe(123)
    expect(map["codex"].latest).toBeNull()
  })
})
