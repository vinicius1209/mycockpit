import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { StickyNotesDockView } from "./StickyNotesDock"
import { StickyNotesToggleView } from "./StickyNotesTrigger"
import { LIMIAR_DA_LISTA } from "./noteGroups"
import type { StickyNote } from "./types"

/** 27/08/2026, 21:12 local — a hora do mock. Injetado em toda renderização:
 *  as seções "Hoje"/"Anteriores" são função do relógio. */
const AGORA = new Date(2026, 7, 27, 21, 12).getTime()
const UMA_HORA = 3_600_000
const UM_DIA = 24 * UMA_HORA

function nota(over: Partial<StickyNote> & { id: string }): StickyNote {
  return {
    content: `conteúdo ${over.id}`,
    color: "sand",
    createdAt: AGORA,
    updatedAt: AGORA,
    ...over,
  }
}

const duasNotas: StickyNote[] = [
  nota({ id: "n1", content: "Snippet de configuração do MCP", updatedAt: AGORA - UMA_HORA }),
  nota({ id: "n2", content: "Nota mais recente", color: "rose", updatedAt: AGORA }),
]

/** Cinco notas: passa do limiar, então a lista existe. Duas da conversa "c1",
 *  três globais do projeto. */
const muitasNotas: StickyNote[] = [
  nota({ id: "fix", convId: "c1", content: "Jana · possível problema" }),
  nota({ id: "hoje-conv", convId: "c1", content: "Runbook da migração\nDNS e ERP", updatedAt: AGORA - 3 * UMA_HORA }),
  nota({ id: "hoje-proj", projectId: "p1", content: "Perguntar sobre o cache", updatedAt: AGORA - 5 * UMA_HORA }),
  nota({ id: "velha-proj", projectId: "p1", content: "Checar limites do plano", updatedAt: AGORA - 3 * UM_DIA }),
  nota({ id: "outra-proj", projectId: "p1", content: "Rever o watchdog", updatedAt: AGORA - 9 * UM_DIA }),
]

function render(props: Partial<Parameters<typeof StickyNotesDockView>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(StickyNotesDockView, {
      open: true,
      notes: [],
      agora: AGORA,
      activeProjectId: "p1",
      ...props,
    }),
  )
}

