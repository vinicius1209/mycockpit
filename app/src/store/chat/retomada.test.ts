import { describe, expect, it } from "vitest"
import { comResumeFalhado, notaDeRetomadaFalhada } from "./retomada"
import type { ConvState } from "@/store/chat"

const conv = (extra: Partial<ConvState> = {}): ConvState => ({
  projectId: "p1",
  agent: "claude-code",
  reqModel: null,
  effort: null,
  worktreePath: null,
  items: [{ kind: "text", id: "a", text: "oi" }],
  sessionId: "sess-viva",
  model: null,
  streamingTextId: null,
  running: false,
  finalizing: false,
  runId: null,
  startedAt: null,
  suggestions: [],
  suggesting: false,
  ...extra,
})

describe("resume que falhou (R5)", () => {
  it("esquece a sessão morta e conta no fio que a volta virou transplante", () => {
    const depois = comResumeFalhado(
      conv({
        sessoesAnteriores: {
          "claude-code": { sessionId: "sess-morta", model: null, ultimoItemId: "a", at: 1 },
        },
      }),
      "claude-code",
      1_700,
    )
    expect(depois.sessionId).toBeNull()
    expect(depois.sessoesAnteriores).toBeUndefined()
    expect(depois.items.at(-1)).toEqual({
      kind: "notice",
      id: expect.any(String),
      message: notaDeRetomadaFalhada("Claude Code"),
      ts: 1_700,
    })
  })

  it("resume comum que falha não inventa nota de retomada", () => {
    const depois = comResumeFalhado(conv(), "claude-code")
    expect(depois.sessionId).toBeNull()
    expect(depois.items).toHaveLength(1)
  })

  it("sessão guardada de OUTRO motor sobrevive", () => {
    const depois = comResumeFalhado(
      conv({
        sessoesAnteriores: {
          "claude-code": { sessionId: "sess-morta", model: null, ultimoItemId: "a", at: 1 },
          codex: { sessionId: "sess-codex", model: null, ultimoItemId: "a", at: 1 },
        },
      }),
      "claude-code",
    )
    expect(depois.sessoesAnteriores).toEqual({
      codex: { sessionId: "sess-codex", model: null, ultimoItemId: "a", at: 1 },
    })
  })
})
