import { describe, expect, it } from "vitest"
import { detectLanguage, escapeHtml, highlightDiffLine } from "./syntaxHighlight"

describe("detectLanguage", () => {
  it("detecta arquivos typescript e react", () => {
    expect(detectLanguage("src/components/chat/MessageList.tsx")).toBe("typescript")
    expect(detectLanguage("src/lib/git.ts")).toBe("typescript")
  })

  it("detecta rust, python e html", () => {
    expect(detectLanguage("src-tauri/src/main.rs")).toBe("rust")
    expect(detectLanguage("scripts/test.py")).toBe("python")
    expect(detectLanguage("index.html")).toBe("xml")
  })

  it("detecta css, json e toml", () => {
    expect(detectLanguage("src/index.css")).toBe("css")
    expect(detectLanguage("package.json")).toBe("json")
    expect(detectLanguage(".mycockpit/config.toml")).toBe("toml")
  })

  it("retorna null para arquivos sem extensão", () => {
    expect(detectLanguage("Makefile")).toBeNull()
    expect(detectLanguage("LICENSE")).toBeNull()
  })

  it("retorna null para extensões desconhecidas", () => {
    expect(detectLanguage("arquivo.xyz123")).toBeNull()
  })
})

describe("escapeHtml", () => {
  it("escapa caracteres especiais de HTML com segurança", () => {
    expect(escapeHtml("<div>&copy; 'teste' \"aspas\"</div>")).toBe(
      "&lt;div&gt;&amp;copy; 'teste' &quot;aspas&quot;&lt;/div&gt;",
    )
  })
})

describe("highlightDiffLine", () => {
  it("retorna string vazia para linha vazia", () => {
    expect(highlightDiffLine("", "typescript")).toBe("")
  })

  it("escapa texto puro quando linguagem for nula", () => {
    expect(highlightDiffLine("<div>teste</div>", null)).toBe("&lt;div&gt;teste&lt;/div&gt;")
  })

  it("produz tokens hljs para código TypeScript válido", () => {
    const html = highlightDiffLine("const x: number = 42;", "typescript")
    expect(html).toContain("hljs-keyword")
    expect(html).toContain("const")
    expect(html).toContain("hljs-number")
    expect(html).toContain("42")
  })

  it("produz tokens hljs para código Rust válido", () => {
    const html = highlightDiffLine("pub fn run() -> Result<()> {", "rust")
    expect(html).toContain("hljs-keyword")
    expect(html).toContain("fn")
  })

  it("produz tokens hljs para tags HTML/XML", () => {
    const html = highlightDiffLine("<title>Frota ADE</title>", "xml")
    expect(html).toContain("hljs-tag")
    expect(html).toContain("title")
  })

  it("faz fallback gracioso se linguagem não for suportada", () => {
    const html = highlightDiffLine("alguma linha de código", "linguagem_inexistente")
    expect(html).toBe("alguma linha de código")
  })
})
