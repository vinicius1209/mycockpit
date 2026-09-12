import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { NoDoFio } from "@/components/chat/NoDoFio"
import { DivisorNovasMensagens } from "@/components/chat/DivisorNovasMensagens"

// Carimbo REAL da resposta que veio depois do corte de 09/09/2026.
const NASCEU = 1_788_962_266_442

afterEach(() => {
  vi.useRealTimers()
})

function no(ts: number | undefined, agora: number, revelado?: string): string {
  vi.useFakeTimers()
  vi.setSystemTime(agora)
  return renderToStaticMarkup(
    <NoDoFio ids={["t-resposta"]} revelado={revelado} ts={ts}>
      Consigo. Vou consultar produção em modo somente leitura.
    </NoDoFio>,
  )
}

describe("NoDoFio", () => {
  it("nó que acabou de nascer acende", () => {
    expect(no(NASCEU, NASCEU + 60)).toContain("fio-nasce")
  })

  it("nó relido depois (reabrir, rolar) chega pronto", () => {
    expect(no(NASCEU, NASCEU + 86_400_000)).not.toContain("fio-nasce")
  })

  it("sem ts (1º nó do grupo, ação, plano) não anima: a chegada é de outro", () => {
    expect(no(undefined, NASCEU)).not.toContain("fio-nasce")
  })

  it("preserva a âncora de revelação que a aba Conversa usa", () => {
    const html = no(NASCEU, NASCEU + 86_400_000, "t-resposta")
    expect(html).toContain('data-chat-item-ids="t-resposta"')
    expect(html).toContain("bg-brass-soft")
  })
})

describe("DivisorNovasMensagens", () => {
  it("é a peça que se desenha ao abrir: filetes riscam, rótulo acende", () => {
    const html = renderToStaticMarkup(<DivisorNovasMensagens />)
    expect(html.match(/fio-risca/g)).toHaveLength(2)
    expect(html).toContain('role="separator"')
    expect(html).toContain("novas mensagens")
  })
})
