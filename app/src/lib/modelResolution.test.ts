import { describe, expect, it } from "vitest"
import {
  aliasShiftNotice,
  expectedResolution,
  isAliasRequest,
  resolutionNotice,
} from "@/lib/modelResolution"

describe("expectedResolution", () => {
  it("alias trava a família, não a versão", () => {
    const opus = expectedResolution("claude-code", "opus")!
    expect(opus.test("claude-opus-4-8")).toBe(true)
    expect(opus.test("claude-opus-4-7[1m]")).toBe(true) // versão livre, família ok
    expect(opus.test("claude-sonnet-5")).toBe(false)
  })

  it("alias com [1m] exige o 1M de volta no resolvido", () => {
    const opus1m = expectedResolution("claude-code", "opus[1m]")!
    expect(opus1m.test("claude-opus-4-7[1m]")).toBe(true) // caso real: 4.7 é resolução legítima do alias
    expect(opus1m.test("claude-opus-4-8[1m]")).toBe(true)
    expect(opus1m.test("claude-opus-4-8")).toBe(false) // perdeu o 1M pedido
  })

  it("pin por ID completo é match exato (tolerando sufixo [1m] não pedido)", () => {
    const pin = expectedResolution("claude-code", "claude-opus-4-8")!
    expect(pin.test("claude-opus-4-8")).toBe(true)
    expect(pin.test("claude-opus-4-8[1m]")).toBe(true) // 1M é default; CLI pode reportar o sufixo
    expect(pin.test("claude-opus-4-7")).toBe(false) // fallback silencioso do headless → pega

    const pin1m = expectedResolution("claude-code", "claude-opus-4-8[1m]")!
    expect(pin1m.test("claude-opus-4-8[1m]")).toBe(true)
    expect(pin1m.test("claude-opus-4-8")).toBe(false)
  })

  it("opusplan aceita as duas famílias do modo (plano em Opus, execução em Sonnet)", () => {
    const plan = expectedResolution("claude-code", "opusplan")!
    expect(plan.test("claude-opus-4-8")).toBe(true)
    expect(plan.test("claude-sonnet-5")).toBe(true)
    expect(plan.test("claude-haiku-4-5-20251001")).toBe(false)
  })

  it("sem expectativa: default, agent que ecoa (codex) e alias desconhecido", () => {
    expect(expectedResolution("claude-code", null)).toBeNull()
    expect(expectedResolution("claude-code", "default")).toBeNull()
    expect(expectedResolution("codex", "gpt-5.6-sol")).toBeNull()
    expect(expectedResolution("agy", "gemini-3.6-flash-high")).toBeNull()
    expect(expectedResolution("claude-code", "alias-que-nao-existe")).toBeNull()
  })
})

describe("resolutionNotice", () => {
  it("divergência dura gera mensagem com pedido e resolvido", () => {
    const msg = resolutionNotice("claude-code", "claude-opus-4-8", "claude-sonnet-5")
    expect(msg).toContain('"claude-opus-4-8"')
    expect(msg).toContain('"claude-sonnet-5"')
  })

  it("resolução dentro do contrato do alias NÃO é aviso (vira ledger, não ruído)", () => {
    expect(
      resolutionNotice("claude-code", "opus[1m]", "claude-opus-4-7[1m]"),
    ).toBeNull()
  })

  it("silencioso sem resolvido ou sem expectativa verificável", () => {
    expect(resolutionNotice("claude-code", "claude-opus-4-8", null)).toBeNull()
    expect(resolutionNotice("codex", "gpt-5.5", "gpt-5.6-sol")).toBeNull()
  })
})

describe("isAliasRequest / aliasShiftNotice", () => {
  it("distingue alias de pin e de default", () => {
    expect(isAliasRequest("claude-code", "opus")).toBe(true)
    expect(isAliasRequest("claude-code", "opus[1m]")).toBe(true)
    expect(isAliasRequest("claude-code", "claude-opus-4-8")).toBe(false)
    expect(isAliasRequest("claude-code", "default")).toBe(false)
    expect(isAliasRequest("codex", "gpt-5.5")).toBe(false)
  })

  it("mensagem de mudança de resolução carrega antes/depois", () => {
    const msg = aliasShiftNotice("opus", "claude-opus-4-7", "claude-opus-4-8")
    expect(msg).toContain('"claude-opus-4-7"')
    expect(msg).toContain('"claude-opus-4-8"')
  })
})
