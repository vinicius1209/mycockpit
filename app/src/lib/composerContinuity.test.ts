import { describe, expect, it } from "vitest"

import { deriveComposerContinuity } from "@/lib/composerContinuity"
import type { ChatItem } from "@/store/chat"

function itemsWithTerminal(terminal: ChatItem): ChatItem[] {
  return [
    { id: "u1", kind: "user", text: "Termine a implementação" },
    terminal,
  ]
}

describe("continuidade do composer", () => {
  it("prioriza a retomada imediata quando o último turno falhou", () => {
    const continuity = deriveComposerContinuity(
      itemsWithTerminal({
        id: "limit-1",
        kind: "limit",
        message: "Limite atingido",
      }),
      false,
      true,
    )

    expect(continuity).toEqual({
      mode: "continue-now",
      terminalId: "limit-1",
      pending: {
        index: 0,
        text: "Termine a implementação",
        attachments: [],
      },
    })
  })

  it("só prepara o próximo envio depois de um turno concluído", () => {
    const continuity = deriveComposerContinuity(
      itemsWithTerminal({ id: "result-1", kind: "result", ok: true }),
      false,
      true,
    )

    expect(continuity).toEqual({
      mode: "next-send",
      terminalId: "result-1",
      pending: null,
    })
  })

  it("não oferece gesto durante trabalho em voo ou sem evidência terminal", () => {
    expect(
      deriveComposerContinuity(
        itemsWithTerminal({ id: "result-1", kind: "result", ok: true }),
        true,
        true,
      ),
    ).toBeNull()
    expect(
      deriveComposerContinuity(
        [{ id: "u1", kind: "user", text: "Continue" }],
        false,
        true,
      ),
    ).toBeNull()
  })
})
