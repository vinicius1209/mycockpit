import { describe, expect, it } from "vitest"
import {
  activePointerPath,
  handoffFileName,
  missionDir,
  missionSlug,
  runStatePath,
  slugifyTask,
} from "@/lib/missionPaths"

describe("slugifyTask", () => {
  it("normaliza acento, caixa e não-alfanumérico", () => {
    expect(slugifyTask("Auditoria & Screenshots (Frota)")).toBe(
      "auditoria-screenshots-frota",
    )
    expect(slugifyTask("refatorar o CLI do agy")).toBe("refatorar-o-cli-do-agy")
  })

  it("apara traços das pontas e limita o tamanho", () => {
    expect(slugifyTask("  ---olá---  ")).toBe("ola")
    const long = "a".repeat(80)
    expect(slugifyTask(long).length).toBeLessThanOrEqual(40)
  })

  it("string só de símbolos vira vazia (o slug ainda tem data+id)", () => {
    expect(slugifyTask("!!! @@@ ###")).toBe("")
  })
})

describe("missionSlug", () => {
  const NOW = Date.UTC(2026, 6, 24, 15, 30) // 2026-07-24

  it("compõe data + id curto + tarefa, único por missão", () => {
    const s = missionSlug("Auditoria", "abc123de-f456-7890-aaaa-bbbbbbbbbbbb", NOW)
    expect(s).toBe("2026-07-24-abc123-auditoria")
  })

  it("dois ids diferentes com a MESMA tarefa/dia não colidem", () => {
    const a = missionSlug("mesma tarefa", "11111111-0000", NOW)
    const b = missionSlug("mesma tarefa", "22222222-0000", NOW)
    expect(a).not.toBe(b)
    expect(a.startsWith("2026-07-24-111111-")).toBe(true)
    expect(b.startsWith("2026-07-24-222222-")).toBe(true)
  })

  it("tarefa vazia ainda produz slug válido (data+id)", () => {
    expect(missionSlug("", "deadbeef-0000", NOW)).toBe("2026-07-24-deadbe")
  })
})

describe("caminhos derivados", () => {
  it("isolam a missão sob .frota/missions/<slug>/", () => {
    const dir = missionDir("2026-07-24-abc123-tarefa")
    expect(dir).toBe(".frota/missions/2026-07-24-abc123-tarefa")
    expect(handoffFileName(dir, 2, "reviewer")).toBe(
      ".frota/missions/2026-07-24-abc123-tarefa/2-reviewer.json",
    )
    expect(runStatePath(dir)).toBe(
      ".frota/missions/2026-07-24-abc123-tarefa/run-state.json",
    )
  })

  it("o ponteiro da conversa vive na raiz de missions/", () => {
    expect(activePointerPath("conv-9")).toBe(
      ".frota/missions/active-conv-9.json",
    )
  })
})
