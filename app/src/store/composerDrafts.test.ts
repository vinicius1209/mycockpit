import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Attachment } from "@/lib/attachments"

vi.mock("@/lib/db/conversationDrafts", () => ({
  loadComposerDraft: vi.fn(async () => null),
  saveComposerDraft: vi.fn(async () => {}),
  deleteComposerDraft: vi.fn(async () => {}),
}))

import {
  deleteComposerDraft,
  loadComposerDraft,
  saveComposerDraft,
} from "@/lib/db/conversationDrafts"
import { hasComposerDraft, useComposerDrafts } from "@/store/composerDrafts"

const imagem: Attachment = {
  path: "attachments/c1/print.png",
  name: "print.png",
  kind: "image",
  mime: "image/png",
  bytes: 42,
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  useComposerDrafts.setState({ byConv: {}, loaded: {} })
})

describe("rascunho persistido por conversa", () => {
  it("mantém texto e anexo na conversa de origem ao alternar", async () => {
    const store = useComposerDrafts.getState()
    store.setText("c1", "const resposta = 42")
    store.setAttachments("c1", [imagem])
    store.setText("c2", "outra tarefa")

    expect(useComposerDrafts.getState().byConv.c1).toEqual({
      text: "const resposta = 42",
      attachments: [imagem],
    })
    expect(useComposerDrafts.getState().byConv.c2.text).toBe("outra tarefa")

    await vi.advanceTimersByTimeAsync(400)
    expect(saveComposerDraft).toHaveBeenCalledWith("c1", {
      text: "const resposta = 42",
      attachments: [imagem],
    })
  })

  it("hidrata do banco sem sobrescrever digitação concorrente", async () => {
    vi.mocked(loadComposerDraft).mockResolvedValueOnce({
      text: "do disco",
      attachments: [imagem],
    })
    await useComposerDrafts.getState().load("c1")
    expect(useComposerDrafts.getState().byConv.c1.attachments).toEqual([imagem])

    let release!: (value: { text: string; attachments: Attachment[] }) => void
    vi.mocked(loadComposerDraft).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }),
    )
    const loading = useComposerDrafts.getState().load("c2")
    useComposerDrafts.getState().setText("c2", "digitado agora")
    release({ text: "velho", attachments: [] })
    await loading
    expect(useComposerDrafts.getState().byConv.c2.text).toBe("digitado agora")
  })

  it("limpar remove o estado e a linha persistida", async () => {
    useComposerDrafts.getState().setAttachments("c1", [imagem])
    useComposerDrafts.getState().clear("c1")
    expect(useComposerDrafts.getState().byConv.c1).toBeUndefined()
    expect(useComposerDrafts.getState().loaded.c1).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(deleteComposerDraft).toHaveBeenCalledWith("c1")
  })

  it("limpeza espera uma gravação em voo para o rascunho não ressuscitar", async () => {
    let release!: () => void
    vi.mocked(saveComposerDraft).mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve }),
    )
    useComposerDrafts.getState().setText("c1", "já vai enviar")
    await vi.advanceTimersByTimeAsync(400)
    useComposerDrafts.getState().clear("c1")
    expect(deleteComposerDraft).not.toHaveBeenCalled()

    release()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(deleteComposerDraft).toHaveBeenCalledWith("c1")
  })

  it("só espaço não acende o marcador; anexo sem texto acende", () => {
    expect(hasComposerDraft({ text: "  \n", attachments: [] })).toBe(false)
    expect(hasComposerDraft({ text: "", attachments: [imagem] })).toBe(true)
  })
})
