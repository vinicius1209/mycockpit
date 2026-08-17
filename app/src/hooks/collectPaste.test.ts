// COLAR IMAGEM NÃO PODE INJETAR URL NO PROMPT.
//
// O incidente real: o usuário copiou uma imagem de OUTRA conversa do app. O
// webview põe DUAS coisas no clipboard — o File (que vira anexo) e, no
// `text/plain`, o endereço `blob:tauri://localhost/<uuid>` do MESMO recurso.
// Sem filtro, esse endereço entrava no prompt; e como o título da conversa
// deriva do primeiro texto do usuário, a conversa era batizada de
// "blob:tauri://localhost/d7dd…".
//
// `pastedTextToInsert` (a régua) já tinha teste. O que não tinha era o PONTO DE
// ENTRADA: `collectPaste` é quem lê o DataTransfer de verdade, e é ele que o
// editor do composer chama. Régua certa atrás de uma entrada que não a usa é
// exatamente como o vazamento continuou vivo na Sala de Decisão.
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const { collectPaste } = await import("@/hooks/useAttachments")

/** A URL do incidente (mesma fixture de `lib/attachments.test.ts`). */
const BLOB = "blob:tauri://localhost/d7dd47e6-e540-4189-8e72-79e1c1b4f313"

function arquivo(type: string, name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type })
}

/** DataTransfer como o webview entrega: `items` com kind/getAsFile e o
 *  `text/plain` que veio junto. */
function clipboard(
  itens: { kind: string; file: File | null }[],
  texto = "",
): DataTransfer {
  return {
    items: itens.map((i) => ({ kind: i.kind, getAsFile: () => i.file })),
    getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
  } as unknown as DataTransfer
}

describe("colar imagem do próprio app", () => {
  it("o anexo entra e o endereço blob: NÃO vira texto do prompt", () => {
    const png = arquivo("image/png", "Captura de Tela 2026-08-15.png")
    const { files, text } = collectPaste(
      clipboard([{ kind: "file", file: png }], BLOB),
    )
    expect(files.map((f) => f.name)).toEqual(["Captura de Tela 2026-08-15.png"])
    expect(text).toBe("")
  })

  it("o texto REAL digitado junto da imagem sobrevive inteiro", () => {
    const png = arquivo("image/png", "print.png")
    const { text } = collectPaste(
      clipboard([{ kind: "file", file: png }], "compara com o print"),
    )
    expect(text).toBe("compara com o print")
  })

  it("file: e data: (as outras formas do mesmo endereço) também não entram", () => {
    const png = arquivo("image/png", "print.png")
    for (const ref of [
      "file:///Users/dev/Downloads/print.png",
      "data:image/png;base64,iVBORw0KGgo=",
    ]) {
      expect(collectPaste(clipboard([{ kind: "file", file: png }], ref)).text)
        .toBe("")
    }
  })
})

describe("o que é anexável, e o que não é", () => {
  it("imagem, PDF e tipo vazio entram; o resto fica de fora", () => {
    // Tipo vazio entra porque o backend faz o sniff dos bytes — o webview manda
    // "" em arquivos arrastados de alguns apps.
    const { files } = collectPaste(
      clipboard([
        { kind: "file", file: arquivo("image/png", "img.png") },
        { kind: "file", file: arquivo("application/pdf", "doc.pdf") },
        { kind: "file", file: arquivo("", "misterio") },
        { kind: "file", file: arquivo("text/html", "pagina.html") },
        { kind: "file", file: arquivo("video/mp4", "clipe.mp4") },
      ]),
    )
    expect(files.map((f) => f.name)).toEqual(["img.png", "doc.pdf", "misterio"])
  })

  it("item de texto (kind='string') não vira anexo", () => {
    const { files } = collectPaste(
      clipboard([{ kind: "string", file: null }], "só um texto"),
    )
    expect(files).toEqual([])
  })

  it("sem anexo no paste, o texto passa INTACTO — inclusive uma URL", () => {
    // Colar uma URL sozinha é escolha sua; o filtro só existe pra desfazer a
    // duplicata que o próprio webview criou.
    const { files, text } = collectPaste(clipboard([], BLOB))
    expect(files).toEqual([])
    expect(text).toBe(BLOB)
  })

  it("clipboard vazio não inventa nem arquivo nem texto", () => {
    expect(collectPaste(clipboard([]))).toEqual({ files: [], text: "" })
  })
})
