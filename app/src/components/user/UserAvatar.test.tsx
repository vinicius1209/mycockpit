import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { UserAvatar } from "./UserAvatar"
import type { UserProfile } from "@/lib/userProfile"

const render = (profile: UserProfile, alt?: string) =>
  renderToStaticMarkup(createElement(UserAvatar, { profile, alt }))

describe("<UserAvatar>", () => {
  it("renderiza iniciais por padrão", () => {
    const profile: UserProfile = {
      name: "Vinícius Machado",
      avatarType: "initials",
      customImageDataUri: null,
      dicebearStyle: "personas",
      dicebearSeed: "",
      dicebearColor: "#e4a862",
      initials: null,
    }
    const html = render(profile)
    expect(html).toContain("VM")
  })

  it("renderiza imagem customizada quando configurada", () => {
    const profile: UserProfile = {
      name: "Vinícius",
      avatarType: "image",
      customImageDataUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      dicebearStyle: "personas",
      dicebearSeed: "",
      dicebearColor: "#e4a862",
      initials: null,
    }
    const html = render(profile, "Minha foto")
    expect(html).toContain("<img")
    expect(html).toContain('alt="Minha foto"')
    expect(html).toContain("data:image/png")
  })

  it("não entrega URL externa ao WebView quando o estado persistido está adulterado", () => {
    const html = render({
      name: "Usuário",
      avatarType: "image",
      customImageDataUri: "https://example.com/avatar.png",
      dicebearStyle: "personas",
      dicebearSeed: "",
      dicebearColor: "#e4a862",
      initials: null,
    })
    expect(html).not.toContain("example.com")
    expect(html).not.toContain("<img")
    expect(html).toContain("US")
  })

  it("renderiza avatar DiceBear quando configurado", () => {
    const profile: UserProfile = {
      name: "Vinícius",
      avatarType: "dicebear",
      customImageDataUri: null,
      dicebearStyle: "personas",
      dicebearSeed: "teste-seed",
      dicebearColor: "#e4a862",
      initials: null,
    }
    const html = render(profile, "Meu avatar")
    expect(html).toContain("<img")
    expect(html).toContain('alt="Meu avatar"')
    expect(html).toContain("data:image/svg+xml")
  })

  it("renderiza ícone clássico quando avatarType for icon", () => {
    const profile: UserProfile = {
      name: "Vinícius",
      avatarType: "icon",
      customImageDataUri: null,
      dicebearStyle: "personas",
      dicebearSeed: "",
      dicebearColor: "#e4a862",
      initials: null,
    }
    const html = render(profile, "Ícone de usuário")
    expect(html).toContain("<svg")
  })
})
