import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat } from "@/store/chat"
import {
  enqueueFront,
  forceSendDraft,
  forceSendQueued,
  promoteQueued,
  pullQueued,
} from "@/components/chat/filaComposer"
import type { Attachment } from "@/lib/attachments"

vi.mock("sonner", () => ({
  toast: vi.fn(),
}))

const CONV = "conv-teste-fila"

const anexoFake: Attachment = {
  path: "attachments/conv-teste-fila/foto.png",
  name: "foto.png",
  kind: "image",
  mime: "image/png",
  bytes: 1234,
}

beforeEach(() => {
  vi.clearAllMocks()
  useChat.setState({
    byId: {
      [CONV]: {
        id: CONV,
        title: "Conversa teste",
        agent: "claude-code",
        reqModel: null,
        sessionMode: null,
        items: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "idle",
        running: true,
        queued: [
          { text: "mensagem 1", attachments: [] },
          { text: "mensagem 2", attachments: [anexoFake] },
          { text: "mensagem 3", attachments: [] },
        ],
      } as any,
    },
  })
})

describe("pullQueued: extrai item sem apagar blobs", () => {
  it("remove o item especificado da fila e devolve seus dados", () => {
    const item = pullQueued(CONV, 1)
    expect(item).not.toBeNull()
    expect(item?.text).toBe("mensagem 2")
    expect(item?.attachments).toHaveLength(1)

    const remaining = useChat.getState().byId[CONV]?.queued
    expect(remaining).toHaveLength(2)
    expect(remaining?.[0].text).toBe("mensagem 1")
    expect(remaining?.[1].text).toBe("mensagem 3")
  })

  it("retorna null para índice inválido e mantém a fila intacta", () => {
    const item = pullQueued(CONV, 99)
    expect(item).toBeNull()
    expect(useChat.getState().byId[CONV]?.queued).toHaveLength(3)
  })
})

describe("promoteQueued: move para a frente da fila", () => {
  it("promove o item do índice 2 para o índice 0", () => {
    promoteQueued(CONV, 2)
    const queued = useChat.getState().byId[CONV]?.queued
    expect(queued?.[0].text).toBe("mensagem 3")
    expect(queued?.[1].text).toBe("mensagem 1")
    expect(queued?.[2].text).toBe("mensagem 2")
  })

  it("não faz nada se o item já está no índice 0 ou índice inválido", () => {
    promoteQueued(CONV, 0)
    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("mensagem 1")

    promoteQueued(CONV, -1)
    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("mensagem 1")
  })
})

describe("enqueueFront: insere no topo da fila", () => {
  it("adiciona novo item no início de queued", () => {
    enqueueFront(CONV, "mensagem urgente", [anexoFake])
    const queued = useChat.getState().byId[CONV]?.queued
    expect(queued).toHaveLength(4)
    expect(queued?.[0].text).toBe("mensagem urgente")
    expect(queued?.[0].attachments).toHaveLength(1)
  })
})

describe("forceSendQueued: envio forçado de item da fila", () => {
  it("promove o item se necessário e aciona onStop", () => {
    const onStop = vi.fn()
    forceSendQueued(CONV, 1, onStop)

    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("mensagem 2")
    expect(onStop).toHaveBeenCalled()
  })
})

describe("forceSendDraft: envio forçado direto do composer", () => {
  it("enfileira na frente, limpa o draft e aciona onStop", () => {
    const onStop = vi.fn()
    const clearDraft = vi.fn()

    forceSendDraft(CONV, "para tudo agora!", [], clearDraft, onStop)

    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("para tudo agora!")
    expect(clearDraft).toHaveBeenCalled()
    expect(onStop).toHaveBeenCalled()
  })

  it("não faz nada se o texto for vazio e sem anexos", () => {
    const onStop = vi.fn()
    const clearDraft = vi.fn()

    forceSendDraft(CONV, "   ", [], clearDraft, onStop)

    expect(clearDraft).not.toHaveBeenCalled()
    expect(onStop).not.toHaveBeenCalled()
  })
})
