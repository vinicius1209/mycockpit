import { describe, expect, it } from "vitest"
import { navega } from "./modalidade"

describe("navega", () => {
  it("as teclas que MOVEM o foco contam", () => {
    for (const k of ["Tab", "ArrowDown", "Enter", "Escape", " "]) {
      expect(navega(k), k).toBe(true)
    }
  })

  it("DIGITAR não é navegar", () => {
    // O erro sutil que isto evita: escrever no composer trocaria a modalidade
    // pra teclado, e o próximo clique de mouse acenderia o anel — o defeito
    // voltaria por uma porta diferente.
    for (const k of ["a", "Z", "7", ",", "ç"]) {
      expect(navega(k), k).toBe(false)
    }
  })

  it("modificador sozinho não navega", () => {
    for (const k of ["Shift", "Meta", "Control", "Alt"]) {
      expect(navega(k), k).toBe(false)
    }
  })
})
