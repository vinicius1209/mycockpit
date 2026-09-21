import { describe, expect, it } from "vitest"
import { cruzarArquivos, ehRuidoDoMotor } from "@/lib/arquivosDeclarados"

describe("cruzarArquivos", () => {
  it("O CASO REAL: dependência nova que ninguém declarou", () => {
    // Missão de 25/08: 5 handoffs, 20 arquivos declarados, e o worktree com
    // package.json + bun.lock (playwright entrou) e 3,8 MB de screenshots.
    const r = cruzarArquivos(
      ["landing/src/v2/Hero.tsx", "landing/vite.config.ts"],
      [
        "landing/src/v2/Hero.tsx",
        "landing/vite.config.ts",
        "landing/package.json",
        "landing/bun.lock",
      ],
    )
    expect(r.naoDeclarados).toEqual(["landing/bun.lock", "landing/package.json"])
    expect(r.confirmados).toHaveLength(2)
    expect(r.semRastro).toEqual([])
  })

  it("declarado sem rastro no git (revertido, ou só lido)", () => {
    const r = cruzarArquivos(["a.ts", "b.ts"], ["a.ts"])
    expect(r.semRastro).toEqual(["b.ts"])
    expect(r.naoDeclarados).toEqual([])
  })

  it("normaliza './x' e '/x' contra 'x' — dialetos diferentes, mesmo arquivo", () => {
    const r = cruzarArquivos(["./src/a.ts", "/src/b.ts"], ["src/a.ts", "src/b.ts"])
    expect(r.confirmados).toEqual(["src/a.ts", "src/b.ts"])
    expect(r.naoDeclarados).toEqual([])
  })

  it("diff VAZIO não acusa ninguém", () => {
    // Sem repo o diff volta vazio. "Não sei" virando "você escondeu" seria a
    // pior forma possível deste aviso errar.
    const r = cruzarArquivos(["a.ts"], [])
    expect(r.naoDeclarados).toEqual([])
    expect(r.semRastro).toEqual(["a.ts"])
  })

  it("nada declarado e nada no git: silêncio", () => {
    expect(cruzarArquivos([], [])).toEqual({
      confirmados: [],
      semRastro: [],
      naoDeclarados: [],
    })
  })

  it("duplicata no handoff não vira duas linhas", () => {
    const r = cruzarArquivos(["a.ts", "./a.ts"], ["a.ts"])
    expect(r.confirmados).toEqual(["a.ts"])
  })
})

describe("ehRuidoDoMotor", () => {
  it("o handoff da própria missão não conta como 'não declarado'", () => {
    // Ele vive em .frota/missions/... e apareceria em TODA missão. Aviso
    // que aparece sempre ensina a ignorar o aviso.
    expect(ehRuidoDoMotor(".mycockpit/missions/x/0-planner.json")).toBe(true)
    expect(ehRuidoDoMotor("./.mycockpit/context/y.md")).toBe(true)
  })

  it("arquivo do trabalho não é ruído", () => {
    expect(ehRuidoDoMotor("landing/package.json")).toBe(false)
    expect(ehRuidoDoMotor("src/mycockpit.ts")).toBe(false)
  })
})
