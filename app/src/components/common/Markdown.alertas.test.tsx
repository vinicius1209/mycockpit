import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Markdown } from "./Markdown"

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />)

describe("alertas do GitHub no fio", () => {
  it("[!NOTE] vira caixa com rótulo em pt-BR, sem o marcador no texto", () => {
    const out = html("> [!NOTE]\n> O cache vive por conversa.")
    expect(out).toContain('role="note"')
    expect(out).toContain("Nota")
    expect(out).toContain("O cache vive por conversa.")
    expect(out).not.toContain("[!NOTE]")
    expect(out).not.toContain("<blockquote")
  })

  it("cada tipo tem o seu rótulo, e nenhum pinta de âmbar ou vermelho", () => {
    const tipos = { TIP: "Dica", IMPORTANT: "Importante", WARNING: "Atenção", CAUTION: "Cuidado" }
    for (const [tipo, rotulo] of Object.entries(tipos)) {
      const out = html(`> [!${tipo}]\n> texto`)
      expect(out).toContain(rotulo)
      expect(out).not.toMatch(/st-warning|st-error|destructive/)
    }
  })

  it("aceita o texto na mesma linha do marcador e em minúsculas", () => {
    const out = html("> [!warning] Isto apaga a branch.")
    expect(out).toContain("Atenção")
    expect(out).toContain("Isto apaga a branch.")
  })

  it("citação comum e marcador desconhecido continuam citação", () => {
    expect(html("> uma citação")).toContain("<blockquote")
    const out = html("> [!NOTA]\n> texto")
    expect(out).toContain("<blockquote")
    expect(out).toContain("[!NOTA]")
  })
})

describe("lista de tarefas no fio", () => {
  const lista = html("- [x] ler o parser\n- [ ] escrever o teste")

  it("a feita sai riscada e esmaecida; a pendente, não", () => {
    expect(lista).toMatch(/<li class="[^"]*line-through[^"]*">.*ler o parser/)
    expect(lista).toMatch(/<li class="list-none">.*escrever o teste/)
  })

  it("a caixinha substitui o checkbox nativo e diz o estado", () => {
    expect(lista).not.toContain("<input")
    expect(lista).toContain('aria-label="feita"')
    expect(lista).toContain('aria-label="a fazer"')
  })

  it("lista comum continua com marcador", () => {
    expect(html("- um\n- dois")).toContain("list-disc")
  })
})
