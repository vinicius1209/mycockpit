import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AvisoDoFio } from "./AvisoDoFio"

// A mensagem com a forma exata de `format_memory_warning_message` (Rust).
const MEMORIA =
  "Este turno está usando 2,3 GB de memória · se não for intencional, o Parar do composer interrompe.\n" +
  "2,0 GB em comandos e compiladores filhos; 286 MB no processo principal. Sem teto artificial."

describe("aviso do fio (ADR-249)", () => {
  it("mostra só o resumo; o detalhe vai para o hover", () => {
    const html = renderToStaticMarkup(<AvisoDoFio message={MEMORIA} />)
    expect(html).toContain("Este turno está usando 2,3 GB de memória")
    expect(html).toContain('title="2,0 GB em comandos e compiladores filhos; 286 MB no processo principal. Sem teto artificial."')
    expect(html).toContain(">(detalhe)<")
  })

  it("número e unidade seguem ligados por espaço inquebrável", () => {
    expect(renderToStaticMarkup(<AvisoDoFio message={MEMORIA} />)).not.toContain("2,3 GB")
  })

  it("aviso de uma linha só segue igual, sem '(detalhe)'", () => {
    const html = renderToStaticMarkup(<AvisoDoFio message="contexto acabando" />)
    expect(html).toContain("contexto acabando")
    expect(html).not.toContain("(detalhe)")
  })
})
