import { describe, expect, it } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import { buildAdviceItem } from "@/lib/advisor"

const T0 = 1_700_000_000_000 // epoch fixo p/ carimbo determinístico

function base(items: ChatItem[] = []): ItemReducible {
  return {
    items,
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

/** Último item de um Partial<ItemReducible> devolvido pelo reduce. */
function lastItem(out: Partial<ItemReducible>): ChatItem {
  const list = out.items!
  return list[list.length - 1]
}

describe("ts carimbado na CRIAÇÃO do item (reduceItems, now injetável)", () => {
  it("carimba o texto completo do assistente", () => {
    const out = reduceItems(
      base(),
      { type: "text", text: "resposta inteira" } as AgentEvent,
      undefined,
      T0,
    )
    expect(lastItem(out)).toMatchObject({ kind: "text", ts: T0 })
  })

  it("carimba a bolha de streaming no 1º delta (nascimento), não a cada delta", () => {
    const first = reduceItems(
      base(),
      { type: "text_delta", text: "oi" } as AgentEvent,
      undefined,
      T0,
    )
    const born = lastItem(first)
    expect(born).toMatchObject({ kind: "text", ts: T0 })
    // 2º delta acumula no MESMO item (não cria outro) e preserva o ts original
    const grown = reduceItems(
      { ...base(first.items), streamingTextId: first.streamingTextId ?? null },
      { type: "text_delta", text: " mundo" } as AgentEvent,
      undefined,
      T0 + 5000,
    )
    expect(grown.items).toHaveLength(1)
    expect(lastItem(grown)).toMatchObject({ text: "oi mundo", ts: T0 })
  })

  it("carimba tool, result, limit, notice, error e cancelled", () => {
    expect(
      lastItem(
        reduceItems(
          base(),
          { type: "tool", name: "Bash", input: {}, id: "x" } as AgentEvent,
          undefined,
          T0,
        ),
      ),
    ).toMatchObject({ kind: "tool", ts: T0 })

    expect(
      lastItem(
        reduceItems(
          base(),
          {
            type: "result",
            ok: true,
            input_tokens: 1,
            output_tokens: 1,
            cache_read: 0,
            cache_creation: 0,
          } as AgentEvent,
          undefined,
          T0,
        ),
      ),
    ).toMatchObject({ kind: "result", ts: T0 })

    expect(
      lastItem(
        reduceItems(
          base(),
          { type: "limit_reached", message: "cota" } as AgentEvent,
          undefined,
          T0,
        ),
      ),
    ).toMatchObject({ kind: "limit", ts: T0 })

    expect(
      lastItem(
        reduceItems(
          base(),
          { type: "notice", message: "anexo expirou" } as AgentEvent,
          undefined,
          T0,
        ),
      ),
    ).toMatchObject({ kind: "notice", ts: T0 })

    expect(
      lastItem(
        reduceItems(
          base(),
          { type: "error", message: "falhou" } as AgentEvent,
          undefined,
          T0,
        ),
      ),
    ).toMatchObject({ kind: "error", ts: T0 })

    expect(
      lastItem(
        reduceItems(base(), { type: "cancelled" } as AgentEvent, undefined, T0),
      ),
    ).toMatchObject({ kind: "cancelled", ts: T0 })
  })
})

describe("buildAdviceItem carimba o parecer no nascimento", () => {
  it("carimba ts (now injetável)", () => {
    const item = buildAdviceItem(
      { id: "aline", name: "Aline", version: 2, digest: "abc123" },
      "tem risco?",
      "sim, corrige X",
      T0,
    )
    expect(item).toMatchObject({ kind: "advice", ts: T0 })
  })
})
