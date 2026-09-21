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
    name: "Frota",
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

// A miniatura real lê o disco num efeito, que não roda no SSR. O dublê expõe o
// que importa aqui: QUAL caminho o markdown resolveu e contra qual raiz.
vi.mock("@/components/common/ImagemCitadaThumb", () => ({
  ImagemCitadaThumb: ({ root, path }: { root: string; path: string }) => (
    <span data-miniatura={path} data-raiz={root} />
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

  describe("imagem citada, nas formas em que cada motor escreve", () => {
    const raiz = "/Users/vinicius/projetos/mycockpit"
    const miniatura = (path: string) =>
      `data-miniatura="${path}" data-raiz="${raiz}"`

    it("caminho absoluto do brain do Agy vira miniatura, nunca <img> cru", () => {
      // Payload real da conversa do Maclan: sintaxe de IMAGEM, caminho absoluto
      // fora do projeto. Saía como moldura quebrada com "?".
      const caminho =
        "/Users/viniciusmachado/.gemini/antigravity-cli/brain/01238a7c-7997-4fad-b5ad-1cceefda5549/screenshots/menu-admin-desktop.png"
      const html = renderToStaticMarkup(
        <Markdown text={`> Topo fixo com os 3 itens.\n![Menu Administrador](${caminho})`} />,
      )
      expect(html).not.toContain("<img")
      expect(html).toContain(miniatura(caminho))
    })

    it.each([
      ["absoluto dentro do projeto", `${raiz}/docs/evidence/a.png`, `${raiz}/docs/evidence/a.png`],
      ["relativo à raiz", "docs/evidence/a.png", "docs/evidence/a.png"],
      ["relativo com ./", "./docs/evidence/a.png", "docs/evidence/a.png"],
      ["nome solto", "a.png", "a.png"],
      ["file://", `file://${raiz}/docs/a.png`, `${raiz}/docs/a.png`],
      ["file:// com %20", `file://${raiz}/docs/a%20b.png`, `${raiz}/docs/a b.png`],
      ["espaço escrito como %20", "docs/minha%20captura.png", "docs/minha captura.png"],
      ["espaço na forma <...>", "<docs/minha captura.png>", "docs/minha captura.png"],
      ["acento no nome", "docs/evidência.png", "docs/evidência.png"],
      ["til da home", "~/.gemini/antigravity-cli/brain/x/a.png", "~/.gemini/antigravity-cli/brain/x/a.png"],
      ["query de README", "docs/a.png?raw=true", "docs/a.png"],
      ["extensão maiúscula", "docs/A.PNG", "docs/A.PNG"],
      ["com título", 'docs/a.png "Tela inicial"', "docs/a.png"],
    ])("%s", (_nome, escrito, lido) => {
      const html = renderToStaticMarkup(<Markdown text={`![captura](${escrito})`} />)
      expect(html).not.toContain("<img")
      expect(html).toContain(miniatura(lido))
    })

    it.each(["/tmp/shot.png", "/var/folders/ab/T/shot.png", "/Users/vinicius/.codex/shots/shot.png"])(
      "imagem onde o Frota não lê (%s) diz isso, sem <img> e sem miniatura",
      (escrito) => {
        const html = renderToStaticMarkup(<Markdown text={`![captura](${escrito})`} />)
        expect(html).not.toContain("<img")
        expect(html).not.toContain("data-miniatura")
        expect(html).toContain("imagem fora das pastas que o Frota lê · shot.png")
      },
    )

    it("destino que não é imagem nem caminho legível mostra só o texto alternativo", () => {
      const html = renderToStaticMarkup(
        <Markdown text="![gráfico](data:image/png;base64,iVBORw0KGgo=) e ![segredo](/etc/passwd)" />,
      )
      expect(html).not.toContain("<img")
      expect(html).not.toContain("data-miniatura")
      expect(html).toContain("gráfico")
      expect(html).toContain("segredo")
    })

    it("imagem da web segue sendo <img>", () => {
      const html = renderToStaticMarkup(<Markdown text="![logo](https://frota.dev/logo.png)" />)
      expect(html).toContain('src="https://frota.dev/logo.png"')
    })

    it("link para arquivo com acento e espaço resolve o nome do disco", () => {
      const html = renderToStaticMarkup(
        <Markdown text="Veja [a captura](<docs/evidência final.png>)" />,
      )
      expect(html).toContain('data-ctx-arquivo="docs/evidência final.png"')
      expect(html).toContain(miniatura("docs/evidência final.png"))
    })
  })

  it("renderiza negrito como formatação semântica pura sem ação de arquivo", () => {
    const text = "**mitigar e mitigar de forma cirúrgica essa penalidade**"
    const html = renderToStaticMarkup(<Markdown text={text} />)

    expect(html).toContain("<strong")
    expect(html).toContain("mitigar e mitigar de forma cirúrgica essa penalidade")
    expect(html).not.toContain("data-ctx-arquivo")
  })
})
