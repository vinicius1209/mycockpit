// A curadoria dos modos (M1) e o cruzamento com a sonda.
//
// O que estes testes protegem é uma decisão de SEGURANÇA: id descoberto sem
// curadoria não pode virar opção. A tentação natural — "o motor anuncia, então
// oferece" — é fail-open, e neste eixo fail-open não dá sintoma até um agente
// escrever onde não devia.
//
// Os ids reais usados aqui vieram da sonda rodando nos binários desta máquina
// em 21/08/2026 (claude 2.1.220, codex 0.147.0, agy 1.1.17).

import { describe, expect, it } from "vitest"
import {
  MODOS_CURADOS,
  driftDeModos,
  frasesDoDrift,
  modosOferecidos,
} from "./agentModes"

const CLAUDE_REAL = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
]
const CODEX_REAL = ["read-only", "workspace-write", "danger-full-access"]
const AGY_REAL = ["accept-edits", "plan"]

describe("modosOferecidos — só o que o motor tem E a gente explica", () => {
  it("claude: os quatro curados passam", () => {
    expect(modosOferecidos("claude-code", CLAUDE_REAL).map((d) => d.id)).toEqual([
      "plan",
      "acceptEdits",
      "auto",
      "bypassPermissions",
    ])
  })

  it("claude: `manual` e `dontAsk` NÃO viram opção", () => {
    // O coração da decisão: o `--help` os cita, e ninguém aqui validou o quanto
    // eles liberam. Oferecer seria fail-open.
    const ids = modosOferecidos("claude-code", CLAUDE_REAL).map((d) => d.id)
    expect(ids).not.toContain("manual")
    expect(ids).not.toContain("dontAsk")
  })

  it("modo curado que o motor NÃO anuncia some da lista", () => {
    // Motor que perdeu o modo: parar de oferecer é melhor que mandar uma flag
    // que vai falhar no turno.
    const ids = modosOferecidos("claude-code", ["plan"]).map((d) => d.id)
    expect(ids).toEqual(["plan"])
  })

  it("codex: os três são sandbox de SO", () => {
    const defs = modosOferecidos("codex", CODEX_REAL)
    expect(defs).toHaveLength(3)
    expect(defs.every((d) => d.enforcement === "sandbox")).toBe(true)
  })

  it("agy: nenhum, porque o app não manda `--mode` (emula por prompt)", () => {
    expect(modosOferecidos("agy", AGY_REAL)).toEqual([])
    expect(MODOS_CURADOS.agy.nota).toBeTruthy()
  })

  it("motor desconhecido não inventa modo", () => {
    expect(modosOferecidos("motor-que-nao-existe", ["plan"])).toEqual([])
  })
})

describe("driftDeModos", () => {
  it("claude 2.1.220: dois modos novos, nenhum sumido", () => {
    expect(driftDeModos("claude-code", CLAUDE_REAL)).toEqual({
      novos: ["manual", "dontAsk"],
      sumidos: [],
    })
  })

  it("codex: em dia", () => {
    expect(driftDeModos("codex", CODEX_REAL)).toEqual({ novos: [], sumidos: [] })
  })

  it("agy: os dois que ele anuncia são novidade pro app", () => {
    expect(driftDeModos("agy", AGY_REAL).novos).toEqual(["accept-edits", "plan"])
  })

  it("modo que SUMIU do motor é acusado", () => {
    // O mais urgente dos dois: continuamos mandando a flag até alguém reparar,
    // e o erro chega como falha de turno em vez de aviso.
    expect(driftDeModos("codex", ["read-only"]).sumidos).toEqual([
      "workspace-write",
      "danger-full-access",
    ])
  })

  it("sonda que NÃO leu (null) não acusa nada", () => {
    // "Não consegui perguntar" ≠ "sumiram todos". Acusar aqui encheria a tela
    // de alarme falso toda vez que o binário não estivesse no PATH.
    expect(driftDeModos("codex", null)).toEqual({ novos: [], sumidos: [] })
  })
})

describe("frasesDoDrift", () => {
  it("cala quando não há drift", () => {
    expect(frasesDoDrift("codex", { novos: [], sumidos: [] })).toEqual([])
  })

  it("o SUMIDO vem primeiro (é o que quebra turno)", () => {
    const f = frasesDoDrift("codex", { novos: ["x"], sumidos: ["y"] })
    expect(f[0]).toContain("não anuncia mais")
  })

  it("o novo do agy carrega a nota que explica o vazio", () => {
    const f = frasesDoDrift("agy", { novos: ["plan"], sumidos: [] })
    expect(f[0]).toContain("revalidar")
  })

  it("nomeia os ids, nunca só a contagem", () => {
    // "2 modos novos" manda você caçar quais; o nome resolve na hora.
    const f = frasesDoDrift("claude-code", { novos: ["manual", "dontAsk"], sumidos: [] })
    expect(f[0]).toContain("manual")
    expect(f[0]).toContain("dontAsk")
  })
})
