import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { GrupoDeProcessos } from "./ArvoreDeProcessos"
import type { ProcessoNaArvore } from "@/lib/maquina"

const proc = (pid: number, profundidade: number, papel: ProcessoNaArvore["papel"], nome: string): ProcessoNaArvore => ({
  pid,
  profundidade,
  papel,
  nome,
  executor: null,
  comando: nome,
  rssMb: 100,
  cpuPct: 1,
  tempoS: 60,
})

// ADR-263: o turno no painel da máquina, fechado, diz quanto pesa e quantos
// processos tem, e abre com um botão acessível.
describe("o grupo de processos", () => {
  it("fechado: título, memória, contagem, a ação do grupo e o botão que abre", () => {
    const h = renderToStaticMarkup(
      <GrupoDeProcessos
        titulo="Frota · Seria muito legal"
        mb={1_434}
        processos={[proc(1, 0, "motor", "claude"), proc(2, 1, "mcp", "hostinger-api-mcp")]}
        rotuloDaRaiz="motor"
        acao={<button>Parar</button>}
      />,
    )
    expect(h).toContain("Frota · Seria muito legal")
    expect(h).toContain("1,4 GB · 2 proc.")
    expect(h).toContain('aria-expanded="false"')
    expect(h).toContain(">Parar<")
    // A árvore só existe aberta: nada de tabela escondida no DOM.
    expect(h).not.toContain("hostinger-api-mcp")
  })
})
