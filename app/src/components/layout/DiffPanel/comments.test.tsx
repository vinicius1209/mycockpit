// Comentário inline no diff: âncora por IDENTIDADE (não por posição) e as 3
// fases do slot (gatilho, badge salvo, textarea ativa). Render via
// renderToStaticMarkup com um DiffCommentApi FAKE — o repo não tem jsdom,
// então o que se testa é o RENDER por estado, não o clique.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DiffLineRow, anchorOf, type DiffCommentApi } from "./comments"
import type { DiffLine } from "@/lib/git"
import type { DiffComment } from "@/lib/deliveryDiff"

function api(over: Partial<DiffCommentApi> = {}): DiffCommentApi {
  return {
    comments: {},
    activeKey: null,
    draftNote: "",
    setDraftNote: vi.fn(),
    open: vi.fn(),
    cancel: vi.fn(),
    submit: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    ...over,
  }
}

const ADD: DiffLine = { type: "add", oldNo: null, newNo: 42, text: "const x = 1" }
const DEL: DiffLine = { type: "del", oldNo: 7, newNo: null, text: "const y = 2" }

function commentFor(ln: DiffLine, over: Partial<DiffComment> = {}): DiffComment {
  const { key, side, lineNo } = anchorOf("a.ts", ln)
  return {
    id: key,
    path: "a.ts",
    side,
    lineNo,
    codeText: ln.text,
    note: "isso aqui tá errado",
    ...over,
  }
}

describe("anchorOf — identidade, não posição", () => {
  it("linha adicionada ancora no lado NOVO", () => {
    expect(anchorOf("a.ts", ADD)).toEqual({
      key: "a.ts@new:42",
      side: "new",
      lineNo: 42,
    })
  })

  it("linha deletada ancora no lado ANTIGO (a nova não existe)", () => {
    expect(anchorOf("a.ts", DEL)).toEqual({
      key: "a.ts@old:7",
      side: "old",
      lineNo: 7,
    })
  })

  it("add e del com o MESMO número não colidem (lados diferentes)", () => {
    const add: DiffLine = { type: "add", oldNo: null, newNo: 9, text: "x" }
    const del: DiffLine = { type: "del", oldNo: 9, newNo: null, text: "x" }
    expect(anchorOf("a.ts", add).key).not.toBe(anchorOf("a.ts", del).key)
  })

  it("a chave NÃO depende de índice de hunk/linha (era o bug da deriva)", () => {
    // mesma linha, dois recortes de hunk diferentes → mesma âncora.
    expect(anchorOf("a.ts", ADD).key).toBe(anchorOf("a.ts", { ...ADD }).key)
  })

  it("arquivos diferentes nunca compartilham âncora", () => {
    expect(anchorOf("a.ts", ADD).key).not.toBe(anchorOf("b.ts", ADD).key)
  })
})

describe("DiffLineRow — as 3 fases do slot", () => {
  it("sem comentário e sem foco: só o gatilho", () => {
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, { ln: ADD, path: "a.ts", api: api() }),
    )
    expect(html).toContain("Comentar esta linha")
    expect(html).not.toContain("<textarea")
    expect(html).not.toContain("Remover comentário")
  })

  it("com comentário salvo: mostra o badge com a nota", () => {
    const c = commentFor(ADD)
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, {
        ln: ADD,
        path: "a.ts",
        api: api({ comments: { [c.id]: c } }),
      }),
    )
    expect(html).toContain("isso aqui tá errado")
    expect(html).toContain("Remover comentário")
  })

  it("MESMA âncora, texto DIFERENTE: não desenha o badge (vira órfão)", () => {
    // O agente reescreveu a linha 42; o comentário não pode colar aqui.
    const c = commentFor(ADD, { codeText: "const x = 999 // outro código" })
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, {
        ln: ADD,
        path: "a.ts",
        api: api({ comments: { [c.id]: c } }),
      }),
    )
    expect(html).not.toContain("isso aqui tá errado")
    expect(html).not.toContain("Remover comentário")
  })

  it("linha ATIVA mostra a textarea e esconde o badge", () => {
    const c = commentFor(ADD, { note: "nota antiga" })
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, {
        ln: ADD,
        path: "a.ts",
        api: api({
          comments: { [c.id]: c },
          activeKey: c.id,
          draftNote: "editando…",
        }),
      }),
    )
    expect(html).toContain("<textarea")
    expect(html).toContain("editando…")
    expect(html).not.toContain("Remover comentário")
  })

  it("código da linha possui data-selectable e select-text para seleção nativa", () => {
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, { ln: ADD, path: "a.ts", api: api() }),
    )
    expect(html).toContain("data-selectable")
    expect(html).toContain("select-text")
    expect(html).toContain("const x = 1")
  })

  it("números de linha e marcadores possuem select-none para não poluir a cópia", () => {
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, { ln: ADD, path: "a.ts", api: api() }),
    )
    expect(html).toContain("select-none")
  })

  it("aplica classes de highlight hljs quando lang é fornecido", () => {
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, {
        ln: ADD,
        path: "a.ts",
        lang: "typescript",
        api: api(),
      }),
    )
    expect(html).toContain("hljs-keyword")
    expect(html).toContain("const")
    expect(html).toContain("hljs-number")
  })

  it("renderiza botão de copiar linha no hover", () => {
    const html = renderToStaticMarkup(
      createElement(DiffLineRow, { ln: ADD, path: "a.ts", api: api() }),
    )
    expect(html).toContain("Copiar linha")
  })
})
