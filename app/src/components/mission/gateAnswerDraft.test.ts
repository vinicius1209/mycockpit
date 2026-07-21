// Testes da lógica PURA da Sala de Decisão (GateAnswerForm): rascunho por
// pergunta, anexos (colar/limites) e o submit rico GateAnswer[]. Sem DOM.
// Roda com: bunx vitest run src/components/mission/gateAnswerDraft.test.ts
import { describe, expect, it, vi } from "vitest"
import type { Attachment } from "@/lib/attachments"
import { MAX_ATTACH_BYTES, MAX_ATTACH_COUNT } from "@/lib/attachments"
import {
  answeredCount,
  attachableFile,
  clipboardAttachables,
  draftAddAttachments,
  draftAppendText,
  draftRemoveAttachment,
  draftSetText,
  draftsToAnswers,
  initGateDrafts,
  saveFilesAsAttachments,
} from "./gateAnswerDraft"

function att(name: string, kind: Attachment["kind"] = "image"): Attachment {
  return { path: `attachments/c1/${name}`, name, kind, mime: "image/png", bytes: 10 }
}

describe("rascunho do gate (initGateDrafts/draft*)", () => {
  it("monta um rascunho vazio por pergunta", () => {
    const drafts = initGateDrafts(3)
    expect(drafts).toHaveLength(3)
    for (const d of drafts) {
      expect(d.text).toBe("")
      expect(d.attachments).toEqual([])
    }
  })

  it("edita texto e anexos de forma imutável e por índice", () => {
    const d0 = initGateDrafts(2)
    const d1 = draftSetText(d0, 1, "usar Postgres")
    expect(d0[1].text).toBe("") // imutável
    expect(d1[1].text).toBe("usar Postgres")
    expect(d1[0].text).toBe("")

    const d2 = draftAddAttachments(d1, 0, [att("print.png")])
    expect(d2[0].attachments).toHaveLength(1)
    expect(d2[1].attachments).toHaveLength(0)

    const d3 = draftRemoveAttachment(d2, 0, att("print.png").path)
    expect(d3[0].attachments).toHaveLength(0)
  })

  it("draftAppendText junta com espaço único e ignora vazio", () => {
    let d = initGateDrafts(1)
    d = draftAppendText(d, 0, "primeira ")
    d = draftAppendText(d, 0, " segunda")
    d = draftAppendText(d, 0, "   ")
    expect(d[0].text).toBe("primeira segunda")
  })

  it("submete GateAnswer[] rico: texto aparado + anexos por resposta", () => {
    let d = initGateDrafts(2)
    d = draftSetText(d, 0, "  responder assim  ")
    d = draftAddAttachments(d, 1, [att("spec.pdf", "pdf"), att("tela.png")])
    const answers = draftsToAnswers(d)
    expect(answers).toEqual([
      { text: "responder assim", attachments: [] },
      {
        text: "",
        attachments: [att("spec.pdf", "pdf"), att("tela.png")],
      },
    ])
  })

  it("answeredCount conta texto OU anexo como resposta", () => {
    let d = initGateDrafts(3)
    expect(answeredCount(d)).toBe(0)
    d = draftSetText(d, 0, "sim")
    d = draftAddAttachments(d, 2, [att("a.png")])
    expect(answeredCount(d)).toBe(2)
  })
})

describe("colar/anexar (clipboardAttachables/saveFilesAsAttachments)", () => {
  it("filtra do clipboard só arquivos anexáveis (imagem/PDF/sem tipo)", () => {
    const file = (type: string, name = "f") =>
      new File([new Uint8Array([1])], name, { type })
    const items = [
      { kind: "file", getAsFile: () => file("image/png", "img.png") },
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => file("application/pdf", "doc.pdf") },
      { kind: "file", getAsFile: () => file("text/html", "page.html") },
      { kind: "file", getAsFile: () => file("", "misterio") },
    ]
    const files = clipboardAttachables(items)
    expect(files.map((f) => f.name)).toEqual(["img.png", "doc.pdf", "misterio"])
    expect(attachableFile({ type: "video/mp4" })).toBe(false)
  })

  it("colar adiciona chip: salva cada File como Attachment na resposta", async () => {
    const save = vi.fn(
      async (convId: string, name: string, mime: string): Promise<Attachment> => ({
        path: `attachments/${convId}/${name}`,
        name,
        kind: "image",
        mime,
        bytes: 1,
      }),
    )
    const files = [
      new File([new Uint8Array([1])], "colado.png", { type: "image/png" }),
    ]
    const saved = await saveFilesAsAttachments("c1", files, 0, save, () => {})
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe("colado.png")
    // …e o chip entra no rascunho da pergunta certa
    const drafts = draftAddAttachments(initGateDrafts(2), 0, saved)
    expect(drafts[0].attachments.map((a) => a.name)).toEqual(["colado.png"])
  })

  it("respeita limites: arquivo grande é pulado, teto de 8 por resposta", async () => {
    const save = vi.fn(
      async (_convId: string, name: string): Promise<Attachment> => att(name),
    )
    const errors: string[] = []
    const big = new File([new Uint8Array(1)], "grande.png", { type: "image/png" })
    Object.defineProperty(big, "size", { value: MAX_ATTACH_BYTES + 1 })
    const ok = new File([new Uint8Array(1)], "ok.png", { type: "image/png" })
    const saved = await saveFilesAsAttachments(
      "c1",
      [big, ok],
      MAX_ATTACH_COUNT - 1, // resta 1 vaga
      save,
      (m) => errors.push(m),
    )
    expect(saved.map((a) => a.name)).toEqual(["ok.png"])
    expect(errors.some((e) => e.includes("excede"))).toBe(true)

    const none = await saveFilesAsAttachments(
      "c1",
      [ok],
      MAX_ATTACH_COUNT, // cheio
      save,
      (m) => errors.push(m),
    )
    expect(none).toEqual([])
    expect(errors.some((e) => e.includes("máx."))).toBe(true)
  })

  it("falha de UM arquivo vira onError e não derruba os demais", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce("mime não permitido")
      .mockResolvedValueOnce(att("b.png"))
    const errors: string[] = []
    const f = (n: string) =>
      new File([new Uint8Array([1])], n, { type: "image/png" })
    const saved = await saveFilesAsAttachments(
      "c1",
      [f("a.png"), f("b.png")],
      0,
      save,
      (m) => errors.push(m),
    )
    expect(saved.map((a) => a.name)).toEqual(["b.png"])
    expect(errors).toEqual(["mime não permitido"])
  })
})
