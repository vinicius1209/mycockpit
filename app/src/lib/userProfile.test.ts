import { describe, expect, it } from "vitest"
import {
  DEFAULT_USER_PREFERENCES,
  DEFAULT_USER_PROFILE,
  DICEBEAR_USER_STYLES,
  getInitials,
  resolveDicebearUri,
  safeCustomAvatarDataUri,
} from "./userProfile"

describe("userProfile helpers", () => {
  it("extrai iniciais de nomes simples e compostos", () => {
    expect(getInitials("Vinícius")).toBe("VI")
    expect(getInitials("Vinicius Machado")).toBe("VM")
    expect(getInitials("Maria da Silva")).toBe("MS")
    expect(getInitials("Ana")).toBe("AN")
    expect(getInitials("A")).toBe("A")
    expect(getInitials("")).toBe("U")
    expect(getInitials(null)).toBe("U")
    expect(getInitials(undefined)).toBe("U")
  })

  it("aceita apenas imagens locais em Data URI como foto customizada", () => {
    expect(safeCustomAvatarDataUri("https://example.com/avatar.png")).toBeNull()
    expect(safeCustomAvatarDataUri("data:image/svg+xml,<svg />")).toBeNull()
    expect(safeCustomAvatarDataUri("data:image/png;base64,aGVsbG8=")).toBe(
      "data:image/png;base64,aGVsbG8=",
    )
  })

  it("normaliza cor inválida antes de gerar o avatar ilustrado", () => {
    const uri = resolveDicebearUri({
      ...DEFAULT_USER_PROFILE,
      dicebearColor: "url(https://example.com)",
    })
    expect(uri).toContain("data:image/svg+xml")
    expect(uri).not.toContain("example.com")
  })

  it("resolve data uri do dicebear corretamente", () => {
    const uri = resolveDicebearUri({
      ...DEFAULT_USER_PROFILE,
      name: "Vinícius",
      dicebearStyle: "personas",
    })
    expect(uri).toContain("data:image/svg+xml")
  })

  it("contém estilos de avatares conhecidos", () => {
    expect(DICEBEAR_USER_STYLES.length).toBeGreaterThanOrEqual(5)
    expect(DICEBEAR_USER_STYLES.some(([id]) => id === "personas")).toBe(true)
    expect(DICEBEAR_USER_STYLES.some(([id]) => id === "notionists")).toBe(true)
  })

  it("mantém valores padrão íntegros", () => {
    expect(DEFAULT_USER_PROFILE.name).toBe("")
    expect(DEFAULT_USER_PROFILE.avatarType).toBe("icon")
    expect(DEFAULT_USER_PREFERENCES.chatAuthorDisplay).toBe("you")
    expect(DEFAULT_USER_PREFERENCES.composerSendShortcut).toBe("enter")
  })
})
