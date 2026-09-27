// A cor do editor parte do mesmo mapa de extensão do visualizador estático.
import { describe, expect, it } from "vitest"
import { pacoteDaLinguagem } from "./linguagens"

describe("qual linguagem colore o arquivo", () => {
  it("usa o mapa do visualizador, com TSX e JSX separados", () => {
    expect(pacoteDaLinguagem("app/src/lib/db/schema.ts")).toEqual({ pacote: "javascript", typescript: true, jsx: false })
    expect(pacoteDaLinguagem("app/src/components/layout/FileTab.tsx")).toEqual({
      pacote: "javascript",
      typescript: true,
      jsx: true,
    })
    expect(pacoteDaLinguagem("scripts/check-marca.mjs")).toEqual({ pacote: "javascript", typescript: false, jsx: false })
    expect(pacoteDaLinguagem("app/src-tauri/src/edicao.rs")).toEqual({ pacote: "rust" })
    expect(pacoteDaLinguagem("docs/decisions.md")).toEqual({ pacote: "markdown" })
    expect(pacoteDaLinguagem("app/package.json")).toEqual({ pacote: "json" })
    expect(pacoteDaLinguagem("app/index.html")).toEqual({ pacote: "html" })
  })

  it("o que não tem pacote abre como texto puro", () => {
    expect(pacoteDaLinguagem("app/src-tauri/Cargo.toml")).toBeNull()
    expect(pacoteDaLinguagem("Makefile")).toBeNull()
    // xml e svg têm cor no estático (hljs), mas não pacote no editor
    expect(pacoteDaLinguagem("icone.svg")).toBeNull()
  })
})
