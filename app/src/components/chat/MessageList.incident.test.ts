import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"

const LIMIT = "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)"

describe("cartão de incidente", () => {
  it("apresenta limite histórico como um único instrumento âmbar e acionável", () => {
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

    expect(html.match(/Limite desta sessão atingido/g)).toHaveLength(1)
    expect(html).toContain("histórico, contexto e arquivos")
    expect(html).toContain("Disponível novamente")
    expect(html).toContain("13:50 · horário de São Paulo")
    expect(html).toContain("turno encerrado")
    expect(html).toContain("2min 01s")
    expect(html).toContain("US$ 35,16")
    expect(html).toContain("Continuar no Codex")
    expect(html).toContain("Continuar no Antigravity")
    expect(html).toContain("Detalhes técnicos")
    expect(html).not.toContain("Não foi possível concluir esta execução")
    expect(html).not.toContain("text-st-error")
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

    expect(html).toContain("Não foi possível concluir esta execução")
    expect(html).toContain("text-st-error")
    expect(html).toContain("Detalhes técnicos")
    expect(html).toContain("Continuar no Claude Code")
    expect(html).not.toContain("Limite desta sessão atingido")
  })
})
