// A linha de sugestões do composer responde à configuração.
//
// O incidente (18/09/2026): com "Modelo helper" em `off` nas Configurações, os
// três chips estáticos continuavam embaixo do composer comendo altura. A
// geração respeitava o desligamento desde sempre (`suggestions.ts`), mas o
// `else` que desenha os chips não tinha como saber — a régua do helper não era
// exportada por ninguém.
//
// Testa o componente PURO: o container lê o store, e sob `renderToStaticMarkup`
// quem lê store direto enxerga só o estado inicial (era o bug que este arquivo
// não conseguiria provar).

import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { LinhaDeSugestoes } from "./ComposerParts"

const render = (p: Parameters<typeof LinhaDeSugestoes>[0]) =>
  renderToStaticMarkup(<LinhaDeSugestoes {...p} />)

const noop = () => {}

describe("LinhaDeSugestoes", () => {
  it("com helper ligado e sem sugestões, oferece os três chips", () => {
    const html = render({
      suggesting: false,
      suggestions: [],
      onPick: noop,
      temHelper: true,
    })
    expect(html).toContain("Explicar o projeto")
    expect(html).toContain("Rodar os testes")
    expect(html).toContain("Criar uma branch")
  })

  it("com o helper desligado não desenha NADA, nem o container", () => {
    const html = render({
      suggesting: false,
      suggestions: [],
      onPick: noop,
      temHelper: false,
    })
    // string vazia, não `<div></div>`: div vazia com `gap` ainda ocuparia altura
    // no flex do composer, que é exatamente a queixa.
    expect(html).toBe("")
  })

  it("sugestão já entregue continua na tela se o helper for desligado depois", () => {
    const html = render({
      suggesting: false,
      suggestions: ["Rodar os testes do watchdog"],
      onPick: noop,
      temHelper: false,
    })
    expect(html).toContain("Rodar os testes do watchdog")
    expect(html).not.toContain("Explicar o projeto")
  })

  it("com helper ligado e buscando, mostra o estado de atividade", () => {
    const html = render({
      suggesting: true,
      suggestions: [],
      onPick: noop,
      temHelper: true,
    })
    expect(html).toContain("buscando sugestões…")
    expect(html).not.toContain("Explicar o projeto")
  })

  it("desligado nunca mostra 'buscando' (não há o que buscar)", () => {
    const html = render({
      suggesting: true,
      suggestions: [],
      onPick: noop,
      temHelper: false,
    })
    expect(html).toBe("")
  })
})
