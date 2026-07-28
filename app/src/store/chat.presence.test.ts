// Especialistas E3 — presença DERIVADA (S3.1) e "passar o volante" (S3.2) no
// store do chat. Presença = piloto (preset carimbado) + convidados (personas que
// opinaram). Passar o volante = troca o piloto por gesto humano e re-arma a
// injeção da nova doutrina no próximo turno. Mocks no padrão da casa.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
vi.mock("@/lib/agent", async (io) => ({
  ...(await io<typeof import("@/lib/agent")>()),
  cancelAgent: vi.fn(async () => {}),
  suggest: vi.fn(async () => ""),
}))

import {
  useChat,
  conversationPresence,
  needsPersonaReinject,
  type ChatItem,
  type ConvState,
} from "@/store/chat"

const T0 = 1_700_000_000_000

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: T0,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

function advice(
  id: string,
  personaId: string,
  personaName: string,
): Extract<ChatItem, { kind: "advice" }> {
  return {
    kind: "advice",
    id,
    personaId,
    personaName,
    personaVersion: 1,
    digest: "deadbeef",
    question: "?",
    text: "parecer",
  }
}

const user: ChatItem = { kind: "user", id: "u1", text: "roda isso" }

beforeEach(() => {
  vi.clearAllMocks()
  useChat.setState({ byId: {} })
})

describe("conversationPresence (S3.1) — presença DERIVADA", () => {
  it("conversa crua (sem preset, sem parecer) não tem participantes", () => {
    expect(conversationPresence(conv())).toEqual({ pilotId: null, guests: [] })
  })

  it("o piloto é o preset carimbado da conversa", () => {
    const p = conversationPresence(conv({ presetId: "projeto:exec" }))
    expect(p.pilotId).toBe("projeto:exec")
    expect(p.guests).toEqual([])
  })

  it("os convidados saem dos pareceres, deduplicados por id, na ordem de entrada", () => {
    const p = conversationPresence(
      conv({
        presetId: "projeto:exec",
        items: [
          advice("a1", "projeto:aline", "Aline"),
          user,
          advice("a2", "projeto:bob", "Bob"),
          advice("a3", "projeto:aline", "Aline"), // dupe → não repete
        ],
      }),
    )
    expect(p.pilotId).toBe("projeto:exec")
    expect(p.guests).toEqual([
      { id: "projeto:aline", name: "Aline" },
      { id: "projeto:bob", name: "Bob" },
    ])
  })

  it("quem PILOTA não aparece também como convidado (um piloto por vez)", () => {
    const p = conversationPresence(
      conv({
        presetId: "projeto:aline",
        items: [advice("a1", "projeto:aline", "Aline")],
      }),
    )
    expect(p.pilotId).toBe("projeto:aline")
    expect(p.guests).toEqual([]) // Aline pilota, não é convidada de si mesma
  })
})

describe("needsPersonaReinject (S3.2) — re-injeção DERIVADA de estado persistido", () => {
  it("persona carimbada + digest zerado + turno de executor = re-injeta", () => {
    expect(
      needsPersonaReinject(
        conv({ presetId: "projeto:aline", presetDigest: null, items: [user] }),
      ),
    ).toBe(true)
  })

  it("digest presente (conversa carimbada normal) = NÃO re-injeta", () => {
    expect(
      needsPersonaReinject(
        conv({ presetId: "projeto:aline", presetDigest: "abc", items: [user] }),
      ),
    ).toBe(false)
  })

  it("digest zerado mas SEM turno de executor = NÃO re-injeta (é o turno-1 real)", () => {
    // digest null + só parecer no fio: é o 1º turno de verdade, injeta pelo
    // caminho !locked, não pelo forceReinject.
    expect(
      needsPersonaReinject(
        conv({
          presetId: "projeto:aline",
          presetDigest: null,
          items: [advice("a1", "projeto:bob", "Bob")],
        }),
      ),
    ).toBe(false)
  })

  it("sem persona carimbada = nunca re-injeta", () => {
    expect(
      needsPersonaReinject(
        conv({ presetId: null, presetDigest: null, items: [user] }),
      ),
    ).toBe(false)
  })
})

describe("passar o volante (S3.2) — troca o piloto e re-arma a injeção", () => {
  it("no meio da conversa: troca presetId, ZERA o digest (re-injeção derivada)", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          presetDigest: "old-digest",
          presetName: "Executor",
          items: [user], // já tem turno de executor
        }),
      },
    })
    const ok = await useChat.getState().passWheel("c1", "projeto:aline", "Aline")
    expect(ok).toBe(true)
    const c = useChat.getState().byId.c1
    expect(c.presetId).toBe("projeto:aline")
    expect(c.presetName).toBe("Aline")
    // digest zerado → o próximo turno re-carimba a versão ATUAL (drift honesto)
    expect(c.presetDigest).toBeNull()
    // a re-injeção é DERIVADA do estado persistido, não de flag efêmera
    expect(needsPersonaReinject(c)).toBe(true)
  })

  it("#1: sobrevive a restart — recarregar do 'banco' sem flag efêmera ainda re-injeta", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          presetDigest: "old-digest",
          items: [user],
        }),
      },
    })
    await useChat.getState().passWheel("c1", "projeto:aline", "Aline")
    const afterPass = useChat.getState().byId.c1
    // simula o reload: reconstrói o ConvState só com os campos PERSISTIDOS
    // (presetId/presetDigest/items), como o ensureLoaded faria do disco.
    const reloaded = conv({
      presetId: afterPass.presetId,
      presetDigest: afterPass.presetDigest,
      items: afterPass.items,
    })
    // a necessidade de re-injeção segue viva porque deriva do estado do banco
    expect(needsPersonaReinject(reloaded)).toBe(true)
  })

  it("no-op quando a persona JÁ pilota (retorna false, sem re-carimbo à toa)", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:aline",
          presetDigest: "stamped",
          items: [user],
        }),
      },
    })
    const ok = await useChat.getState().passWheel("c1", "projeto:aline", "Aline")
    expect(ok).toBe(false)
    expect(useChat.getState().byId.c1.presetDigest).toBe("stamped") // intacto
  })

  it("no-op com turno em voo (retorna false, espera terminar)", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          running: true,
          items: [user],
        }),
      },
    })
    const ok = await useChat.getState().passWheel("c1", "projeto:aline", "Aline")
    expect(ok).toBe(false)
    expect(useChat.getState().byId.c1.presetId).toBe("projeto:exec")
  })
})

