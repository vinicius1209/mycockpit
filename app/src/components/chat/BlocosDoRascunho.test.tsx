import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("@/lib/db/conversationDrafts", () => ({
  loadComposerDraft: vi.fn(async () => null),
  saveComposerDraft: vi.fn(async () => {}),
  deleteComposerDraft: vi.fn(async () => {}),
}))

import { BlocosDoRascunho } from "./BlocosDoRascunho"
import type { BlocoDoRascunho } from "@/lib/citacao"

const marcacao: BlocoDoRascunho = {
  tipo: "marcacao",
  id: "m1",
  pagina: "Google",
  url: "https://www.google.com/",
  largura: 529,
  altura: 241,
  descricao: 'Marquei uma região na página "Google" (https://www.google.com/), viewport 1200×762: x 425, y 113, 529×241 px.',
}

describe("blocos do rascunho", () => {
  it("a região marcada aparece como pílula, não como descrição solta", () => {
    const html = renderToStaticMarkup(<BlocosDoRascunho convId="c1" blocos={[marcacao]} />)
    expect(html).toContain("Região · Google · 529×241")
    expect(html).not.toContain("Elementos na região")
    expect(html).toContain("Remover marcação")
  })
})
