import { describe, it, expect } from "vitest"
import type { Attachment } from "@/lib/attachments"
import {
  attachmentsTitle,
  isResourceRefOnly,
  pastedTextToInsert,
} from "@/lib/attachments"

// A URL do incidente real: o usuário copiou uma imagem de OUTRA conversa do
// app; o webview mandou o File + este endereço no text/plain.
const BLOB = "blob:tauri://localhost/d7dd47e6-e540-4189-8e72-79e1c1b4f313"

function att(kind: Attachment["kind"]): Attachment {
  return { path: `attachments/c1/x.${kind}`, name: "x", kind, mime: "", bytes: 1 }
}

describe("pastedTextToInsert", () => {
  it("descarta a URL blob: quando o mesmo paste já virou anexo", () => {
    expect(pastedTextToInsert(BLOB, 1)).toBe("")
  })

  it("descarta também file: e data: (as outras formas do mesmo endereço)", () => {
    expect(pastedTextToInsert("file:///Users/vm/foto.png", 1)).toBe("")
    expect(pastedTextToInsert("data:image/png;base64,AAAA", 1)).toBe("")
  })

  it("descarta várias referências separadas por espaço ou quebra de linha", () => {
    expect(pastedTextToInsert(`${BLOB}\n${BLOB}2`, 2)).toBe("")
    expect(pastedTextToInsert(`  ${BLOB}  `, 1)).toBe("")
  })

  it("preserva INTACTO o texto real que veio junto do anexo", () => {
    const texto = `olha esse erro ${BLOB} aqui`
    expect(pastedTextToInsert(texto, 1)).toBe(texto)
    expect(pastedTextToInsert("compara com o print", 1)).toBe(
      "compara com o print",
    )
  })

  it("sem anexo no paste, a URL colada sozinha é escolha do usuário e entra", () => {
    expect(pastedTextToInsert(BLOB, 0)).toBe(BLOB)
    expect(pastedTextToInsert("https://exemplo.com", 0)).toBe(
      "https://exemplo.com",
    )
  })

  it("URL http colada com imagem NÃO é referência do recurso anexado, entra", () => {
    expect(pastedTextToInsert("https://exemplo.com/foto.png", 1)).toBe(
      "https://exemplo.com/foto.png",
    )
  })

  it("texto vazio segue vazio (nada a inserir), com ou sem anexo", () => {
    expect(pastedTextToInsert("", 1)).toBe("")
    expect(pastedTextToInsert("", 0)).toBe("")
  })
})

describe("isResourceRefOnly", () => {
  it("texto vazio não é referência (é o caso 'sem texto', de outro dono)", () => {
    expect(isResourceRefOnly("   ")).toBe(false)
  })

  it("reconhece a referência mesmo com espaços em volta", () => {
    expect(isResourceRefOnly(`\n${BLOB}\n`)).toBe(true)
  })

  it("uma palavra qualquer não é referência", () => {
    expect(isResourceRefOnly("blob")).toBe(false)
  })
})

describe("attachmentsTitle", () => {
  it("sem anexo não inventa nome", () => {
    expect(attachmentsTitle([])).toBe(null)
  })

  it("um anexo vira o nome do tipo", () => {
    expect(attachmentsTitle([att("image")])).toBe("Imagem")
    expect(attachmentsTitle([att("pdf")])).toBe("PDF")
    expect(attachmentsTitle([att("other")])).toBe("Anexo")
  })

  it("mais de um vira a contagem", () => {
    expect(attachmentsTitle([att("image"), att("pdf")])).toBe("2 anexos")
  })
})
