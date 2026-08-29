import { describe, expect, it } from "vitest"
import {
  formatFileTooltip,
  isFileMention,
  isWebUrl,
  parseFileTarget,
} from "./fileLink"

describe("isWebUrl", () => {
  it("reconhece URLs http e https", () => {
    expect(isWebUrl("https://github.com")).toBe(true)
    expect(isWebUrl("http://localhost:3000/api")).toBe(true)
    expect(isWebUrl("HTTPS://DOCS.RS")).toBe(true)
  })

  it("não confunde file://, caminhos relativos ou vazios com URL web", () => {
    expect(isWebUrl("file:///home/user/code/app.ts")).toBe(false)
    expect(isWebUrl("src/lib/agents.ts")).toBe(false)
    expect(isWebUrl("")).toBe(false)
    expect(isWebUrl(null)).toBe(false)
  })
})

describe("parseFileTarget", () => {
  const PROJETO = "/Users/vinicius/projetos/mycockpit"

  it("extrai caminho relativo e linha a partir de URI file:// com #L10-L20", () => {
    const alvo = parseFileTarget(
      "file:///Users/vinicius/projetos/mycockpit/src/lib/agents.ts#L10-L20",
      PROJETO,
    )
    expect(alvo).toEqual({
      rel: "src/lib/agents.ts",
      abs: "/Users/vinicius/projetos/mycockpit/src/lib/agents.ts",
      line: 10,
    })
  })

  it("decodifica espaços codificados na URI file:// (%20)", () => {
    const projComEspaco = "/Users/vinicius machado/projetos/mycockpit"
    const alvo = parseFileTarget(
      "file:///Users/vinicius%20machado/projetos/mycockpit/src/components/chat/ChatPanel.tsx#L42",
      projComEspaco,
    )
    expect(alvo).toEqual({
      rel: "src/components/chat/ChatPanel.tsx",
      abs: "/Users/vinicius machado/projetos/mycockpit/src/components/chat/ChatPanel.tsx",
      line: 42,
    })
  })

  it("extrai linha no formato posicional :linha", () => {
    const alvo = parseFileTarget("src/lib/agents.ts:15")
    expect(alvo).toEqual({
      rel: "src/lib/agents.ts",
      abs: undefined,
      line: 15,
    })
  })

  it("trata arquivo simples sem linha", () => {
    const alvo = parseFileTarget("cacheDoTurno.ts")
    expect(alvo).toEqual({
      rel: "cacheDoTurno.ts",
      abs: undefined,
      line: null,
    })
  })

  it("remove prefixo ./ e barras repetidas", () => {
    const alvo = parseFileTarget("./src//lib/utils.ts")
    expect(alvo).toEqual({
      rel: "src/lib/utils.ts",
      abs: undefined,
      line: null,
    })
  })

  it("retorna null para URLs web e valores vazios", () => {
    expect(parseFileTarget("https://google.com")).toBeNull()
    expect(parseFileTarget("")).toBeNull()
    expect(parseFileTarget(null)).toBeNull()
  })

  it("recusa caminho absoluto FORA do projeto em vez de fingir que é de dentro", () => {
    // Antes virava `rel: "etc/passwd"` e o editor ia atrás de um fantasma
    // dentro do projeto, enquanto "Mostrar na pasta" revelava o arquivo real.
    expect(parseFileTarget("file:///etc/passwd", PROJETO)).toBeNull()
    expect(parseFileTarget("/Users/vinicius/outro/app.ts", PROJETO)).toBeNull()
  })

  it("respeita a fronteira de pasta: /proj não contém /proj-old", () => {
    expect(parseFileTarget(`${PROJETO}-old/src/a.ts`, PROJETO)).toBeNull()
    expect(parseFileTarget(`${PROJETO}/src/a.ts`, PROJETO)).toEqual({
      rel: "src/a.ts",
      abs: `${PROJETO}/src/a.ts`,
      line: null,
    })
  })

  it("sem projeto ativo não há como situar um caminho absoluto", () => {
    expect(parseFileTarget("/Users/vinicius/proj/src/a.ts")).toBeNull()
  })
})

describe("isFileMention", () => {
  it("identifica arquivos de código com extensão conhecida", () => {
    expect(isFileMention("cacheDoTurno.ts")).toBe(true)
    expect(isFileMention("src/lib/agents.ts")).toBe(true)
    expect(isFileMention("ChatPanel.tsx:42")).toBe(true)
    expect(isFileMention("editor.rs#L182")).toBe(true)
    expect(isFileMention("package.json")).toBe(true)
    expect(isFileMention("Cargo.toml")).toBe(true)
    expect(isFileMention(".gitignore")).toBe(true)
    expect(isFileMention("Dockerfile")).toBe(true)
  })

  it("rejeita comandos CLI, expressões lógicas, opções e textos comuns", () => {
    expect(isFileMention("claude --resume")).toBe(false)
    expect(isFileMention("sessionResume: true")).toBe(false)
    expect(isFileMention("=== 0")).toBe(false)
    expect(isFileMention("() => {}")).toBe(false)
    expect(isFileMention("10x mais caro")).toBe(false)
    expect(isFileMention("--help")).toBe(false)
    expect(isFileMention("const x = 1;")).toBe(false)
    expect(isFileMention("")).toBe(false)
    expect(isFileMention(null)).toBe(false)
  })

  it("não confunde acesso a propriedade com arquivo (`env` só existe como nome exato)", () => {
    expect(isFileMention("process.env")).toBe(false)
    expect(isFileMention("import.meta.env")).toBe(false)
    // O arquivo de verdade continua valendo — está nos nomes exatos.
    expect(isFileMention(".env")).toBe(true)
    expect(isFileMention(".env.local")).toBe(true)
  })

  it("extensão ambígua exige caminho junto: `Next.js` não é arquivo, `scripts/core.js` é", () => {
    expect(isFileMention("Next.js")).toBe(false)
    expect(isFileMention("node.js")).toBe(false)
    expect(isFileMention("React.js")).toBe(false)
    expect(isFileMention("this.h")).toBe(false)
    expect(isFileMention("state.c")).toBe(false)
    expect(isFileMention("a.b.c")).toBe(false)

    expect(isFileMention("scripts/core.js")).toBe(true)
    expect(isFileMention("src/ffi/bridge.h")).toBe(true)
    // Nome exato dispensa o caminho.
    expect(isFileMention("tailwind.config.js")).toBe(true)
  })
})

describe("formatFileTooltip", () => {
  it("monta o texto informativo com editor e linha", () => {
    expect(formatFileTooltip("cacheDoTurno.ts", 42, "VS Code")).toBe(
      "Abrir cacheDoTurno.ts no VS Code (linha 42)",
    )
  })

  it("monta o texto sem linha e com fallback para editor genérico", () => {
    expect(formatFileTooltip("cacheDoTurno.ts", null, null)).toBe(
      "Abrir cacheDoTurno.ts no editor",
    )
  })
})
