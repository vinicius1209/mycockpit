import { describe, expect, it } from "vitest"
import { buildNodes, resetHintFromMessage } from "./messageNodes"
import type { ChatItem } from "@/store/chat"

const LIMIT = "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)"

describe("buildNodes — incidentes terminais históricos", () => {
  it("cura result + mensagem repetida + exit code em um único limite", () => {
    const items: ChatItem[] = [
      {
        kind: "result",
        id: "r1",
        ok: false,
        text: LIMIT,
        durationMs: 121_000,
        costUsd: 35.16,
        usage: { input: 4_000, output: 2_200, cacheRead: 37_000, cacheCreation: 0 },
      },
      { kind: "error", id: "e1", message: LIMIT },
      {
        kind: "error",
        id: "e2",
        message: "o agent `claude-code` saiu com código 1",
      },
    ]

    const nodes = buildNodes(items)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: "incident",
      severity: "limit",
      resetHint: "1:50pm (America/Sao_Paulo)",
      result: { id: "r1", costUsd: 35.16 },
    })
    if (nodes[0].type !== "incident") throw new Error("esperava incidente")
    // A duplicata exata some; a consequência ainda fica auditável no disclosure.
    expect(nodes[0].details).toEqual([
      LIMIT,
      "o agent `claude-code` saiu com código 1",
    ])
  })

  it("anexa um limit estruturado ao result telemétrico sem texto", () => {
    const nodes = buildNodes([
      { kind: "result", id: "r1", ok: false, costUsd: 2.5 },
      {
        kind: "limit",
        id: "l1",
        message: LIMIT,
        resetHint: "1:50pm (America/Sao_Paulo)",
      },
      {
        kind: "error",
        id: "e1",
        message: "o agent `claude-code` saiu com código 1",
      },
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({
      type: "incident",
      severity: "limit",
      result: { id: "r1", costUsd: 2.5 },
    })
  })

  it("não esconde falhas adjacentes com causas diferentes", () => {
    const nodes = buildNodes([
      { kind: "result", id: "r1", ok: false, text: "Falha ao compilar" },
      { kind: "error", id: "e1", message: "Banco de dados indisponível" },
    ])
    expect(nodes).toHaveLength(2)
    expect(nodes.map((node) => node.type)).toEqual(["incident", "incident"])
    expect(
      nodes.map((node) =>
        node.type === "incident" ? node.message : "",
      ),
    ).toEqual(["Falha ao compilar", "Banco de dados indisponível"])
  })

  it("mantém falha comum vermelha, sem promovê-la a limite", () => {
    const [node] = buildNodes([
      {
        kind: "error",
        id: "e1",
        message: "Error loading config.toml: invalid transport in mcp_servers.paper",
      },
    ])
    expect(node).toMatchObject({ type: "incident", severity: "error" })
  })
})

describe("resetHintFromMessage", () => {
  it("extrai o reset informado pela Claude", () => {
    expect(resetHintFromMessage(LIMIT)).toBe(
      "1:50pm (America/Sao_Paulo)",
    )
  })
})
