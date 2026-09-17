// Terminal dos Bastidores no painel direito (ADR-200): o que ele mostra em cada
// estado. Renderiza a apresentação por props (o contêiner lê stores e o SSR
// congela o estado). Veio do painel central, que saiu no build #390.

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TerminalView } from "./TerminalDeBastidores"
import type { Bastidor } from "@/lib/bastidores"
import type { VistaAberta } from "@/store/bastidores"

const T0 = 1_789_578_857_000
const nada = () => {}

const TAREFA: Bastidor = {
  itemId: "deferred-btirvhvcs",
  tipo: "tarefa",
  titulo: "for i in 1 2 3 4; do echo passo $i; sleep 3; done; echo fim",
  detalhe: null,
  comando: null,
  estado: "interrompido",
  desde: T0,
  atualizadoEm: T0 + 11_000,
  fonte: { tipo: "sem-saida" },
  tokens: null,
}
const SUBAGENTE: Bastidor = {
  itemId: "deferred-a25537ec2c0bf1ccd",
  tipo: "subagente",
  titulo: "Run bash command with loop and echo",
  detalhe: "Running Run loop that prints sub 1, sub 2, sub 3",
  comando: null,
  estado: "vivo",
  desde: T0,
  atualizadoEm: T0,
  fonte: { tipo: "passos", paiId: "toolu_01CuGcv88simK1tMYCZDLaU1" },
  tokens: 11187,
}
const COMANDO: Bastidor = {
  itemId: "t-codex",
  tipo: "comando",
  titulo: "for i in 1 2 3 4 5 6; do echo cx $i; sleep 2; done; echo fim",
  detalhe: null,
  comando: null,
  estado: "vivo",
  desde: T0,
  atualizadoEm: T0,
  fonte: { tipo: "stream", toolId: "item-cmd-1" },
  tokens: null,
}

function render(lista: Bastidor[], abertos: string[], foco = 0, dividido = false) {
  const vistas: VistaAberta[] = abertos.map((itemId) => ({ convId: "c1", itemId }))
  return renderToStaticMarkup(
    <TerminalView
      lista={lista}
      vistas={vistas}
      foco={foco}
      dividido={dividido}
      corpoDe={(b) =>
        b.fonte.tipo === "stream"
          ? { saida: { linhas: ["cx 2", "cx 3"], descartadas: 0, resto: "" } }
          : b.fonte.tipo === "passos"
            ? { passos: [{ id: "p1", nome: "Bash", alvo: "for i in 1 2 3; do echo sub $i; sleep 4; done", estado: "vivo" }] }
            : {}
      }
      onFocar={nada}
      onFechar={nada}
      onFecharTodas={nada}
      onDividir={nada}
      onVerIndice={nada}
    />,
  )
}

describe("TerminalView", () => {
  it("o terminal só tem vistas: a lista fica a um clique, na mesma aba", () => {
    const html = render([COMANDO, SUBAGENTE], ["t-codex"])
    expect(html).not.toContain('role="listbox"')
    expect(html).toContain('aria-label="Ver a lista de trabalhos"')
    expect(html).toContain("rodando ·")
  })

  it("uma vista mostra a saída ao vivo do comando, com um X só (build #389 tinha dois)", () => {
    const html = render([COMANDO, SUBAGENTE], ["t-codex"])
    expect(html).toContain("cx 2\ncx 3")
    expect(html).not.toContain('data-slot="resizable-panel-group"')
    expect(html.match(/aria-label="Fechar /g)).toHaveLength(1)
  })

  it("em abas, várias vistas mostram só a da aba ativa", () => {
    const html = render([COMANDO, SUBAGENTE, TAREFA], ["t-codex", "deferred-a25537ec2c0bf1ccd", "deferred-btirvhvcs"], 1)
    expect(html.match(/role="tab"/g)).toHaveLength(3)
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html.match(/<section aria-label="(comando|subagente|tarefa):/g)).toHaveLength(1)
    expect(html).toContain("11k tokens")
  })

  it("lado a lado empilha as três vistas, com foco marcado e o X de cada uma", () => {
    const html = render([COMANDO, SUBAGENTE, TAREFA], ["t-codex", "deferred-a25537ec2c0bf1ccd", "deferred-btirvhvcs"], 1, true)
    expect(html.match(/data-slot="resizable-panel-group"/g)).toHaveLength(1)
    expect(html.match(/data-em-foco="true"/g)).toHaveLength(1)
    expect(html.match(/<section aria-label="(comando|subagente|tarefa):/g)).toHaveLength(3)
    expect(html).toContain("11k tokens")
  })

  it("subagente mostra os passos pelas tools que usa", () => {
    const html = render([SUBAGENTE], ["deferred-a25537ec2c0bf1ccd"])
    expect(html).toContain("for i in 1 2 3; do echo sub $i; sleep 4; done")
  })

  it("trabalho morto com o turno explica o porquê, e sem saída ao vivo diz isso", () => {
    const html = render([TAREFA], ["deferred-btirvhvcs"])
    // Já terminou: "só entrega no fim" seria falso aqui (visto no build #386).
    expect(html).toContain("O motor não entregou saída para este trabalho.")
    expect(html).not.toContain("só entrega a saída quando o trabalho termina")
    expect(html).toContain("comandos em segundo plano terminam junto com o turno")
    expect(html).toContain("interrompido")
  })

  it("comando mostra o prompt com a linha de comando antes da saída", () => {
    const html = render([{ ...COMANDO, comando: "bun run test:e2e" }], ["t-codex"])
    expect(html.indexOf("bun run test:e2e")).toBeLessThan(html.indexOf("cx 2"))
    expect(html).toContain("terminal-cursor")
  })
})
