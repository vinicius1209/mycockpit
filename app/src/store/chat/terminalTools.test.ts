import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  reduceTerminalEvent,
  settleOrphanedTool,
  settleTerminalTools,
} from "./terminalTools"

const INCIDENT_TOOL: ChatItem = {
  kind: "tool",
  id: "330585d6-21f1-4fd5-a5f6-63647be48bce",
  name: "run_command",
  input: {},
  toolId: "agy-step-94",
  ts: 1_788_045_262_103,
  activityAt: 1_788_045_262_103,
}

describe("settleTerminalTools", () => {
  it("interrompe a ferramenta real que ficou pendente quando a ponte morreu", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "abra o mock" },
      INCIDENT_TOOL,
    ]
    const settled = settleTerminalTools(items, "cancelled", 1_788_047_000_000)
    expect(settled[1]).toMatchObject({
      kind: "tool",
      activityAt: 1_788_047_000_000,
      result: { ok: false, lines: 1 },
    })
  })

  it("não toca ferramenta concluída nem órfã de turno anterior", () => {
    const done = {
      ...INCIDENT_TOOL,
      result: { ok: true, text: "ok", lines: 1 },
    } satisfies ChatItem
    const items: ChatItem[] = [
      INCIDENT_TOOL,
      { kind: "user", id: "u2", text: "continue" },
      done,
    ]
    const settled = settleTerminalTools(items, "done", 20)
    expect(settled).toBe(items)
  })
})

describe("settleOrphanedTool", () => {
  it("não deixa o step 94 real reaparecer como ferramenta em execução no restore", () => {
    expect(settleOrphanedTool(INCIDENT_TOOL, 1_788_047_100_000)).toMatchObject({
      kind: "tool",
      toolId: "agy-step-94",
      activityAt: 1_788_047_100_000,
      result: {
        ok: false,
        text: expect.stringContaining("sem receber o desfecho"),
        lines: 1,
      },
    })
  })
})

describe("corte seu (ADR-180)", () => {
  const T = 1_788_962_247_781 // o cancelled real de 09/09/2026
  const turno: ChatItem[] = [
    { kind: "user", id: "u1", text: "abra o mock" },
    INCIDENT_TOOL,
  ]

  it("a ação cortada fica marcada como PAROU, não como falha", () => {
    const settled = settleTerminalTools(turno, "cancelled", T)
    expect(settled[1]).toMatchObject({ result: { ok: false, interrupted: true } })
  })

  it("EOF sem corte continua sendo encerramento sem desfecho, sem a marca de corte", () => {
    const settled = settleTerminalTools(turno, "done", T)
    const tool = settled[1] as Extract<ChatItem, { kind: "tool" }>
    expect(tool.result?.ok).toBe(false)
    expect(tool.result?.interrupted).toBeUndefined()
  })

  it("o marco leva a causa que o gesto carimbou", () => {
    const out = reduceTerminalEvent(turno, { type: "cancelled", cause: "correcao" }, T)
    expect(out.items?.at(-1)).toMatchObject({ kind: "cancelled", cause: "correcao", ts: T })
    expect(out.streamingTextId).toBeNull()
  })

  it("sem causa carimbada o marco não inventa uma", () => {
    const marco = reduceTerminalEvent([], { type: "cancelled" }, T).items?.at(-1)
    expect(marco).toMatchObject({ kind: "cancelled", ts: T })
    expect(marco && "cause" in marco).toBe(false)
  })

  it("done sem nada a fechar não reescreve os itens", () => {
    const items: ChatItem[] = [{ kind: "user", id: "u1", text: "oi" }]
    expect(reduceTerminalEvent(items, { type: "done", code: 0 }, T)).toEqual({
      streamingTextId: null,
    })
  })
})

describe("desfecho honesto de trabalho em background (ADR-182)", () => {
  const T = 1_788_962_247_781
  const diferidoVivo: ChatItem = {
    kind: "tool",
    id: "def-b3pbaal2v",
    name: "DeferredWork",
    input: {},
    deferred: {
      id: "b3pbaal2v",
      toolUseId: "toolu-bash",
      kind: "bash",
      name: "Build test app in background",
      status: "running",
      summary: null,
      outputFile: "/tmp/tasks/b3pbaal2v.output",
      tokens: null,
      startedAt: T,
      updatedAt: T,
    },
    ts: T,
    activityAt: T,
  }

  it("EOF com diferido rodando marca como PAROU (interrupted: true), não como falha técnica", () => {
    const turno = [{ kind: "user", id: "u1", text: "build" }, diferidoVivo] as ChatItem[]
    const settled = settleTerminalTools(turno, "done", T + 5000)
    const tool = settled[1] as Extract<ChatItem, { kind: "tool" }>
    expect(tool.deferred?.status).toBe("interrupted")
    expect(tool.result?.ok).toBe(false)
    expect(tool.result?.interrupted).toBe(true)
    expect(tool.result?.text).toContain("Envie uma nova mensagem para retomar")
  })

  it("restore de diferido rodando também marca interrupted: true", () => {
    const settled = settleOrphanedTool(diferidoVivo, T + 10000) as Extract<ChatItem, { kind: "tool" }>
    expect(settled.deferred?.status).toBe("interrupted")
    expect(settled.result?.ok).toBe(false)
    expect(settled.result?.interrupted).toBe(true)
    expect(settled.result?.text).toContain("reiniciou")
  })
})

