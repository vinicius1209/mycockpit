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
  tipo: "terminal",
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
    expect(html.match(/<section aria-label="(terminal|subagente|tarefa):/g)).toHaveLength(1)
    expect(html).toContain("11k tokens")
  })

  it("lado a lado empilha as três vistas, com foco marcado e o X de cada uma", () => {
    const html = render([COMANDO, SUBAGENTE, TAREFA], ["t-codex", "deferred-a25537ec2c0bf1ccd", "deferred-btirvhvcs"], 1, true)
    expect(html.match(/data-slot="resizable-panel-group"/g)).toHaveLength(1)
    expect(html.match(/data-em-foco="true"/g)).toHaveLength(1)
    expect(html.match(/<section aria-label="(terminal|subagente|tarefa):/g)).toHaveLength(3)
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

  // Payload real: o comando da captura de 21/09/2026, um heredoc que ocupava
  // 80% da vista e deixava a saída no rodapé.
  const HEREDOC = [
    "python3 - <<'EOF'",
    "p='src/components/layout/DiffIndex.tsx'",
    "L=open(p).read().split('\\n')",
    "# reindent seção 1",
    "for i in range(a+1,b):",
    "    if L[i]: L[i]='  '+L[i]",
    "open(p,'w').write('\\n'.join(L))",
    "EOF",
  ].join("\n")
  const LONGO: Bastidor = {
    ...COMANDO,
    titulo: "Reindent and mirror the rule on the unstaged section, then typecheck",
    comando: HEREDOC,
    estado: "concluido",
    atualizadoEm: T0 + 10_000,
  }

  it("comando longo nasce recolhido: quem manda na vista é a saída", () => {
    const html = render([LONGO], ["t-codex"])
    expect(html).toContain("python3 - &lt;&lt;&#x27;EOF&#x27;")
    expect(html).toContain("L=open(p)")
    expect(html).not.toContain("if L[i]")
    expect(html).toContain("Ver o comando inteiro (8 linhas)")
    expect(html).toContain('aria-label="Copiar o comando"')
    expect(html).toContain('aria-label="Copiar a saída"')
  })

  it("comando curto aparece inteiro, sem botão de expandir", () => {
    const html = render([{ ...COMANDO, comando: "bun run test:e2e" }], ["t-codex"])
    expect(html).not.toContain("Ver o comando inteiro")
  })

  it("uma vista só é um detalhe: volta escrita, título uma vez, nenhuma aba", () => {
    // Build #415: a aba e o corpo diziam o mesmo título, um em cima do outro.
    const html = render([LONGO], ["t-codex"])
    expect(html).not.toContain('role="tab"')
    expect(html).toContain(">Bastidores</button>")
    expect(html.match(/then typecheck</g)).toHaveLength(1)
    expect(html).not.toContain("←→ abas")
  })

  it("com várias abas o corpo traz o título inteiro; lado a lado a faixa já traz", () => {
    const abas = render([LONGO, SUBAGENTE], ["t-codex", SUBAGENTE.itemId])
    expect(abas).toContain("then typecheck</p>")
    expect(abas).toContain("←→ abas")
    const lado = render([LONGO, SUBAGENTE], ["t-codex", SUBAGENTE.itemId], 0, true)
    expect(lado).not.toContain("then typecheck</p>")
  })

  it("o estado abre a vista, numa linha só com duração, hora e tipo, e não repete", () => {
    const html = render([LONGO], ["t-codex"])
    expect(html.match(/concluído/g)).toHaveLength(1)
    expect(html).toMatch(/concluído · 10s<\/span><span>· começou às \d\d:\d\d<\/span><span>· terminal</)
    expect(html.indexOf("concluído")).toBeLessThan(html.indexOf("python3"))
    expect(html).not.toContain("<footer")
  })
})
