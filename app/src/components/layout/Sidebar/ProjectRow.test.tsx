// A barra lateral enxuta (ADR-245, mock docs/mocks/barra-lateral-hierarquia.html).
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProjectRow } from "./ProjectRow"
import { Ladrilho } from "@/components/ui/ladrilho"
import type { Project } from "@/lib/types"

const projeto = { id: "p1", name: "Landing Prime", path: "/repo/landing", color: "#3fcf8e" } as Project

const linha = (over: Partial<Parameters<typeof ProjectRow>[0]> = {}) =>
  renderToStaticMarkup(
    <ProjectRow
      project={projeto}
      active={false}
      expanded={false}
      status="idle"
      canMoveUp={false}
      canMoveDown={false}
      onSelect={() => {}}
      onToggle={() => {}}
      onDelete={() => {}}
      onNovaConversa={() => {}}
      {...over}
    />,
  )

describe("linha do projeto", () => {
  it("a cor é sua e vira a marca; a pasta tingida saiu", () => {
    const html = linha()
    expect(html).toContain("background:#3fcf8e")
    expect(html).not.toContain("lucide-folder")
  })

  it("estado é palavra na direita: rodando em azul, e 'pede você' vence rodando", () => {
    expect(linha({ status: "running" })).toMatch(/text-st-running[^"]*">.*rodando/)
    const pede = linha({ status: "running", awaiting: true })
    expect(pede).toContain("pede você")
    expect(pede).not.toContain(">rodando<")
  })

  it("o ativo é peso, sem fundo: o fundo de seleção é da conversa", () => {
    const html = linha({ active: true })
    expect(html).toContain("font-semibold text-foreground")
    // `bg-sel` solto (o `hover:bg-sel` dos botões da linha é outra coisa)
    expect(html).not.toMatch(/class="(?:[^"]*\s)?bg-sel(?:\s|")/)
  })

  it("nova conversa é o '+' da própria linha, não uma linha 'Nova tarefa'", () => {
    const html = linha()
    expect(html).toContain('aria-label="Nova conversa em Landing Prime"')
    expect(html).not.toContain("Nova tarefa")
  })
})

describe("ladrilho da navegação global", () => {
  it("ícone, nome curto, nome inteiro no hover e contador no canto", () => {
    const html = renderToStaticMarkup(
      <Ladrilho icone={<svg />} rotulo="Planos" titulo="Abrir Planos de voo" contador={3} onClick={() => {}} />,
    )
    expect(html).toContain(">Planos<")
    expect(html).toContain('title="Abrir Planos de voo"')
    expect(html).toContain(">3<")
  })

  it("contador zero some, e o ativo diz aria-current", () => {
    const html = renderToStaticMarkup(
      <Ladrilho icone={<svg />} rotulo="Frota" titulo="Abrir Frota" contador={0} ativo onClick={() => {}} />,
    )
    expect(html).not.toContain(">0<")
    expect(html).toContain('aria-current="page"')
  })
})
