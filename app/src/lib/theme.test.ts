import { describe, expect, it } from "vitest"
import { preferenciaPersistida, resolveTheme, temaNativo } from "./theme"

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

describe("tema da janela nativa", () => {
  it("Sistema devolve a aparência ao macOS em vez de fixar a cor resolvida", () => {
    // No macOS o setTheme do Tauri vale para o app inteiro: fixar a cor
    // resolvida travava o prefers-color-scheme e o Sistema parava de seguir.
    expect(temaNativo("system")).toBeNull()
  })
  it("escolha explícita fixa a aparência", () => {
    expect(temaNativo("light")).toBe("light")
    expect(temaNativo("dark")).toBe("dark")
  })
})

describe("preferência lida antes do React (bandeja e painel do navegador)", () => {
  it("Sistema salvo continua Sistema", () => {
    expect(preferenciaPersistida({ state: { themePreference: "system", theme: "light" } })).toBe("system")
  })
  it("estado antigo, só com a cor, vira escolha explícita", () => {
    expect(preferenciaPersistida({ state: { theme: "light" } })).toBe("light")
  })
  it("sem nada salvo, escuro", () => {
    expect(preferenciaPersistida(null)).toBe("dark")
  })
})
