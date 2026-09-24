import { describe, expect, it } from "vitest"
import { ESTADO_INICIAL, linhasDaBusca, modeloDoNome, POR_GRUPO, trechosDoNome, type LinhaDaBusca } from "./buscaAgrupada"

// Busca REAL por "config" na pasta `projetos` (24/09/2026, colhida com `find`,
// sem node_modules): o caso que a pessoa descreveu como "tudo muito solto".
const REAL = [
  "nossa-casa-codex/postcss.config.mjs",
  "nossa-casa-codex/tsconfig.json",
  "nossa-casa-codex/drizzle.config.ts",
  "nossa-casa-codex/vite.config.ts",
  "nossa-casa-codex/eslint.config.mjs",
  "nossa-casa-codex/next.config.ts",
  "nossa-casa-codex/tsconfig.tsbuildinfo",
  "orca/electron.vite.config.ts",
  "orca/vite.web.config.ts",
  "orca/tsconfig.json",
  "caso-0247/vite.config.ts.timestamp-1777853494596-f71e01b9722f1.mjs",
  "caso-0247/tsconfig.json",
  "caso-0247/vite.config.ts.timestamp-1777856894858-f906c967384df.mjs",
  "caso-0247/vite.config.ts.timestamp-1777851062000-8445571e24983.mjs",
  "caso-0247/vite.config.ts",
  "caso-0247/vite.config.ts.timestamp-1777859830894-50feaa1f211ff.mjs",
  "cockpit/src/lib/config.ts",
].map((relPath) => ({ relPath, name: relPath.split("/").pop()! }))

const tipos = (linhas: LinhaDaBusca<(typeof REAL)[number]>[]) =>
  linhas.map((l) =>
    l.tipo === "grupo" ? `# ${l.nome} ${l.total}` : l.tipo === "arquivo" ? l.entrada.name : l.tipo === "mais" ? `+${l.quantos}` : `~${l.modelo} ×${l.quantos}`,
  )

describe("busca agrupada (ADR-254)", () => {
  it("um grupo por projeto, na ordem em que o primeiro achado chegou, com a contagem", () => {
    const grupos = linhasDaBusca(REAL, ESTADO_INICIAL, "projetos").filter((l) => l.tipo === "grupo")
    expect(grupos.map((g) => (g.tipo === "grupo" ? `${g.nome} ${g.total}` : ""))).toEqual([
      "nossa-casa-codex 7",
      "orca 3",
      "caso-0247 6",
      "cockpit 1",
    ])
  })

  it(`até ${POR_GRUPO} por grupo e "mais N"; o gesto mostra o grupo inteiro`, () => {
    const linhas = tipos(linhasDaBusca(REAL, ESTADO_INICIAL, "projetos"))
    expect(linhas.slice(0, 7)).toEqual([
      "# nossa-casa-codex 7",
      "postcss.config.mjs",
      "tsconfig.json",
      "drizzle.config.ts",
      "vite.config.ts",
      "eslint.config.mjs",
      "+2",
    ])
    const inteiro = tipos(linhasDaBusca(REAL, { ...ESTADO_INICIAL, inteiros: new Set(["nossa-casa-codex"]) }, "projetos"))
    expect(inteiro).toContain("tsconfig.tsbuildinfo")
    expect(inteiro).not.toContain("+2")
  })

  it("os gerados com o mesmo começo viram uma linha de parecidos, no lugar do primeiro", () => {
    const caso = tipos(linhasDaBusca(REAL, ESTADO_INICIAL, "projetos"))
    const i = caso.indexOf("# caso-0247 6")
    expect(caso.slice(i, i + 4)).toEqual(["# caso-0247 6", "~vite.config.ts.timestamp-….mjs ×4", "tsconfig.json", "vite.config.ts"])
    const aberto = tipos(
      linhasDaBusca(REAL, { ...ESTADO_INICIAL, parecidosAbertos: new Set(["caso-0247::vite.config.ts.timestamp-….mjs"]) }, "projetos"),
    )
    expect(aberto.filter((l) => l.startsWith("vite.config.ts.timestamp"))).toHaveLength(4)
  })

  it("grupo recolhido mostra só o cabeçalho", () => {
    const linhas = linhasDaBusca(REAL, { ...ESTADO_INICIAL, recolhidos: new Set(["orca"]) }, "projetos")
    const i = linhas.findIndex((l) => l.tipo === "grupo" && l.chave === "orca")
    expect(linhas[i]).toMatchObject({ aberto: false, total: 3 })
    expect(linhas[i + 1]).toMatchObject({ tipo: "grupo", chave: "caso-0247" })
  })

  it("o arquivo diz de onde é dentro do grupo", () => {
    const config = linhasDaBusca(REAL, ESTADO_INICIAL, "projetos").find(
      (l) => l.tipo === "arquivo" && l.entrada.relPath === "cockpit/src/lib/config.ts",
    )
    expect(config).toMatchObject({ onde: "src/lib" })
  })

  it("com um grupo só não há o que agrupar: fica a lista, com o caminho", () => {
    const soUm = REAL.filter((e) => e.relPath.startsWith("orca/")).map((e) => ({ ...e, relPath: e.relPath.replace("orca/", "app/src/") }))
    const linhas = linhasDaBusca(soUm, ESTADO_INICIAL, "frota")
    expect(linhas.every((l) => l.tipo === "arquivo")).toBe(true)
    expect(linhas[0]).toMatchObject({ onde: "app/src" })
  })

  it("o que mora na raiz ganha o nome do projeto como grupo", () => {
    const linhas = linhasDaBusca([{ relPath: "vite.config.ts", name: "vite.config.ts" }, ...REAL.slice(0, 1)], ESTADO_INICIAL, "projetos")
    expect(linhas[0]).toMatchObject({ tipo: "grupo", chave: "", nome: "projetos" })
  })
})

describe("busca agrupada: nomes", () => {
  it("o modelo apaga só a parte gerada; nome comum fica igual", () => {
    expect(modeloDoNome("vite.config.ts.timestamp-1777853494596-f71e01b9722f1.mjs")).toBe("vite.config.ts.timestamp-….mjs")
    expect(modeloDoNome("tsconfig.json")).toBe("tsconfig.json")
    expect(modeloDoNome("package-lock.json")).toBe("package-lock.json")
    expect(modeloDoNome("ADR-2024.md")).toBe("ADR-2024.md")
  })

  it("marca o trecho que casou, sem diferenciar maiúscula", () => {
    expect(trechosDoNome("tsconfig.json", "Config")).toEqual([
      { texto: "ts", casou: false },
      { texto: "config", casou: true },
      { texto: ".json", casou: false },
    ])
    expect(trechosDoNome("README.md", "config")).toEqual([{ texto: "README.md", casou: false }])
  })
})
