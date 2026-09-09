import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { AgentProbe } from "@/lib/detect"

const stores = vi.hoisted(() => {
  const probe: AgentProbe = {
    installed: true,
    version: "1.0.0",
    auth: "ok",
    detail: null,
    latest: null,
    checkedAt: 1_786_543_200_000,
  }
  return {
    app: {
      limitedAgents: { codex: "em 4h" },
      settings: {
        detected: {
          "claude-code": probe,
          agy: probe,
          opencode: probe,
        },
      },
    },
    // `lastSuccessAt` é a contraprova de leitura velha de cota: o harness
    // espelha o store inteiro, senão o componente lê `undefined` e explode.
    usage: { byAgent: {}, lastSuccessAt: {} },
    chat: {
      byId: {},
      cancelAutoResume: vi.fn(),
      setAutoResume: vi.fn(),
      stageAgent: vi.fn(),
      clearBlockedDir: vi.fn(),
    },
  }
})

vi.mock("@/store/app", () => ({
  useApp: Object.assign(
    (selector: (state: typeof stores.app) => unknown) => selector(stores.app),
    { getState: () => stores.app },
  ),
}))
vi.mock("@/store/usage", () => ({
  useUsage: (selector: (state: typeof stores.usage) => unknown) =>
    selector(stores.usage),
}))
vi.mock("@/store/chat", () => ({
  executorItems: (
    items: Array<{ kind: string; advisorTo?: unknown }>,
  ) => items.filter((item) => item.kind !== "advice" && !item.advisorTo),
  useChat: { getState: () => stores.chat },
}))

import { BannersDoComposer } from "@/components/chat/BannersDoComposer"
import type { ConvState } from "@/store/chat"

describe("pilha de avisos do composer", () => {
  it("une retomada automática e escolha de outro agente numa só faixa", () => {
    const conv = {
      agent: "codex",
      items: [
        { id: "user", kind: "user", text: "Continue" },
        { id: "limit", kind: "limit", message: "Limite atingido" },
      ],
      autoResume: {
        nextAt: Date.parse("2026-09-09T14:30:00-03:00"),
        tries: 2,
        maxTries: 5,
        reason: "limit",
        timer: 1,
      },
    } as unknown as ConvState

    const html = renderToStaticMarkup(
      <BannersDoComposer
        conv={conv}
        activeId="conv-1"
        temProjeto
        busy={false}
        motorAusente={null}
        onContinueNow={() => {}}
        onReenviar={() => {}}
        onLiberarPasta={() => {}}
        onLigarNavegador={() => {}}
        onRevisarMcp={() => {}}
      />,
    )

    expect(html.match(/data-continuity-state=/g)).toHaveLength(1)
    expect(html).toContain("Codex parou antes de terminar")
    expect(html).toContain("Retomada no Codex às")
    expect(html).not.toContain("Retoma às")
  })
})
