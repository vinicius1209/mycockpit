// Título da conversa (deriveTitle): sai do 1º texto do USUÁRIO. O incidente:
// colar uma imagem de outra conversa trazia junto a URL `blob:` do recurso, ela
// entrava no prompt e batizava a conversa de "blob:tauri://localhost/d7dd…" na
// sidebar. O paste já barra a URL (lib/attachments), e aqui fica o cinto: nome
// de conversa é texto escrito, não endereço de blob — e mensagem só com anexo
// ganha um nome honesto em vez de linha em branco.
import { describe, expect, it } from "vitest"
import { deriveTitle, type TitleScanItem } from "./convTitle"
import type { Attachment } from "@/lib/attachments"

const BLOB = "blob:tauri://localhost/d7dd47e6-e540-4189-8e72-79e1c1b4f313"

function imagem(): Attachment {
  return {
    path: "attachments/c1/a1.png",
    name: "colado",
    kind: "image",
    mime: "image/png",
    bytes: 1024,
  }
}

function user(text: string, attachments?: Attachment[]): TitleScanItem {
  return { kind: "user", text, attachments }
}

describe("deriveTitle", () => {
  it("usa o 1º texto do usuário, normalizado", () => {
    expect(deriveTitle([user("  arruma   o   watchdog\n")])).toBe(
      "arruma o watchdog",
    )
  })

  it("trunca em 44 caracteres com reticência", () => {
    const t = deriveTitle([user("a".repeat(60))])
    expect(t).toBe(`${"a".repeat(44)}…`)
  })

  it("NÃO batiza a conversa com a URL crua do recurso colado", () => {
    expect(deriveTitle([user(BLOB, [imagem()])])).toBe("Imagem")
  })

  it("mensagem só com anexo ganha nome do anexo, não linha em branco", () => {
    expect(deriveTitle([user("", [imagem()])])).toBe("Imagem")
    expect(deriveTitle([user("   ", [imagem(), imagem()])])).toBe("2 anexos")
  })

  it("sem texto e sem anexo não inventa nome (a lista mostra 'Nova conversa')", () => {
    expect(deriveTitle([user("")])).toBe(null)
    expect(deriveTitle([user(BLOB)])).toBe(null)
  })

  it("texto real junto da URL continua sendo o título", () => {
    expect(deriveTitle([user(`olha esse erro ${BLOB}`, [imagem()])])).toBe(
      `olha esse erro ${BLOB}`.slice(0, 44) + "…",
    )
  })

  it("fio sem fala do usuário não tem título", () => {
    expect(deriveTitle([{ kind: "notice" }])).toBe(null)
  })
})
