import { describe, expect, it } from "vitest"
import {
  buildExecutionPrompt,
  extractPlanText,
  needsPlanEmbedded,
  turnEndedOk,
} from "./planMode"
import type { ChatItem } from "@/store/chat"

describe("buildExecutionPrompt", () => {
  it("claude/codex: turno seguinte normal (o resume preserva o plano)", () => {
    const p = "Plano aprovado. Execute todas as etapas agora."
    expect(buildExecutionPrompt("claude-code", "1. fazer X")).toBe(p)
    expect(buildExecutionPrompt("codex", "1. fazer X")).toBe(p)
  })
  it("agy (sem resume): embute o texto do plano no prompt", () => {
    const plan = "1. criar arquivo\n2. rodar testes"
    expect(buildExecutionPrompt("agy", plan)).toBe(
      `Plano aprovado — execute-o agora:\n\n${plan}`,
    )
  })
  it("agent desconhecido cai no caminho com resume (não embute)", () => {
    expect(buildExecutionPrompt("opencode", "plano")).toBe(
      "Plano aprovado. Execute todas as etapas agora.",
    )
  })
})

describe("needsPlanEmbedded", () => {
  it("só o agy precisa do plano embutido", () => {
    expect(needsPlanEmbedded("agy")).toBe(true)
    expect(needsPlanEmbedded("claude-code")).toBe(false)
    expect(needsPlanEmbedded("codex")).toBe(false)
  })
})

const user = (text: string): ChatItem => ({ kind: "user", id: "u", text })
const text = (t: string, id = "t"): ChatItem => ({ kind: "text", id, text: t })
const result = (ok: boolean, t?: string): ChatItem => ({
  kind: "result",
  id: "r",
  ok,
  text: t,
})

describe("extractPlanText", () => {
  it("pega o ÚLTIMO item de texto do turno (não o primeiro)", () => {
    const items: ChatItem[] = [
      user("planeje X"),
      text("pensando…", "t1"),
      text("## Plano\n1. A\n2. B", "t2"),
      result(true, "## Plano\n1. A\n2. B"),
    ]
    expect(extractPlanText(items)).toBe("## Plano\n1. A\n2. B")
  })
  it("NÃO cruza pro turno anterior (para no último user)", () => {
    const items: ChatItem[] = [
      text("texto de turno antigo"),
      user("planeje X"),
      result(true),
    ]
    expect(extractPlanText(items)).toBeNull()
  })
  it("fallback: usa o texto do result quando não houve item de texto", () => {
    const items: ChatItem[] = [user("planeje X"), result(true, "plano no result")]
    expect(extractPlanText(items)).toBe("plano no result")
  })
  it("ignora texto vazio/whitespace", () => {
    const items: ChatItem[] = [
      user("planeje X"),
      text("plano real", "t1"),
      text("   ", "t2"),
      result(true),
    ]
    expect(extractPlanText(items)).toBe("plano real")
  })
  it("fio vazio → null", () => {
    expect(extractPlanText([])).toBeNull()
  })
})

describe("turnEndedOk", () => {
  it("true só quando o último item é um result ok", () => {
    expect(turnEndedOk([user("x"), text("plano"), result(true)])).toBe(true)
    expect(turnEndedOk([user("x"), text("plano"), result(false)])).toBe(false)
    expect(turnEndedOk([user("x"), text("plano")])).toBe(false)
    expect(
      turnEndedOk([user("x"), result(true), { kind: "cancelled", id: "c" }]),
    ).toBe(false)
    expect(turnEndedOk([])).toBe(false)
  })
})
