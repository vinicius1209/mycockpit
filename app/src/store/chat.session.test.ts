// P1 da auditoria de modelos: o evento `session` valida pedido×resolvido e
// injeta UM notice no fio quando a divergência é dura — sem bloquear o run e
// sem eco a cada retomada (dedup por mensagem).
import { describe, expect, it } from "vitest"
import { reduceItems, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

function base(): ItemReducible {
  return {
    items: [],
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

function session(model: string): AgentEvent {
  return { type: "session", session_id: "s1", model } as AgentEvent
}

describe("reduceItems + session (pedido×resolvido)", () => {
  it("pin não honrado injeta notice e ainda grava o modelo REAL", () => {
    const out = reduceItems(base(), session("claude-sonnet-5"), {
      agent: "claude-code",
      reqModel: "claude-opus-4-8",
    })
    expect(out.model).toBe("claude-sonnet-5") // a verdade do CLI manda
    expect(out.items).toHaveLength(1)
    expect(out.items![0].kind).toBe("notice")
  })

  it("resolução dentro do contrato do alias NÃO gera notice", () => {
    const out = reduceItems(base(), session("claude-opus-4-7[1m]"), {
      agent: "claude-code",
      reqModel: "opus[1m]",
    })
    expect(out.model).toBe("claude-opus-4-7[1m]")
    expect(out.items).toBeUndefined()
  })

  it("mesma divergência em retomada não duplica o notice (dedup)", () => {
    const first = reduceItems(base(), session("claude-sonnet-5"), {
      agent: "claude-code",
      reqModel: "claude-opus-4-8",
    })
    const resumed: ItemReducible = { ...base(), ...first }
    const again = reduceItems(resumed, session("claude-sonnet-5"), {
      agent: "claude-code",
      reqModel: "claude-opus-4-8",
    })
    expect(again.items).toBeUndefined() // só sessionId/model, sem eco
  })

  it("sem ctx comporta como sempre (compat com chamadores antigos)", () => {
    const out = reduceItems(base(), session("claude-sonnet-5"))
    expect(out).toEqual({ sessionId: "s1", model: "claude-sonnet-5" })
  })
})
