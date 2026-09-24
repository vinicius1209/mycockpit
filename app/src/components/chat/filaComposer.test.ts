import { beforeEach, describe, expect, it, vi } from "vitest"
import { useChat } from "@/store/chat"
import {
  enqueueFront,
  forceSendDraft,
  forceSendQueued,
  promoteQueued,
  pullQueued,
  stopActiveConversation,
} from "@/components/chat/filaComposer"
import type { Attachment } from "@/lib/attachments"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import { toast } from "sonner"
import { limparCausasDoCorte, tomarCausaDoCorte } from "@/lib/corte"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))
vi.mock("@/lib/cancelConversationTurn", () => ({
  cancelConversationTurn: vi.fn(async () => false),
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
  limparCausasDoCorte()
  useChat.setState({
    activeId: CONV,
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

describe("stopActiveConversation", () => {
  it("cancela a conversa ativa pelo id capturado no gesto", async () => {
    await stopActiveConversation()
    expect(cancelConversationTurn).toHaveBeenCalledWith(CONV, "parada")
    // o marco no fio é o registro; toast repetiria e sumiria (ADR-180)
    expect(toast).not.toHaveBeenCalled()
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
  it("promove o item se necessário e pede o despacho no alvo explícito", () => {
    const onDispatch = vi.fn(async () => undefined)
    forceSendQueued(CONV, 1, onDispatch)

    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("mensagem 2")
    expect(onDispatch).toHaveBeenCalledWith(CONV)
  })

  it("índice inválido não interrompe nem despacha", () => {
    const onDispatch = vi.fn(async () => undefined)
    forceSendQueued(CONV, 99, onDispatch)
    expect(onDispatch).not.toHaveBeenCalled()
  })
})

describe("forceSendDraft: envio forçado direto do composer", () => {
  it("enfileira na frente, limpa o draft e pede o despacho", () => {
    const onDispatch = vi.fn(async () => undefined)
    const clearDraft = vi.fn()

    forceSendDraft(CONV, "para tudo agora!", [], clearDraft, onDispatch)

    expect(useChat.getState().byId[CONV]?.queued?.[0].text).toBe("para tudo agora!")
    expect(clearDraft).toHaveBeenCalled()
    expect(onDispatch).toHaveBeenCalledWith(CONV)
  })

  it("não faz nada se o texto for vazio e sem anexos", () => {
    const onDispatch = vi.fn(async () => undefined)
    const clearDraft = vi.fn()

    forceSendDraft(CONV, "   ", [], clearDraft, onDispatch)

    expect(clearDraft).not.toHaveBeenCalled()
    expect(onDispatch).not.toHaveBeenCalled()
  })
})

describe("envio forçado e o corte (ADR-180)", () => {
  it("com turno rodando não solta toast e carimba a causa para o marco do fio", () => {
    forceSendDraft(CONV, "na verdade, puxa as configurações de prod", [], vi.fn(), vi.fn(async () => undefined))
    expect(toast).not.toHaveBeenCalled()
    expect(tomarCausaDoCorte(CONV)).toBe("correcao")
  })

  it("sem turno rodando não há corte, e o aviso de envio continua", () => {
    useChat.setState((s) => ({
      byId: { ...s.byId, [CONV]: { ...s.byId[CONV], running: false } as any },
    }))
    forceSendQueued(CONV, 0, vi.fn(async () => undefined))
    expect(toast).toHaveBeenCalledWith("Enviando a fila…")
    expect(tomarCausaDoCorte(CONV)).toBeUndefined()
  })
})

describe("reordenar a fila", () => {
  it("leva o item para a posição pedida e mantém o resto na ordem", async () => {
    const { moverItem } = await import("./filaComposer")
    expect(moverItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
    expect(moverItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
    expect(moverItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"])
    expect(moverItem(["a", "b"], 5, 0)).toEqual(["a", "b"])
  })
})