describe("passar o volante — drift reflete a troca, não erro (S3.2)", () => {
  it("após a troca + re-carimbo, o carimbo é da NOVA persona e a re-injeção se fecha", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          presetDigest: "old-digest",
          items: [user],
        }),
      },
    })
    await useChat.getState().passWheel("c1", "projeto:aline", "Aline")
    // o próximo turno re-carimba a versão atual da nova persona (via stampPreset,
    // a mesma ação do turno-1 — sem duplicar a injeção)
    await useChat
      .getState()
      .stampPreset("c1", "projeto:aline", "aline-digest", "Aline")
    const c = useChat.getState().byId.c1
    // carimbo = nova persona @ versão atual: um drift check bate "ok", não erro
    expect(c.presetId).toBe("projeto:aline")
    expect(c.presetDigest).toBe("aline-digest")
    // re-injeção consumida: com digest de volta, não força de novo
    expect(needsPersonaReinject(c)).toBe(false)
  })
})

describe("retomar o volante (E3) — devolve a direção ao executor-base", () => {
  it("zera presetId/presetName/presetDigest (volta pro base) e retorna true", async () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:aline",
          presetDigest: "stamped",
          presetName: "Aline",
          items: [user],
        }),
      },
    })
    const ok = await useChat.getState().returnWheel("c1")
    expect(ok).toBe(true)
    const c = useChat.getState().byId.c1
    expect(c.presetId).toBeNull()
    expect(c.presetName).toBeNull()
    expect(c.presetDigest).toBeNull()
    // base não tem persona: nada a re-injetar
    expect(needsPersonaReinject(c)).toBe(false)
    // a presença deixa de ter piloto
    expect(conversationPresence(c).pilotId).toBeNull()
  })

  it("no-op quando já não há piloto (retorna false, sem escrita)", async () => {
    useChat.setState({
      byId: { c1: conv({ presetId: null, items: [user] }) },
    })
    const ok = await useChat.getState().returnWheel("c1")
    expect(ok).toBe(false)
    expect(useChat.getState().byId.c1.presetId).toBeNull()
  })

  it("no-op com turno em voo (retorna false, o piloto fica)", async () => {
    useChat.setState({
      byId: {
        c1: conv({ presetId: "projeto:aline", running: true, items: [user] }),
      },
    })
    const ok = await useChat.getState().returnWheel("c1")
    expect(ok).toBe(false)
    expect(useChat.getState().byId.c1.presetId).toBe("projeto:aline")
  })
})

describe("tirar da conversa (E3) — removeAdvice tira só a persona alvo", () => {
  it("remove TODOS os pareceres daquela persona; outros itens e outra persona ficam", () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          items: [
            advice("a1", "projeto:aline", "Aline"),
            user,
            advice("a2", "projeto:bob", "Bob"),
            advice("a3", "projeto:aline", "Aline"), // 2º parecer da Aline
          ],
        }),
      },
    })
    useChat.getState().removeAdvice("c1", "projeto:aline")
    const c = useChat.getState().byId.c1
    // os dois pareceres da Aline saíram; o user e o parecer do Bob ficaram
    expect(c.items.map((it) => it.id)).toEqual(["u1", "a2"])
  })

  it("depois de removeAdvice, conversationPresence não lista mais aquele convidado", () => {
    useChat.setState({
      byId: {
        c1: conv({
          presetId: "projeto:exec",
          items: [
            advice("a1", "projeto:aline", "Aline"),
            advice("a2", "projeto:bob", "Bob"),
          ],
        }),
      },
    })
    useChat.getState().removeAdvice("c1", "projeto:aline")
    const c = useChat.getState().byId.c1
    expect(conversationPresence(c).guests).toEqual([
      { id: "projeto:bob", name: "Bob" },
    ])
  })
})

describe("dropNativeSession (S3.2/#2) — higiene de transplante (achado #3)", () => {
  it("zera sessão, resolvido (model) e anel (contextTokens) juntos", () => {
    useChat.setState({
      byId: {
        c1: conv({
          sessionId: "sess-antiga",
          model: "claude-opus",
          contextTokens: 4200,
          items: [user],
        }),
      },
    })
    useChat.getState().dropNativeSession("c1")
    const c = useChat.getState().byId.c1
    expect(c.sessionId).toBeNull()
    expect(c.model).toBeNull()
    expect(c.contextTokens).toBeUndefined()
  })
})
