// Despoluição do fio (direção B + paleta A, docs/mocks/fio-despoluicao-b.html):
// concluído recolhe pra UMA linha com duração congelada; falha nasce aberta
// nomeando a culpada e escondendo as concluídas atrás do stub; o filho não
// repete o rótulo que o cabeçalho já mostra.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"
import type { DeferredWork } from "@/lib/work"

const T0 = 1_754_400_000_000

function render(items: ChatItem[], running = false): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running,
      finalizing: false,
      startedAt: running ? T0 : null,
      agent: "claude-code",
    }),
  )
}

function bash(
  id: string,
  command: string,
  over: Partial<Extract<ChatItem, { kind: "tool" }>> = {},
): ChatItem {
  return {
    kind: "tool",
    id,
    name: "Bash",
    input: { command },
    result: { ok: true, text: "", lines: 0 },
    ...over,
  }
}

describe("MessageList · grupo assentado com falha (a falha não se esconde)", () => {
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "Roda o estudo" },
    bash("1", "ls"),
    bash("2", "pwd"),
    bash("3", "node probe.mjs", {
      input: { description: "Gerar PDF (iPhone SE)", command: "node probe.mjs" },
      result: { ok: false, text: "saiu 1", lines: 1 },
    }),
    bash("4", "git status"),
    bash("5", "git diff"),
    bash("6", "rg foo src"),
    bash("7", "cat a.txt"),
  ]

  it("o resumo nomeia a culpada e o grupo nasce aberto", () => {
    const html = render(items)
    expect(html).toContain("1 de 7 falhou · Gerar PDF (iPhone SE)")
    expect(html).toContain('aria-expanded="true"')
  })

  it("expandido mostra SÓ a linha falhada; as concluídas viram stub", () => {
    const html = render(items)
    // a linha falhada é evidência: o nome aparece no cabeçalho E na linha
    expect(html.match(/Gerar PDF \(iPhone SE\)/g)).toHaveLength(2)
    expect(html).toContain("6 concluídas · mostrar")
    // as concluídas não rendem até serem pedidas
    expect(html).not.toContain("Verificar o estado do repositório")
    expect(html).not.toContain("Inspecionar alterações")
  })
})

describe("MessageList · concluído recolhe pra UMA linha com tempo congelado", () => {
  it("grupo assentado nasce recolhido, com duração total no cabeçalho", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Confere as pré-condições" },
      bash("1", "git status --short", { ts: T0, activityAt: T0 + 300 }),
      bash("2", "cat src/styles/print-pdf.css", {
        ts: T0 + 400,
        activityAt: T0 + 3_000,
      }),
    ])
    expect(html).toContain("2 verificações concluídas")
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain(">3s<")
    // recolhido: nenhuma linha filha no DOM até o clique
    expect(html).not.toContain("Inspecionar arquivos")
  })

  it("sem carimbos não inventa relógio (nunca 0s)", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Confere" },
      bash("1", "ls"),
      bash("2", "pwd"),
    ])
    expect(html).toContain("2 verificações concluídas")
    expect(html).not.toContain(">0s<")
  })
})

// Cena MEDIDA da auditoria (docs/fio-poluicao-2.md §0), remontada com a forma
// que o reducer REALMENTE produz: o `tool_use` de origem carrega o
// `tool_use_id` do provider e o nó sintético `DeferredWork` pendura nele por
// `parentToolId` (store/chat.ts, case "deferred_work"). Ids reais do spike D0
// (adapters.rs, `claude_task_started_vira_deferred_running_com_vinculo…`).
// A fixture ANTERIOR montava o DeferredWork sem `parentToolId` — forma que o
// reducer nunca emite — e por isso ficava verde enquanto o app repetia o nome
// 4× na mesma tela (ADR-016).
const TOOL_USE_ID = "toolu_01MmPxeoK9vhakStdhGbVywn"
const WORK_NAME = "Check address edit history in prod"

function backgroundScene(
  over: Partial<DeferredWork> = {},
): [ChatItem, ChatItem] {
  const deferred: DeferredWork = {
    id: "wnz619fti",
    toolUseId: TOOL_USE_ID,
    kind: "local_workflow",
    name: WORK_NAME,
    status: "running",
    summary: null,
    outputFile: null,
    tokens: null,
    startedAt: T0,
    updatedAt: T0,
    ...over,
  }
  return [
    {
      kind: "tool",
      id: "item-agent",
      name: "Agent",
      input: { description: WORK_NAME, subagent_type: "general-purpose" },
      toolId: TOOL_USE_ID,
      ts: T0,
      activityAt: T0,
    },
    {
      kind: "tool",
      id: `deferred-${deferred.id}`,
      name: "DeferredWork",
      input: { name: deferred.name, kind: deferred.kind, description: null },
      toolId: `deferred:${deferred.id}`,
      parentToolId: TOOL_USE_ID,
      deferred,
      ts: T0,
      activityAt: T0,
    },
  ]
}

