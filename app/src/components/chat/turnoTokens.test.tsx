// A quebra de tokens do recibo (ADR-199): saiu da linha e virou tooltip do
// custo. As guardas continuam as mesmas da versão em linha: sem uso não há o
// que dizer, e o contexto reenviado só aparece quando houve.

import { describe, expect, it } from "vitest"
import { resumoDosTokens } from "./turnoTokens"

describe("resumoDosTokens", () => {
  it("sem uso nenhum não diz nada", () => {
    expect(resumoDosTokens()).toEqual([])
    expect(resumoDosTokens({ input: 0, output: 0, cacheRead: 0 })).toEqual([])
  })

  it("só cache lido ainda é informação: vira a linha do reaproveitado", () => {
    const linhas = resumoDosTokens({ input: 0, output: 0, cacheRead: 9000 })
    expect(linhas).toHaveLength(1)
    expect(linhas[0]).toContain("Contexto reaproveitado do cache:")
  })

  it("entrada e saída aparecem na quebra", () => {
    const linhas = resumoDosTokens({ input: 1200, output: 340, cacheRead: 0 })
    expect(linhas.some((l) => l.startsWith("Entrada:"))).toBe(true)
    expect(linhas.some((l) => l.startsWith("Saída:"))).toBe(true)
  })

  it("contexto reenviado só aparece quando houve, e diz que custa mais", () => {
    expect(
      resumoDosTokens({ input: 10, output: 10, cacheRead: 0 }).join(" "),
    ).not.toContain("reenviado")
    const linhas = resumoDosTokens({ input: 10, output: 10, cacheRead: 0, cacheCreation: 5000 })
    expect(linhas.join(" ")).toContain("Contexto reenviado:")
    expect(linhas.join(" ")).toContain("custa mais por token")
  })

  it("reenvio sozinho sustenta a quebra", () => {
    expect(
      resumoDosTokens({ input: 0, output: 0, cacheRead: 0, cacheCreation: 5000 }),
    ).toHaveLength(1)
  })
})
