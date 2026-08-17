// O MESMO VAZAMENTO, NA OUTRA SUPERFÍCIE — e ele estava aberto.
//
// A Sala de Decisão (GateAnswerForm) copiou o pipeline de anexos do composer mas
// não a régua do TEXTO: lia `e.clipboardData.getData("text/plain")` cru e
// grudava no rascunho. Colar uma imagem do próprio app punha
// `blob:tauri://localhost/<uuid>` dentro da RESPOSTA que vai pro agent decidir a
// próxima fase da missão — o mesmo defeito que o `pastedTextToInsert` fechou no
// composer, vivo aqui porque a régua estava do outro lado de uma função que esta
// tela não chamava.
//
// Corrigido com `gatePaste`, entrada única (espelho do `collectPaste`). Estes
// casos existem pra que o conserto não valha de novo só na metade das telas.
import { describe, expect, it } from "vitest"
import { draftAppendText, gatePaste, initGateDrafts } from "./gateAnswerDraft"

/** A URL do incidente real (mesma fixture de `lib/attachments.test.ts`). */
const BLOB = "blob:tauri://localhost/d7dd47e6-e540-4189-8e72-79e1c1b4f313"

function arquivo(type: string, name: string): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type })
}

function clipboard(files: (File | null)[], texto = "") {
  return {
    items: files.map((f) => ({
      kind: f ? "file" : "string",
      getAsFile: () => f,
    })),
    getData: (tipo: string) => (tipo === "text/plain" ? texto : ""),
  }
}

describe("colar imagem numa resposta do gate", () => {
  it("anexa a imagem e NÃO escreve o endereço blob: na resposta", () => {
    const { files, text } = gatePaste(
      clipboard([arquivo("image/png", "erro.png")], BLOB),
    )
    expect(files.map((f) => f.name)).toEqual(["erro.png"])
    expect(text).toBe("")
  })

  it("a resposta continua vazia depois do paste só-imagem", () => {
    // O efeito de ponta: o que o agent vai LER como decisão do humano.
    const { files, text } = gatePaste(
      clipboard([arquivo("image/png", "erro.png")], BLOB),
    )
    const drafts = text
      ? draftAppendText(initGateDrafts(2), 0, text)
      : initGateDrafts(2)
    expect(drafts[0].text).toBe("")
    expect(files).toHaveLength(1)
  })

  it("o texto real escrito junto da imagem entra inteiro", () => {
    const { text } = gatePaste(
      clipboard([arquivo("image/png", "erro.png")], "usa o Postgres, olha o print"),
    )
    expect(draftAppendText(initGateDrafts(1), 0, text)[0].text).toBe(
      "usa o Postgres, olha o print",
    )
  })

  it("sem anexo, o texto passa como veio (paste de texto é paste de texto)", () => {
    const { files, text } = gatePaste(clipboard([], "usa o Postgres"))
    expect(files).toEqual([])
    expect(text).toBe("usa o Postgres")
  })

  it("filtra o que o motor não anexa, com a mesma régua do composer", () => {
    const { files } = gatePaste(
      clipboard([
        arquivo("image/png", "img.png"),
        arquivo("application/pdf", "doc.pdf"),
        arquivo("", "misterio"),
        arquivo("video/mp4", "clipe.mp4"),
      ]),
    )
    expect(files.map((f) => f.name)).toEqual(["img.png", "doc.pdf", "misterio"])
  })
})
