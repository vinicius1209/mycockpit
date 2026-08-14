// REPRO TEMPORÁRIO (auditoria fio-poluicao-2) — apagar depois.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"
import type { DeferredWork } from "@/lib/work"

const T0 = 1_754_400_000_000
const NAME = "Check address edit history in prod"

function render(items: ChatItem[], running = false): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running,
      finalizing: false,
      startedAt: running ? T0 : null,
      agent: "claude-code",
    }),
  )
}

describe("REPRO cena do print", () => {
  it("conta as repetições do nome", () => {
    const deferred: DeferredWork = {
      id: "task_abc",
      toolUseId: "toolu_agent1",
      kind: "local_agent",
      name: NAME,
      status: "running",
      summary: null,
      outputFile: null,
      tokens: null,
      startedAt: T0,
      updatedAt: T0,
    }
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "confere o histórico" },
      {
        kind: "tool",
        id: "t1",
        name: "Agent",
        input: {
          description: NAME,
          subagent_type: "general-purpose",
          prompt: "Look at the address edit history table…",
        },
        toolId: "toolu_agent1",
        ts: T0,
        activityAt: T0,
      },
      {
        kind: "tool",
        id: "deferred-task_abc",
        name: "DeferredWork",
        input: { name: NAME, kind: "local_agent", description: null },
        toolId: "deferred:task_abc",
        parentToolId: "toolu_agent1",
        deferred,
        ts: T0,
        activityAt: T0,
      },
    ]
    const html = render(items, true)
    const hits = html.match(new RegExp(NAME, "g")) ?? []
    // eslint-disable-next-line no-console
    console.log(
      "SPINNERS:", (html.match(/animate-spin/g) ?? []).length,
      "| st-running:", (html.match(/st-running/g) ?? []).length,
      "| pulse:", (html.match(/animate-cockpit-pulse/g) ?? []).length,
      "| 'Claude Code':", (html.match(/Claude Code/g) ?? []).length,
      "| aria-expanded:", (html.match(/aria-expanded/g) ?? []).length,
    )
    // eslint-disable-next-line no-console
    console.log("OCORRENCIAS DO NOME:", hits.length)
    // eslint-disable-next-line no-console
    console.log(
      "TEXTO:\n" +
        html
          .replace(/<\/?(div|span|p|button|li|h[1-6])[^>]*>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .join("\n"),
    )
    expect(hits.length).toBeGreaterThan(0)
  })

  it("cena ASSENTADA (task concluiu)", () => {
    const deferred: DeferredWork = {
      id: "task_abc",
      toolUseId: "toolu_agent1",
      kind: "local_agent",
      name: NAME,
      status: "completed",
      summary: "Encontrei 3 edições suspeitas.",
      outputFile: "/tmp/out.md",
      tokens: 41000,
      startedAt: T0,
      updatedAt: T0 + 300_000,
    }
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "confere o histórico" },
      {
        kind: "tool",
        id: "t1",
        name: "Agent",
        input: {
          description: NAME,
          subagent_type: "general-purpose",
          prompt: "Look at the address edit history table…",
        },
        toolId: "toolu_agent1",
        ts: T0,
        activityAt: T0 + 300_000,
        result: { ok: true, text: "ok", lines: 1 },
      },
      {
        kind: "tool",
        id: "deferred-task_abc",
        name: "DeferredWork",
        input: { name: NAME, kind: "local_agent", description: null },
        toolId: "deferred:task_abc",
        parentToolId: "toolu_agent1",
        deferred,
        ts: T0,
        activityAt: T0 + 300_000,
        result: { ok: true, text: "Encontrei 3 edições suspeitas.", lines: 1 },
      },
    ]
    const html = render(items, false)
    // eslint-disable-next-line no-console
    console.log(
      "ASSENTADO:\n" +
        html
          .replace(/<\/?(div|span|p|button|li|h[1-6])[^>]*>/g, "\n")
          .replace(/<[^>]+>/g, "")
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean)
          .join("\n"),
    )
    expect(html).toBeTruthy()
  })
})
