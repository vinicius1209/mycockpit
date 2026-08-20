// A regra de produto do "abrir no editor" (M1): qual editor, quando a máquina
// tem mais de um. Quem fala com a máquina é o Rust.

import { describe, expect, it } from "vitest"
import { pickEditor, type DetectedEditor } from "./editors"

const ed = (id: string): DetectedEditor => ({ id, label: id })

describe("pickEditor", () => {
  it("nenhum editor na máquina: não há o que abrir", () => {
    expect(pickEditor([], "vscode")).toBeNull()
  })

  it("sem preferência, o primeiro do registro", () => {
    expect(pickEditor([ed("vscode"), ed("zed")], null)?.id).toBe("vscode")
  })

  it("preferência respeitada mesmo fora da primeira posição", () => {
    expect(pickEditor([ed("vscode"), ed("zed")], "zed")?.id).toBe("zed")
  })

  it("preferência de editor DESINSTALADO cai no detectado", () => {
    // senão o botão fica prometendo um editor que não existe mais e só dá erro
    expect(pickEditor([ed("zed")], "cursor")?.id).toBe("zed")
  })
})
