import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"

const LIMIT = "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)"

describe("sequência de incidente", () => {
  it("apresenta limite histórico como uma única sequência factual e acionável", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "Continue o trabalho" },
      {
        kind: "result",
        id: "r1",
        ok: false,
        text: LIMIT,
        durationMs: 121_000,
        costUsd: 35.16,
        model: "claude-fable-5",
        usage: { input: 4_000, output: 2_200, cacheRead: 37_000, cacheCreation: 0 },
      },
      { kind: "error", id: "e1", message: LIMIT },
      {
        kind: "error",
        id: "e2",
        message: "o agent `claude-code` saiu com código 1",
      },
    ]
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items,
        running: false,
        finalizing: false,
        startedAt: null,
        agent: "claude-code",
        onContinueWith: vi.fn(),
      }),
    )

    expect(html.match(/>Sessão em intervalo</g)).toHaveLength(1)
    expect(html).toContain("Conversa preservada")
    expect(html).toContain("Retorno informado")
    expect(html).toContain("13:50 · horário de São Paulo")
    expect(html).toContain("turno encerrado")
    expect(html).toContain("2min 01s")
    expect(html).toContain("US$ 35,16")
    expect(html).toContain("Continuar com outro agente")
    expect(html).toContain("Detalhes técnicos")
    expect(html).not.toContain("Execução interrompida")
    expect(html).not.toContain("text-st-error")
    expect(html.match(/bg-st-warning/g)).toHaveLength(1)
    expect(html).not.toContain("border-st-warning/40 bg-st-warning/10")
    expect(html).not.toContain("border-brass/40")
    expect(html).not.toContain("bg-brass/10")
  })

  it("reserva vermelho para erro real e recolhe a causa técnica", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          {
            kind: "error",
            id: "e1",
            message: "Error loading config.toml: invalid transport in mcp_servers.paper",
          },
        ],
        running: false,
        finalizing: false,
        startedAt: null,
        agent: "codex",
        onContinueWith: vi.fn(),
      }),
    )

    expect(html).toContain("Execução interrompida")
    expect(html).toContain("Motivo registrado")
    expect(html.match(/bg-st-error/g)).toHaveLength(1)
    expect(html).toContain("Detalhes técnicos")
    expect(html).toContain("Continuar com outro agente")
    expect(html).not.toContain("Sessão em intervalo")
  })

  it("não oferece revezamento no histórico nem antes de o turno assentar", () => {
    const historical = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "error", id: "e1", message: "invalid transport" },
          { kind: "notice", id: "n1", message: "evento posterior" },
        ],
        running: false,
        finalizing: false,
        startedAt: null,
        agent: "codex",
        onContinueWith: vi.fn(),
      }),
    )
    const running = renderToStaticMarkup(
      createElement(MessageList, {
        items: [{ kind: "error", id: "e1", message: "invalid transport" }],
        running: true,
        finalizing: false,
        startedAt: Date.now(),
        agent: "codex",
        onContinueWith: vi.fn(),
      }),
    )
    const finalizing = renderToStaticMarkup(
      createElement(MessageList, {
        items: [{ kind: "error", id: "e1", message: "invalid transport" }],
        running: false,
        finalizing: true,
        startedAt: null,
        agent: "codex",
        onContinueWith: vi.fn(),
      }),
    )

    expect(historical).not.toContain("Continuar com outro agente")
    expect(running).not.toContain("Continuar com outro agente")
    expect(finalizing).not.toContain("Continuar com outro agente")
  })
})
