// O UI-first carrega critérios de UI, e eles não podem sumir numa edição.
//
// Vieram da auditoria de uma missão real (ADR-091): o plano decidiu "grande
// prova visual do produto", a entrega saiu sem NENHUMA imagem de produto na
// dobra, e passou — porque o critério registrado do revisor foi, literalmente,
// `lint` + `build` + `git diff --check`. Um compilador, não um olho.
//
// Os testes fixam a REGRA (existe critério de saída falando da dobra, o
// revisor é mandado abrir o resultado), nunca a redação — texto é copy e muda.

import { describe, expect, it } from "vitest"
import { DEFAULT_MISSION_PRESETS } from "@/lib/missionDefaults"

const uiFirst = DEFAULT_MISSION_PRESETS.find((p) => p.id === "ui-first")!
const fase = (id: string) => uiFirst.phases.find((p) => p.id === id)!

describe("preset ui-first", () => {
  it("existe e continua sendo um fluxo de UI com revisor", () => {
    expect(uiFirst).toBeDefined()
    expect(uiFirst.phases.map((p) => p.persona)).toContain("reviewer")
  })

  it("TODA fase declara critério de saída — o gate não pode ser implícito", () => {
    for (const p of uiFirst.phases) {
      expect(p.exitCriteria?.length, `fase ${p.id}`).toBeGreaterThan(0)
    }
  })

  it("o revisor é mandado OLHAR o resultado, não só o diff", () => {
    const r = fase("judge")
    const texto = [r.instructions ?? "", ...(r.exitCriteria ?? [])].join(" ").toLowerCase()
    // O defeito era o revisor parar no `git diff`. A instrução precisa mandar
    // abrir a coisa.
    expect(texto).toMatch(/abr|olh/)
    expect(texto).toMatch(/dobra/)
  })

  it("a versão anterior é RÉGUA, e isso está escrito no planejador", () => {
    const p = fase("plan")
    const texto = [p.instructions ?? "", ...(p.exitCriteria ?? [])].join(" ").toLowerCase()
    // Sem isto, "variação" pode virar "mais simples" — foi o que aconteceu.
    expect(texto).toMatch(/atual|anterior|régua/)
    expect(texto).toMatch(/piorar|mantê|manter|regress/)
  })

  it("o executor sabe que a dobra precisa de prova visual do produto", () => {
    const u = fase("build")
    const texto = [u.instructions ?? "", ...(u.exitCriteria ?? [])].join(" ").toLowerCase()
    expect(texto).toMatch(/dobra/)
    expect(texto).toMatch(/prova visual|produto/)
  })

  it("os critérios são frases inteiras, não rótulos soltos", () => {
    // Critério de uma palavra não orienta ninguém; vira ritual.
    for (const p of uiFirst.phases) {
      for (const c of p.exitCriteria ?? []) {
        expect(c.trim().split(/\s+/).length, c).toBeGreaterThan(4)
      }
    }
  })

  it("só encerra depois de verificar e julgar; qualquer reprovação volta à correção", () => {
    const edges = uiFirst.graph!.edges.map((edge) => [
      edge.source,
      edge.condition,
      edge.target,
      edge.maxTraversals,
    ])
    expect(edges).toContainEqual(["node-verify", "success", "node-judge", 30])
    expect(edges).toContainEqual(["node-verify", "failure", "node-fix", 30])
    expect(edges).toContainEqual(["node-judge", "failure", "node-fix", 30])
    expect(edges).toContainEqual(["node-fix", "success", "node-verify", 30])
  })

  it("verificador e juiz exigem screenshots e são independentes do executor", () => {
    const verifier = fase("verify")
    const judge = fase("judge")
    expect(verifier.agent).not.toBe(fase("build").agent)
    expect(judge.agent).not.toBe(fase("build").agent)
    expect([verifier.instructions, judge.instructions].join(" ").toLowerCase()).toMatch(
      /screenshots?/,
    )
  })
})

describe("loops dos presets de fábrica", () => {
  it.each(DEFAULT_MISSION_PRESETS)(
    "$name mantém verificador e juiz separados do executor e retorna toda reprovação à correção",
    (preset) => {
      const byId = new Map(preset.phases.map((phase) => [phase.id, phase]))
      const build = byId.get("build")!
      const verify = byId.get("verify")!
      const judge = byId.get("judge")!
      expect(verify.agent).not.toBe(build.agent)
      expect(judge.agent).not.toBe(build.agent)
      expect(preset.gatePolicy).toBe("nunca")
      expect(preset.phases.every((phase) => phase.autonomy === "auto")).toBe(true)
      expect(
        preset.graph?.edges.map((edge) => [
          edge.source,
          edge.condition,
          edge.target,
          edge.maxTraversals,
        ]),
      ).toEqual(
        expect.arrayContaining([
          ["node-verify", "success", "node-judge", 30],
          ["node-verify", "failure", "node-fix", 30],
          ["node-judge", "failure", "node-fix", 30],
          ["node-fix", "success", "node-verify", 30],
        ]),
      )
    },
  )
})