describe("StickyNotesDockView", () => {
  /**
   * A gaveta é o `asChild` do `PopoverContent` (§12), e quem é `asChild`
   * REPASSA as props. Este teste existe porque a versão que não repassava
   * compilou, renderizou e foi pro build 311 como um painel TRANSPARENTE
   * flutuando sobre o fio: sem borda, sem fundo, com o texto da conversa
   * aparecendo por baixo. `tsc` não viu, a suíte não viu, e o defeito só
   * apareceu no olho de quem abriu o app.
   */
  it("repassa a superfície que o PopoverContent entrega por asChild", () => {
    const html = render({
      className: "bg-popover shadow-[var(--shadow-pop)]",
      // Os `data-*` vêm do Radix em runtime, não da assinatura: entram por
      // spread para o TS não cobrar uma prop declarada que ninguém escreve.
      ...({ "data-state": "open", "data-side": "bottom" } as Record<string, string>),
    })
    expect(html).toContain("bg-popover")
    expect(html).toContain('data-state="open"')
    expect(html).toContain('data-side="bottom"')
    // E o que é da gaveta continua lá: repassar não é substituir.
    expect(html).toContain('aria-label="Bloco de Notas"')
  })

  it("não renderiza nada quando open é false", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNotesDockView, { open: false, notes: [] }),
    )
    expect(html).toBe("")
  })

  it("renderiza o cabeçalho e empty state quando open é true e não há notas", () => {
    const html = render()
    expect(html).toContain("Bloco de Notas")
    expect(html).toContain("Nenhuma nota ainda")
  })

  it("não é mais fixed de altura cheia: a gaveta tem teto e cabe no conteúdo", () => {
    const html = render({ notes: duasNotas })
    expect(html).not.toContain("fixed")
    expect(html).not.toContain("bottom-16")
    expect(html).toContain("max-h-[min(40rem")
  })

  describe(`com menos de ${LIMIAR_DA_LISTA} notas (desenho B)`, () => {
    it("a lista some e sobra a folha com navegação 1/2", () => {
      const html = render({ notes: duasNotas })
      expect(html).not.toContain("Buscar nas notas")
      expect(html).toContain("1/2")
      // A folha mostra UMA nota por vez, e a régua é só recência (o pin saiu):
      // a mais nova encabeça.
      expect(html).toContain("Nota mais recente")
      expect(html).not.toContain("Snippet de configuração do MCP")
    })

    it("com uma nota só não há o que folhear: nem o 1/1 aparece", () => {
      const html = render({ notes: [duasNotas[0]] })
      expect(html).not.toContain("1/1")
      expect(html).toContain("Snippet de configuração do MCP")
    })

    it("a folha não vira cartão dentro do popover (sem borda nem sombra própria)", () => {
      const html = render({ notes: [duasNotas[0]] })
      expect(html).not.toContain("shadow-[var(--shadow-sm)]")
    })
  })

  describe(`a partir de ${LIMIAR_DA_LISTA} notas (desenho A)`, () => {
    it("a lista aparece, com busca e as seções de escopo e tempo", () => {
      const html = render({ notes: muitasNotas, activeConvId: "c1" })
      expect(html).toContain("Buscar nas notas")
      expect(html).toContain("Desta conversa")
      expect(html).toContain("Deste projeto")
      expect(html).toContain("Hoje")
      expect(html).toContain("Hoje")
      expect(html).toContain("Anteriores")
    })

    it("a primeira linha vira título e o resto vira preview de uma linha", () => {
      const html = render({ notes: muitasNotas, activeConvId: "c1" })
      expect(html).toContain("Runbook da migração")
      expect(html).toContain("DNS e ERP")
    })

    it("sem conversa ativa, nota de conversa não entra e só sobra 'Deste projeto'", () => {
      const html = render({ notes: muitasNotas })
      expect(html).toContain("Deste projeto")
      expect(html).not.toContain("Desta conversa")
      expect(html).not.toContain("Jana · possível problema")
    })

    it("some a navegação de folhear: quem navega é a lista", () => {
      const html = render({ notes: muitasNotas, activeConvId: "c1" })
      expect(html).not.toContain("1/5")
    })
  })

  describe("a nota nova nasce com escopo visível (N3)", () => {
    it("com conversa ativa o gesto pergunta o escopo em vez de herdar", () => {
      // Os dois destinos moram no menu, que só existe aberto: o que se prova em
      // SSR é que o botão ABRE um menu em vez de criar direto e escolher sozinho.
      const html = render({ notes: [], activeConvId: "c1", onCreate: () => "novo" })
      expect(html).toContain('aria-haspopup="menu"')
      expect(html).not.toContain("Nova nota do projeto")
    })

    it("sem conversa ativa há um destino só, e ele está escrito no botão", () => {
      const html = render({ notes: [], onCreate: () => "novo" })
      expect(html).toContain("Nova nota do projeto")
      expect(html).not.toContain("Nesta conversa")
    })
  })

  it("o escopo da nota aberta fica visível no cabeçalho da folha", () => {
    const daConversa = render({
      notes: [nota({ id: "x", convId: "c1", content: "Só desta conversa" })],
      activeConvId: "c1",
    })
    const doProjeto = render({
      notes: [nota({ id: "y", projectId: "p1", content: "Deste projeto" })],
      activeConvId: "c1",
    })
    // O terceiro escopo tem rótulo próprio porque é um estado REAL: nota sem
    // projeto aparece em todos eles, e chamá-la de "deste projeto" era a
    // mentira que o campo `projectId` veio desfazer.
    const deTodos = render({
      notes: [nota({ id: "z", content: "Vale em todo projeto" })],
      activeConvId: "c1",
    })
    expect(daConversa).toContain(">Conversa<")
    expect(doProjeto).toContain(">Projeto<")
    expect(deTodos).toContain(">Todos<")
  })
})

