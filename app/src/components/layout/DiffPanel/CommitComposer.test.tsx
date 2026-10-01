import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "@/components/ui/tooltip"
import { CommitComposer } from "./CommitComposer"

function renderComposer(props: React.ComponentProps<typeof CommitComposer>) {
  return renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(CommitComposer, props),
    ),
  )
}

describe("CommitComposer", () => {
  it("prioriza a mensagem e a ação de commit sem expor opções avançadas", () => {
    const html = renderComposer({
      cwd: "/fake",
      stagedCount: 2,
      totalChanges: 5,
      onCommitted: vi.fn(),
    })
    expect(html).toContain("Mensagem do commit")
    expect(html).toContain('aria-label="Sugerir mensagem"')
    expect(html).toContain('aria-label="Mais opções de commit"')
    expect(html).toContain("Criar commit (2)")
    expect(html).not.toContain("0/72")
    expect(html).not.toContain("Retificar o último commit")
  })

  it("renderiza label de commit direto quando não há staged", () => {
    const html = renderComposer({
      cwd: "/fake",
      stagedCount: 0,
      totalChanges: 5,
      onCommitted: vi.fn(),
    })
    expect(html).toContain("Criar commit")
  })

  it("não oferece um commit quando a árvore de trabalho está limpa", () => {
    const html = renderComposer({
      cwd: "/fake",
      stagedCount: 0,
      totalChanges: 0,
      onCommitted: vi.fn(),
    })
    expect(html).toBe("")
  })

  it("aplica escala de fonte e foco sutis para não inflar no desktop", () => {
    const html = renderComposer({
      cwd: "/fake",
      stagedCount: 1,
      totalChanges: 1,
      onCommitted: vi.fn(),
    })
    expect(html).toContain("text-[12px]")
    expect(html).toContain("md:text-[12px]")
    expect(html).toContain("focus-visible:ring-0")
  })
})
