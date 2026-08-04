// S3.1 — o rodapé precisa dizer QUAL build está rodando, inteiro. O formato
// curto existe pra caber sem truncar; o tooltip carrega a string completa.
import { describe, expect, it } from "vitest"
import { shortVersion } from "./version"

describe("shortVersion", () => {
  it("build de teste vira sufixo curto: 0.1.0-test.177 → v0.1.0-t177", () => {
    expect(shortVersion("0.1.0-test.177")).toBe("v0.1.0-t177")
  })

  it("release limpo só ganha o prefixo v", () => {
    expect(shortVersion("0.1.0")).toBe("v0.1.0")
  })

  it("sufixo desconhecido passa intacto (não inventa formato)", () => {
    expect(shortVersion("0.2.0-rc.1")).toBe("v0.2.0-rc.1")
  })
})