describe("StickyNotesToggleView", () => {
  it("renderiza o botão de toggle com contagem", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNotesToggleView, { open: false, count: 3 }),
    )
    expect(html).toContain("Notas")
    expect(html).toContain("3")
  })

  it("aberto usa seleção neutra, sem transformar estado em tinta", () => {
    const html = renderToStaticMarkup(
      createElement(StickyNotesToggleView, { open: true, count: 1 }),
    )
    expect(html).toContain("bg-sel")
    expect(html).not.toContain("bg-brass")
    expect(html).not.toContain("text-brass")
  })
})

describe("o vazio da folha diz QUAL vazio é", () => {
  // Estes três casos só existem porque `busca` virou prop: enquanto era estado
  // interno da View, nenhum caminho de busca era renderizável em teste — e foi
  // por essa fresta que o falso vazio passou pelo primeiro gate.
  it("busca sem resultado NÃO diz 'Nenhuma nota ainda' com a gaveta cheia", () => {
    // `onBusca` precisa vir: o gesto de desfazer só é oferecido quando existe
    // quem o execute (botão que não faz nada não aparece, §5).
    const html = render({ notes: muitasNotas, busca: "zzz", onBusca: () => {} })
    expect(html).toContain("Nenhuma nota com esse texto")
    expect(html).not.toContain("Nenhuma nota ainda")
    // E o gesto oferecido é o que DESFAZ o recorte, não o de criar.
    expect(html).toContain("Limpar busca")
    expect(html).not.toContain("Criar primeira nota")
  })

  it("gaveta de fato vazia continua convidando a criar", () => {
    const html = render({ notes: [], onCreate: () => undefined })
    expect(html).toContain("Nenhuma nota ainda")
    expect(html).toContain("Criar primeira nota")
  })

  it("a folha e a coluna da lista contam a MESMA história", () => {
    // O defeito era exatamente as duas superfícies discordando na mesma tela.
    const html = render({ notes: muitasNotas, busca: "zzz" })
    const ocorrencias = html.split("Nenhuma nota com esse texto").length - 1
    expect(ocorrencias).toBe(2)
  })
})

describe("a fronteira de colisão da gaveta", () => {
  it("o atributo e o seletor que o procura existem nos DOIS lados", () => {
    // Guarda de EXISTÊNCIA, no molde do `@container` da régua de turnos: sem o
    // `data-notes-boundary` no shell, o `collisionBoundary` cai em `undefined`,
    // que é a fronteira do VIEWPORT — ou seja, a gaveta volta a cobrir o painel
    // direito, que é o defeito que a story N1 veio consertar. Nem tipo, nem
    // teste, nem guarda reclamariam.
    //
    // Fonte pelo mecanismo do Vite (`?raw`), nunca por `node:fs`: o tsconfig do
    // `src/` não tem os tipos do node de propósito e `tsc -b` reprova.
    const fontes = {
      ...(import.meta.glob("../layout/AppShell.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>),
      // O seletor mora no GATILHO (`StickyNotesTrigger.tsx`), que é quem
      // ancora o popover. Este teste já pagou por si: quando o arquivo foi
      // dividido pela catraca, foi ele que apontou o seletor mudando de casa.
      ...(import.meta.glob("./StickyNotesTrigger.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>),
    }
    const [shell, gaveta] = Object.values(fontes)
    expect(shell, "AppShell.tsx não foi lido").toBeTruthy()
    expect(gaveta, "StickyNotesTrigger.tsx não foi lido").toBeTruthy()
    expect(shell).toContain("data-notes-boundary")
    expect(gaveta).toContain("[data-notes-boundary]")
  })
})

describe("a folha deixa o texto comandar", () => {
  it("a cor aparece uma vez como marcador, não como fundo da superfície", () => {
    const html = render({
      notes: [nota({ id: "só", color: "rose", content: "uma nota só" })],
    })
    expect(html.split("bg-note-rose")).toHaveLength(2)
  })

  it("mantém a tipografia no tema do app", () => {
    const html = render({
      notes: [nota({ id: "só", color: "sand", content: "uma nota só" })],
    })
    expect(html).not.toContain("--foreground:var(--note-fg)")
    expect(html).not.toContain("text-note-fg")
  })

  it("sem nota aberta não há papel nenhum", () => {
    const html = render({ notes: [] })
    expect(html).not.toContain("bg-note-")
  })
})
