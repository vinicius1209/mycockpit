// Evidência visual (browser-plan B1): loader de bytes → object URL com cache
// e degradação honesta quando o arquivo saiu do disco (rejeita → o chamador
// mostra o placeholder; a falha NÃO envenena o cache).
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  files: new Map<string, number[]>(),
  reads: [] as string[],
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "read_evidence") {
      const path = args.path as string
      h.reads.push(path)
      const bytes = h.files.get(path)
      if (!bytes) throw new Error("caminho de evidência inválido")
      return bytes
    }
    if (cmd === "open_conv_image") return null
    throw new Error(`invoke não mapeado: ${cmd}`)
  }),
}))

import {
  EVIDENCE_MISSING,
  evidenceMime,
  evidenceName,
  evidenceUrl,
} from "@/lib/evidence"

beforeEach(() => {
  h.files.clear()
  h.reads.length = 0
})

describe("evidenceMime", () => {
  it("deriva o MIME da extensão da allowlist do backend", () => {
    expect(evidenceMime("evidence/c1/t-0.png")).toBe("image/png")
    expect(evidenceMime("evidence/c1/t-0.jpg")).toBe("image/jpeg")
    expect(evidenceMime("evidence/c1/t-0.webp")).toBe("image/webp")
    expect(evidenceMime("evidence/c1/t-0.gif")).toBe("image/gif")
  })
})

describe("evidenceName", () => {
  it("nome curto pro alt/título, sem o caminho inteiro", () => {
    expect(evidenceName("evidence/c1/toolu_01-0.png")).toBe("toolu_01-0.png")
  })
})

describe("evidenceUrl", () => {
  it("lê os bytes uma vez e cacheia o object URL por path", async () => {
    h.files.set("evidence/c1/a-0.png", [1, 2, 3])
    const u1 = await evidenceUrl("evidence/c1/a-0.png")
    const u2 = await evidenceUrl("evidence/c1/a-0.png")
    expect(u1).toBe(u2)
    expect(h.reads).toHaveLength(1)
  })

  it("arquivo removido do disco rejeita (placeholder no chamador) e a falha não envenena o cache", async () => {
    await expect(evidenceUrl("evidence/c1/sumiu-0.png")).rejects.toThrow()
    // arquivo "volta" (ex. restore de backup) → nova tentativa funciona
    h.files.set("evidence/c1/sumiu-0.png", [9, 9])
    await expect(evidenceUrl("evidence/c1/sumiu-0.png")).resolves.toBeTruthy()
  })

  it("a copy do placeholder é honesta e em pt-BR", () => {
    expect(EVIDENCE_MISSING).toBe("evidência removida")
  })
})
