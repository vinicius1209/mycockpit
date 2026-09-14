import { describe, expect, it } from "vitest"
import { resolveTheme } from "./theme"

describe("preferência de tema", () => {
  it("Sistema acompanha as duas aparências do sistema", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
  })
  it("escolha explícita prevalece sobre o sistema", () => {
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
  })
})
