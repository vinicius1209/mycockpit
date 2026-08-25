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
      // A fase "Corrigir" é gerada pelo defaultReviewWorkflow a partir do
      // executor, então herda os critérios dele; as três autorais precisam ter.
      if (!["plan", "ui", "review"].includes(p.id)) continue
      expect(p.exitCriteria?.length, `fase ${p.id}`).toBeGreaterThan(0)
    }
  })

  it("o revisor é mandado OLHAR o resultado, não só o diff", () => {
    const r = fase("review")
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
    const u = fase("ui")
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
})
