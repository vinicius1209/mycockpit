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

// ADR-261: o cartão de pedido assenta numa linha de decisão, com ✓ e hora.
describe("a decisão no fio", () => {
  it("leva o ✓ e a hora; o aviso do sistema segue com o alerta e sem hora", () => {
    const ts = new Date(2026, 8, 25, 18, 44).getTime()
    const decisao = renderToStaticMarkup(<AvisoDoFio message="Você ligou o navegador do Maclan." tom="decisao" ts={ts} />)
    expect(decisao).toContain("lucide-check")
    expect(decisao).toContain("18:44")
    const aviso = renderToStaticMarkup(<AvisoDoFio message="Memória alta" ts={ts} />)
    expect(aviso).not.toContain("lucide-check")
    expect(aviso).not.toContain("18:44")
  })
})
