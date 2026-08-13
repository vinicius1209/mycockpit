// Identidade dos selos de leitura entre dois frames do streaming.
//
// O `MessageItem` é `memo` e recebia o mapa GLOBAL de selos — um objeto novo a
// cada token. `memo` compara raso, então TODA mensagem do fio re-renderizava a
// cada delta, exatamente o oposto do que o comentário do componente prometia.
// `attachmentReadsByItem` entrega um objeto POR ITEM e preserva a referência
// enquanto os rótulos daquele item não mudam.
import { describe, expect, it } from "vitest"
import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"
import { attachmentReadsByItem } from "./attachmentRead"

const PATH = "/attachments/c1/abc.png"
const att: Attachment = {
  path: PATH,
  name: "shot.png",
  kind: "image",
  mime: "image/png",
  bytes: 100,
}

function fio(texto: string): ChatItem[] {
  return [
    { kind: "user", id: "u1", text: "veja", attachments: [att] } as ChatItem,
    { kind: "tool", id: "i1", name: "Read", input: { file_path: PATH } } as ChatItem,
    { kind: "text", id: "t1", text: texto } as ChatItem,
  ]
}

describe("attachmentReadsByItem — referência estável por item", () => {
  it("token novo no fio não troca a referência dos selos de um item intocado", () => {
    const antes = attachmentReadsByItem(fio("oi"), "claude-code", true)
    const depois = attachmentReadsByItem(fio("oiu"), "claude-code", true, antes)
    expect(depois.get("u1")).toBe(antes.get("u1"))
  })

  it("o selo que MUDA ganha referência nova (o turno acabou sem abrir o anexo)", () => {
    const semLeitura: ChatItem[] = [
      { kind: "user", id: "u1", text: "veja", attachments: [att] } as ChatItem,
      { kind: "text", id: "t1", text: "respondi" } as ChatItem,
    ]
    const rodando = attachmentReadsByItem(semLeitura, "claude-code", true)
    const parado = attachmentReadsByItem(semLeitura, "claude-code", false, rodando)
    expect(parado.get("u1")).not.toBe(rodando.get("u1"))
    expect(rodando.get("u1")![PATH]).toBeNull() // pendente: cedo pra dizer
    expect(parado.get("u1")![PATH]).toEqual({ text: "não foi aberto", warn: true })
  })

  it("indexa por item e carrega só os anexos daquele item", () => {
    const outro: Attachment = { ...att, path: "/attachments/c1/def.pdf", kind: "pdf" }
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "a", attachments: [att] } as ChatItem,
      { kind: "tool", id: "i1", name: "Read", input: { file_path: PATH } } as ChatItem,
      { kind: "user", id: "u2", text: "b", attachments: [outro] } as ChatItem,
    ]
    const reads = attachmentReadsByItem(items, "claude-code", false)
    expect(Object.keys(reads.get("u1")!)).toEqual([PATH])
    expect(Object.keys(reads.get("u2")!)).toEqual([outro.path])
    expect(reads.get("u1")![PATH]).toEqual({ text: "lido", warn: false })
  })

  it("item sem anexo não entra no mapa (nada a dizer, nada a comparar)", () => {
    const reads = attachmentReadsByItem(fio("oi"), "claude-code", true)
    expect(reads.has("t1")).toBe(false)
    expect(reads.size).toBe(1)
  })
})