describe("MessageList · o bloco de entrada/comando tem teto (a régua do briefing)", () => {
  // Ação com filho ativo é o único caminho em que o segundo nível de disclosure
  // nasce aberto sem clique, que é o que o render estático alcança.
  function scene(payload: unknown): ChatItem[] {
    return [
      { kind: "user", id: "u1", text: "Sobe a VPS" },
      {
        kind: "tool",
        id: "item-mcp",
        name: "mcp__hostinger__VPS_setup",
        input: payload,
        toolId: "toolu_mcp",
        ts: T0,
      },
      {
        kind: "tool",
        id: "item-child",
        name: "Bash",
        input: { command: "ssh vps 'uptime'" },
        toolId: "toolu_child",
        parentToolId: "toolu_mcp",
        ts: T0,
      },
    ]
  }

  it("payload de várias linhas nasce recolhido, dizendo o tamanho", () => {
    const html = render(scene({ script: "linha 1\nlinha 2\nlinha 3" }), true)
    expect(html).toContain("linhas")
    expect(html).toContain('aria-expanded="false"')
    // recolhido: o conteúdo não ocupa altura até ser pedido
    expect(html).not.toContain("linha 2")
  })

  it("aberto, o conteúdo tem teto de altura com scroll próprio", () => {
    // payload de UMA linha (o adapter entrega o input cru; aqui um escalar)
    // continua aberto, e mesmo aberto o bloco não passa do teto.
    const html = render(scene("uptime"), true)
    expect(html).toContain("uptime")
    expect(html).toContain("max-h-52 overflow-y-auto")
  })

  it("truncar a VISUALIZAÇÃO não trunca a evidência: dá pra copiar inteiro", () => {
    const html = render(scene({ script: "linha 1\nlinha 2\nlinha 3" }), true)
    expect(html).toContain("Copia a entrada inteira")
  })
})

describe("MessageList · posse do nome é da ENTIDADE, e desce pela subárvore", () => {
  it("trabalho em background vivo: o nome sai UMA vez do grupo, os dois níveis mostram só o delta", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "confere o histórico" }, ...backgroundScene()],
      true,
    )
    // a linha viva do rodapé (dona única do agora) leva o nome no `title` e
    // trunca o texto: tudo que vem ANTES dela é o fio do grupo.
    const [inThread] = html.split(`title="${WORK_NAME}"`)
    // no grupo o nome sai UMA vez só — antes eram 3 ocorrências aqui dentro
    // (cabeçalho + nível 1 + nível 2), porque a comparação era de string e a
    // prop `headerLabel` parava no nível 1.
    expect(inThread.match(new RegExp(WORK_NAME, "g"))).toHaveLength(1)
    // e o total da tela cai de 4 pra 2 (grupo + linha viva do rodapé)
    expect(html.match(new RegExp(WORK_NAME, "g"))).toHaveLength(2)
  })

  it("o delta de cada nível é o que o ADR-037 pede: estado no nível 1, marco no nível 2", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "confere o histórico" }, ...backgroundScene()],
      true,
    )
    // nível 1 (o tool_use que delegou): o que sobra é o estado + o tipo de agente
    expect(html).toContain(">em execução<")
    expect(html).toContain("general-purpose")
    // nível 2 (o nó sintético do trabalho diferido): o marco de nascimento
    expect(html).toContain(">iniciado<")
  })

  it("a posse é por identidade, não por prefixo: rótulos DIFERENTES da mesma entidade dedupam", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "confere o histórico" }, ...backgroundScene()],
      true,
    )
    // o cabeçalho carrega o rótulo com prefixo; o nível 1 carregaria o sem
    // prefixo. Igualdade de string nunca casaria os dois (era o furo A).
    expect(html).toContain(`Trabalho em background: ${WORK_NAME}`)
    expect(html.match(/Trabalho em background: /g)).toHaveLength(1)
  })

  it("um indicador ANIMADO por linhagem: gira o passo mais profundo, o ancestral fica quieto", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "confere o histórico" }, ...backgroundScene()],
      true,
    )
    // eram 3 na mesma linhagem (cabeçalho + tool_use + nó do trabalho); agora
    // o cabeçalho representa o grupo (recolhido é o único sinal) e, dentro da
    // árvore, só o passo mais profundo em execução gira.
    const spinners = html.match(/animate-spin text-st-running/g) ?? []
    expect(spinners).toHaveLength(2)
    // o ancestral vivo não some: continua dizendo que o ramo está aceso
    expect(html).toContain("rounded-full bg-st-running/60")
  })

  it("filho sem identidade (histórico sem tool_use_id) não herda posse: mantém o nome", () => {
    const [agent, deferredNode] = backgroundScene()
    const html = render(
      [
        { kind: "user", id: "u1", text: "confere o histórico" },
        agent,
        {
          kind: "tool",
          id: "item-bash",
          name: "Bash",
          input: { description: "Consultar o banco", command: "sqlite3 app.db .tables" },
          parentToolId: TOOL_USE_ID,
          ts: T0,
        },
        deferredNode,
      ],
      true,
    )
    // fail-open: sem chave de trabalho não há o que dedupar, o nome fica
    expect(html).toContain("Consultar o banco")
  })
})
