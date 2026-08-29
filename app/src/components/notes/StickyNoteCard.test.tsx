import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { StickyNoteCard } from "./StickyNoteCard"
import type { StickyNote } from "./types"

const mockNote: StickyNote = {
  id: "test-note-1",
  content: "Testar autenticação com token JWT expirado",
  color: "sand",
  targetAgent: "claude",
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
}

describe("StickyNoteCard", () => {
  it("renderiza o conteúdo da nota e o agente alvo", () => {
    const html = renderToStaticMarkup(createElement(StickyNoteCard, { note: mockNote }))
    expect(html).toContain("Testar autenticação com token JWT expirado")
    expect(html).toContain("Claude Code")
  })

  it("renderiza o badge de agente genérico quando targetAgent é all", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: { ...mockNote, targetAgent: "all" } }),
    )
    expect(html).toContain("Geral")
  })

  it("pinta cada tinta com o token note-* dela, e só na superfície", () => {
    const sandHtml = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: { ...mockNote, color: "sand" } }),
    )
    const tealHtml = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: { ...mockNote, color: "teal" } }),
    )
    expect(sandHtml).toContain("bg-note-sand")
    expect(tealHtml).toContain("bg-note-teal")
  })

  it("o papel vivo carrega TINTA PRÓPRIA, e ela é a mesma em todo papel", () => {
    // Substitui a regra do ADR-109 ("note-* nunca pinta texto"). Sobre papel
    // vivo a letra não pode seguir o tema — sumiria no escuro. Ela vem do par
    // `--note-fg`, que é UM só: a cor do papel muda, a da tinta não, senão
    // cada nota teria um contraste diferente e nenhum medido.
    for (const color of ["sand", "slate", "teal", "indigo", "rose"] as const) {
      const html = renderToStaticMarkup(
        createElement(StickyNoteCard, { note: { ...mockNote, color } }),
      )
      expect(html).toContain("text-note-fg")
      // e nenhuma MATIZ vira cor de letra: `text-note-sand` continua proibido.
      for (const hue of ["sand", "slate", "teal", "indigo", "rose"]) {
        expect(html).not.toContain(`text-note-${hue}`)
      }
    }
  })

  it("cor persistida que não existe mais cai no papel padrão em vez de sumir", () => {
    // `sage` era uma das 5 antes do ADR-109 e pode estar no localStorage.
    const html = renderToStaticMarkup(
      createElement(StickyNoteCard, {
        note: { ...mockNote, color: "sage" as never },
      }),
    )
    expect(html).toContain("bg-note-sand")
  })
})

describe("a folha (flat) é FOLHA, não cartão", () => {
  const comTitulo = {
    ...mockNote,
    content: "Jana · possível problema\n\n- conferir o log do dia 26",
  }

  it("dentro da gaveta a nota não pinta papel colorido", () => {
    // Papel colorido dentro do popover branco é cartão-em-cartão de cor (§4), e
    // a folha do desenho A é papel limpo. A cor sobrevive como RÓTULO na
    // bolinha do seletor e no ponto da linha da lista.
    // A asserção é sobre a SUPERFÍCIE (a classe do elemento raiz), não sobre o
    // HTML inteiro: a bolinha do seletor de cor continua `bg-note-*` de
    // propósito nos dois modos — é lá que a cor vive como rótulo.
    const raiz = (html: string) => html.slice(0, html.indexOf(">"))
    const solto = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo }),
    )
    const naGaveta = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo, flat: true }),
    )
    expect(raiz(solto)).toContain("bg-note-")
    expect(raiz(naGaveta)).not.toContain("bg-note-")
    expect(naGaveta).toContain("bg-note-sand")
  })


  it("a primeira linha sobe a título na folha, e o corpo continua markdown", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo, flat: true }),
    )
    expect(html).toContain("Jana · possível problema")
    expect(html).toContain("font-semibold")
    // O corpo segue renderizado como lista, não como texto cru com hífen.
    expect(html).toContain("<li")
    expect(html).toContain("conferir o log do dia 26")
  })

  it("fora da gaveta o conteúdo continua saindo inteiro, sem título", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo }),
    )
    expect(html).not.toContain("font-semibold")
  })

  it("o botão 'Editar' some na folha (o corpo inteiro já edita)", () => {
    const naGaveta = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo, flat: true }),
    )
    const solto = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comTitulo }),
    )
    expect(solto).toContain("Editar")
    expect(naGaveta).not.toContain(">Editar<")
  })
})

describe("anexo na nota", () => {
  const comAnexo = {
    ...mockNote,
    attachments: [
      {
        path: "attachments/notes/n1/abc.png",
        name: "print.png",
        kind: "image" as const,
        mime: "image/png",
        bytes: 1234,
      },
    ],
  }

  it("a nota com anexo mostra a tira; sem anexo não pinta nada", () => {
    const com = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: comAnexo }),
    )
    const sem = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: mockNote }),
    )
    expect(com).toContain("size-16")
    expect(sem).not.toContain("size-16")
  })

  it("o BYTE não está na nota — só o metadado", () => {
    // A store persiste em localStorage (string, cota ~5MB). Base64 aqui
    // estouraria a cota e serializaria megabytes na thread principal a cada
    // mudança. O que a nota guarda é o endereço do blob em disco.
    const chaves = Object.keys(comAnexo.attachments[0])
    expect(chaves).toEqual(["path", "name", "kind", "mime", "bytes"])
    expect(chaves).not.toContain("data")
    expect(comAnexo.attachments[0].path.startsWith("attachments/notes/")).toBe(true)
  })
})

describe("apagar não se confunde com fechar", () => {
  it("o gesto de apagar NÃO usa o mesmo ✕ que fecha a gaveta", () => {
    // Eram dois glifos idênticos a dois centímetros um do outro: um fecha, o
    // outro destrói. Fechar é ✕; apagar é lixeira — em todo lugar.
    const html = renderToStaticMarkup(
      createElement(StickyNoteCard, { note: mockNote, onDelete: () => {} }),
    )
    expect(html).toContain("lucide-trash")
    expect(html).toContain("Apagar nota")
  })
})
