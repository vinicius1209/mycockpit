import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Markdown } from "./Markdown"

// Mock de Tauri APIs e stores
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => {}),
  revealItemInDir: vi.fn(async () => {}),
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {}),
}))

vi.mock("@/store/app", () => ({
  useActiveProject: vi.fn(() => ({
    id: "p1",
    name: "MyCockpit",
    path: "/Users/vinicius/projetos/mycockpit",
  })),
  useApp: Object.assign(
    vi.fn((selector) =>
      selector({
        activeProjectId: "p1",
        projects: [{ id: "p1", path: "/Users/vinicius/projetos/mycockpit" }],
        settings: { preferredEditor: "vscode" },
      }),
    ),
    {
      getState: () => ({
        activeProjectId: "p1",
        projects: [{ id: "p1", path: "/Users/vinicius/projetos/mycockpit" }],
        settings: { preferredEditor: "vscode" },
      }),
    },
  ),
}))

vi.mock("@/store/editors", () => ({
  useEditors: Object.assign(
    vi.fn((selector) =>
      selector({
        detected: [{ id: "vscode", label: "VS Code" }],
        ensure: vi.fn(),
      }),
    ),
    {
      getState: () => ({
        detected: [{ id: "vscode", label: "VS Code" }],
        ensure: vi.fn(),
      }),
    },
  ),
}))

describe("Markdown Component", () => {
  it("abre a saída real do Maclan sem parser, com a linha inteira e o resto formatado", () => {
    const linha = Object.values(import.meta.glob("../../test/maclan-test-output.txt", {
      query: "?raw", import: "default", eager: true,
    }))[0] as string
    const text = `# Testes\n\n${linha}\n\n**45 testes passando.**`
    const html = renderToStaticMarkup(<Markdown text={text} />)
    // A linha patológica sai como texto cru, mas SAI: nada de paginar nem cortar.
    expect(html).toContain("data-plain-text")
    expect(html).toContain(linha)
    expect(html).not.toContain("Próxima parte")
    // E o que está em volta dela continua sendo Markdown de verdade.
    expect(html).toContain(">Testes<")
    expect(html).toMatch(/<strong[^>]*>45 testes passando\.<\/strong>/)
  })

  it("mensagem longa e normal sai formatada, sem virar texto cru", () => {
    const text = "## Parte\n\nTexto com `código`.\n\n```ts\nconst a = 1\n```\n".repeat(400)
    const html = renderToStaticMarkup(<Markdown text={text} />)
    expect(text.length).toBeGreaterThan(16_384)
    expect(html).not.toContain("data-plain-text")
    expect(html).toContain("hljs")
  })

  it("renderiza texto simples sem atributos de arquivo", () => {
    const html = renderToStaticMarkup(<Markdown text="Olá mundo" />)
    expect(html).toContain("Olá mundo")
    expect(html).not.toContain("data-ctx-arquivo")
  })

  it("renderiza links file:// com atributos contextuais de arquivo e tooltip", () => {
    const text =
      "Veja [cacheDoTurno.ts](file:///Users/vinicius/projetos/mycockpit/src/lib/cacheDoTurno.ts#L42)"
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).toContain('data-ctx-arquivo="src/lib/cacheDoTurno.ts"')
    expect(html).toContain('data-ctx-arquivo-linha="42"')
    // o clique abre numa aba do Frota, a mesma do explorador (não no editor externo)
    expect(html).toContain('title="Abrir src/lib/cacheDoTurno.ts numa aba"')
    expect(html).toContain("cacheDoTurno.ts")
  })

  it("renderiza links web normais sem atributo de arquivo", () => {
    const text = "Veja a [documentação](https://mycockpit.dev/docs)"
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).toContain('href="https://mycockpit.dev/docs"')
    expect(html).not.toContain("data-ctx-arquivo")
    expect(html).toContain('title="Abrir https://mycockpit.dev/docs no navegador"')
  })

  it("reconhece código inline de arquivo e adiciona atributos e estilo de chip", () => {
    const text = "O arquivo `src/lib/agents.ts:15` cuida disso."
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).toContain('data-ctx-arquivo="src/lib/agents.ts"')
    expect(html).toContain('data-ctx-arquivo-linha="15"')
    expect(html).toContain('title="Abrir src/lib/agents.ts numa aba"')
    expect(html).toContain("text-brass")
  })

  it("não marca código inline de comandos ou sintaxe como arquivo", () => {
    const text = "Use `sessionResume: true` ou `claude --resume` para continuar."
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).not.toContain("data-ctx-arquivo")
    expect(html).toContain("sessionResume: true")
    expect(html).toContain("claude --resume")
  })

  it("renderiza negrito como formatação semântica pura sem ação de arquivo", () => {
    const text = "**mitigar e mitigar de forma cirúrgica essa penalidade**"
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).toContain("<strong")
    expect(html).toContain("mitigar e mitigar de forma cirúrgica essa penalidade")
    expect(html).not.toContain("data-ctx-arquivo")
  })
})
