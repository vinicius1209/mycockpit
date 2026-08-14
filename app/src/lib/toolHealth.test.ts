import { describe, expect, it } from "vitest"
import { blockingToolCount, toolHealthItems } from "@/lib/toolHealth"
import type { AgentProbe } from "@/lib/detect"

/** Probe no shape REAL: é o que `toProbeMap` grava a partir do DetectedTool do
 *  Rust (detect.rs). O default é a CLI saudável (instalada, logada, na última),
 *  pra cada caso ligar só o que está testando. */
function probe(over: Partial<AgentProbe> = {}): AgentProbe {
  return {
    installed: true,
    version: "2.1.220",
    auth: "ok",
    detail: null,
    latest: "2.1.220",
    latestChannel: "npm",
    altLatest: null,
    altChannel: null,
    checkedAt: 1_754_000_000_000,
    ...over,
  }
}

describe("toolHealthItems, o que entra na lista", () => {
  it("CLI instalada, logada e atualizada não gera item nenhum", () => {
    expect(toolHealthItems({ "claude-code": probe() })).toEqual([])
  })

  it("CLI instalada e deslogada gera item de sem login", () => {
    const items = toolHealthItems({ "claude-code": probe({ auth: "missing" }) })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      agent: "claude-code",
      label: "Claude Code",
      kind: "auth",
      blocking: true,
    })
  })

  it("CLI com versão instalada menor que a latest gera item de update", () => {
    const items = toolHealthItems({
      codex: probe({ version: "0.146.0", latest: "0.147.0" }),
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      agent: "codex",
      kind: "update",
      current: "0.146.0",
      latest: "0.147.0",
      blocking: false,
    })
  })

  it("CLI não instalada não gera item, mesmo com o auth missing que o detect grava pra ausente", () => {
    // detect.rs:252 reporta auth "missing" pra ferramenta AUSENTE; sem a guarda
    // de `installed` o sino acusaria sem login em CLI que o usuário nem tem.
    const items = toolHealthItems({
      "claude-code": probe({ installed: false, version: null, auth: "missing" }),
    })
    expect(items).toEqual([])
  })

  it("agent sem probe (detecção ainda não assentou) não gera item", () => {
    expect(toolHealthItems({})).toEqual([])
  })

  it("auth desconhecida não vira sem login (o agy degrada pra unknown sem ter medido nada)", () => {
    expect(toolHealthItems({ agy: probe({ auth: "unknown" }) })).toEqual([])
  })

  it("latest ausente (offline) não vira update", () => {
    const items = toolHealthItems({
      "claude-code": probe({ version: "2.1.219", latest: null }),
    })
    expect(items).toEqual([])
  })

  it("versão instalada maior que a latest não vira update", () => {
    const items = toolHealthItems({
      "claude-code": probe({ version: "2.1.221", latest: "2.1.220" }),
    })
    expect(items).toEqual([])
  })

  it("agent que o app não integra não gera item nem com probe deslogado", () => {
    // opencode está no registry como available:false: o app não sabe dirigi-lo,
    // então cobrar login dele seria cobrar uma ação sem destino.
    expect(toolHealthItems({ opencode: probe({ auth: "missing" }) })).toEqual([])
  })

  it("a mesma CLI deslogada E com update gera os dois itens (estados independentes)", () => {
    const items = toolHealthItems({
      "claude-code": probe({
        auth: "missing",
        version: "2.1.219",
        latest: "2.1.220",
      }),
    })
    expect(items.map((i) => i.kind)).toEqual(["auth", "update"])
  })
})

describe("toolHealthItems, dispensa persistida do update", () => {
  it("update dispensado na mesma versão some da lista", () => {
    const detected = { codex: probe({ version: "0.146.0", latest: "0.147.0" }) }
    expect(toolHealthItems(detected, { codex: "0.147.0" })).toEqual([])
  })

  it("versão nova volta a aparecer depois de dispensar a anterior", () => {
    const detected = { codex: probe({ version: "0.146.0", latest: "0.148.0" }) }
    const items = toolHealthItems(detected, { codex: "0.147.0" })
    expect(items).toHaveLength(1)
    expect(items[0].latest).toBe("0.148.0")
  })

  it("dispensa de um agent não silencia o update de outro", () => {
    const items = toolHealthItems(
      {
        "claude-code": probe({ version: "2.1.219", latest: "2.1.220" }),
        codex: probe({ version: "0.146.0", latest: "0.147.0" }),
      },
      { codex: "0.147.0" },
    )
    expect(items.map((i) => i.agent)).toEqual(["claude-code"])
  })

  it("dispensa NÃO apaga sem login (impedimento não é dispensável)", () => {
    const items = toolHealthItems(
      { "claude-code": probe({ auth: "missing" }) },
      { "claude-code": "2.1.220" },
    )
    expect(items.map((i) => i.kind)).toEqual(["auth"])
  })
})

describe("toolHealthItems, hierarquia: impedimento antes de conveniência", () => {
  it("todo sem login vem antes de todo update, mesmo com o update sendo de uma CLI anterior no registry", () => {
    const items = toolHealthItems({
      // claude-code vem antes de codex no registry, mas o dele é só update.
      "claude-code": probe({ version: "2.1.219", latest: "2.1.220" }),
      codex: probe({ auth: "missing" }),
    })
    expect(items.map((i) => `${i.agent}:${i.kind}`)).toEqual([
      "codex:auth",
      "claude-code:update",
    ])
  })

  it("dentro do mesmo tipo a ordem é a do registry (estável entre renders)", () => {
    const items = toolHealthItems({
      codex: probe({ auth: "missing" }),
      "claude-code": probe({ auth: "missing" }),
    })
    expect(items.map((i) => i.agent)).toEqual(["claude-code", "codex"])
  })
})

describe("blockingToolCount, o que conta no badge do sino", () => {
  it("sem login conta", () => {
    const items = toolHealthItems({ "claude-code": probe({ auth: "missing" }) })
    expect(blockingToolCount(items)).toBe(1)
  })

  it("update disponível aparece na lista mas não conta", () => {
    const items = toolHealthItems({
      "claude-code": probe({ version: "2.1.219", latest: "2.1.220" }),
    })
    expect(items).toHaveLength(1)
    expect(blockingToolCount(items)).toBe(0)
  })

  it("duas CLIs deslogadas contam duas", () => {
    const items = toolHealthItems({
      "claude-code": probe({ auth: "missing" }),
      codex: probe({ auth: "missing" }),
    })
    expect(blockingToolCount(items)).toBe(2)
  })

  it("só update na lista mantém o badge zerado (sino não fica aceso pra sempre)", () => {
    const items = toolHealthItems({
      "claude-code": probe({ version: "2.1.219", latest: "2.1.220" }),
      codex: probe({ version: "0.146.0", latest: "0.147.0" }),
      agy: probe({ version: "1.1.11", latest: "1.1.12" }),
    })
    expect(items).toHaveLength(3)
    expect(blockingToolCount(items)).toBe(0)
  })
})
