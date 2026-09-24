import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FileIcon, iconeDoArquivo } from "@/components/ui/file-icon"

describe("iconeDoArquivo", () => {
  it.each([
    // os arquivos do turno real de 23/09 (sessão b6cd7444)
    ["app/src-tauri/src/sources.rs", "rust"],
    ["app/src-tauri/tauri.conf.json", "brackets-yellow"],
    ["app/src/components/chat/MiniaturasDoFio.tsx", "react-ts"],
    ["docs/mocks/fio-de-trabalho-zeron.html", "code-orange"],
    ["docs/competitors-zeron.md", "markdown"],
    ["app/package.json", "node"],
    ["app/src-tauri/Cargo.toml", "rust"],
    ["app/vite.config.ts", "vite"],
    ["video.mp4", "video"],
    ["Makefile", "document"],
  ])("%s → %s", (caminho, id) => {
    expect(iconeDoArquivo(caminho)).toBe(id)
  })

  it("pasta é pasta, qualquer que seja o nome", () => {
    expect(iconeDoArquivo("src.rs", true)).toBe("folder")
  })
})

describe("FileIcon", () => {
  it("pinta os dois temas e deixa o CSS escolher, com o escuro clareado", () => {
    const html = renderToStaticMarkup(createElement(FileIcon, { path: "Hero.tsx" }))
    expect(html).toContain('data-file-icon="react-ts"')
    expect(html).toContain("dark:hidden")
    expect(html).toContain("hidden dark:inline-flex")
    // o azul do React sobe de luz no escuro, sem trocar de matiz
    expect(html).toContain("#2563EB")
    expect(html).toContain("#60A5FA")
  })

  it("é decorativo: o nome do arquivo está ao lado, o ícone não fala", () => {
    const html = renderToStaticMarkup(createElement(FileIcon, { path: "a.ts" }))
    expect(html).toContain('aria-hidden="true"')
  })
})
