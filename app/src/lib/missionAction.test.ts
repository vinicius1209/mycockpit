// R2 — a escada do rótulo, escrita contra os DOIS casos reais do build 193:
// (a) três "Executar ferramenta" empilhadas enquanto a quarta linha dizia
// "Criar landing-plan.md"; (b) o `file_change` do Codex, que chega como Edit
// com `input = item.changes` e sem `file_path`.

import { describe, expect, it } from "vitest"
import { actionLabel, buildPhaseFeed, toolIdentity } from "./missionAction"
import type { ChatItem } from "@/store/chat"

function tool(
  over: Partial<Extract<ChatItem, { kind: "tool" }>> & { name: string },
): ChatItem {
  return {
    kind: "tool",
    id: over.id ?? Math.random().toString(36).slice(2),
    input: {},
    ...over,
  } as ChatItem
}

describe("escada do rótulo · degrau 1 (verbo + alvo)", () => {
  it("mantém o vocabulário que o fio já fala", () => {
    expect(actionLabel("Write", { file_path: "/p/landing-plan.md" })).toEqual({
      rung: 1,
      label: "Criar landing-plan.md",
      code: null,
    })
  })

  it("comando com narração humana continua no degrau 1", () => {
    const l = actionLabel("Bash", {
      description: "Verificando métricas",
      command: "sqlite3 app.db 'select 1'",
    })
    expect(l?.rung).toBe(1)
  })
})

describe("escada do rótulo · degrau 2 (o payload sabe o que o rótulo não soube)", () => {
  it("o file_change do Codex deixa de ser 'Editar arquivo' sem arquivo", () => {
    // adapters.rs manda name=Edit com input = item.changes (sem file_path);
    // o caminho está nas CHAVES.
    const l = actionLabel("Edit", {
      "src/billing/checkout.ts": { added: 64, removed: 18 },
    })
    expect(l?.rung).toBe(2)
    expect(l?.label).toBe("Editar src/billing/checkout.ts")
    expect(l?.code).toBe("src/billing/checkout.ts")
  })

  it("mais de um arquivo no mesmo evento é declarado, não escondido", () => {
    const l = actionLabel("Edit", {
      "src/a.ts": {},
      "src/b.ts": {},
      "src/c.ts": {},
    })
    expect(l?.label).toContain("e mais 2")
  })

  it("tool desconhecida com comando mostra o COMANDO, não a string genérica", () => {
    const l = actionLabel("mcp__server__run", { command: "rg -n landing docs/" })
    expect(l?.rung).toBe(2)
    expect(l?.label).toBe("rg -n landing docs/")
    expect(l?.label).not.toBe("Executar ferramenta")
  })

  it("Ler sem caminho nenhum não fica no degrau 1 fingindo alvo", () => {
    const l = actionLabel("Read", {})
    expect(l?.rung).not.toBe(1)
  })
})

describe("escada do rótulo · degrau 3 (id feio é identidade)", () => {
  it("tool MCP sem payload mostra o identificador dela", () => {
    const l = actionLabel("mcp__figma__get_file", {})
    expect(l).toEqual({
      rung: 3,
      label: "figma · get_file",
      code: "figma · get_file",
    })
  })

  it("três tools MCP diferentes deixam de ser a MESMA linha", () => {
    const a = actionLabel("mcp__figma__get_file", {})
    const b = actionLabel("mcp__figma__get_node", {})
    const c = actionLabel("mcp__linear__issue", {})
    expect(new Set([a!.label, b!.label, c!.label]).size).toBe(3)
  })

  it("o identificador é limpo, não cru", () => {
    expect(toolIdentity("mcp__figma__get_file")).toBe("figma · get_file")
  })
})

describe("escada do rótulo · degrau 4 (agrega, com a culpa dita)", () => {
  it("sem nome nenhum não há rótulo a inventar", () => {
    expect(actionLabel("", {})).toBeNull()
  })

  it("as sem-nome viram UMA linha que diz de quem é a culpa", () => {
    const feed = buildPhaseFeed([
      tool({ name: "", id: "a" }),
      tool({ name: "", id: "b" }),
      tool({ name: "Write", input: { file_path: "/p/x.md" }, id: "c" }),
    ])
    const agg = feed.find((r) => r.kind === "sem-rotulo")
    expect(agg).toMatchObject({ count: 2 })
    expect(agg?.label).toBe("2 ações sem rótulo (o motor não mandou o nome)")
    // e NUNCA duas linhas iguais empilhadas
    expect(feed.filter((r) => r.kind === "sem-rotulo")).toHaveLength(1)
  })
})

describe("feed da fase · quando detalhe vira ruído (R6)", () => {
  const leitura = (id: string) =>
    tool({ name: "Read", input: { file_path: `/p/${id}.ts` }, id, result: { ok: true, text: "", lines: 1 } })
  const escrita = (id: string) =>
    tool({ name: "Write", input: { file_path: `/p/${id}.ts` }, id, result: { ok: true, text: "", lines: 1 } })
  const falha = (id: string) =>
    tool({ name: "Bash", input: { command: "bun run test src/billing" }, id, result: { ok: false, text: "", lines: 1 } })

  it("até 5 ações, mostra todas", () => {
    const feed = buildPhaseFeed([leitura("1"), leitura("2"), leitura("3")])
    expect(feed).toHaveLength(3)
    expect(feed.every((r) => r.kind === "acao")).toBe(true)
  })

  it("acima de 5, leitura recolhe num stub que declara o que engoliu", () => {
    const feed = buildPhaseFeed([
      leitura("1"), leitura("2"), leitura("3"), leitura("4"),
      escrita("5"), leitura("6"),
    ])
    const stub = feed.find((r) => r.kind === "stub")
    expect(stub).toMatchObject({ count: 4, label: "4 leituras" })
    expect(feed.some((r) => r.kind === "acao" && r.mutation)).toBe(true)
  })

  it("falha NUNCA agrega, nem repetida quatro vezes", () => {
    const feed = buildPhaseFeed([
      leitura("1"), leitura("2"),
      falha("f1"), falha("f2"), falha("f3"), falha("f4"),
    ])
    expect(feed.filter((r) => r.kind === "acao" && r.state === "erro")).toHaveLength(4)
  })

  it("a duração só aparece quando os dois carimbos existem", () => {
    const com = buildPhaseFeed([
      tool({ name: "Write", input: { file_path: "/p/x" }, id: "a", ts: 1000, activityAt: 5000 }),
    ])[0]
    expect(com).toMatchObject({ kind: "acao", durationMs: 4000 })
    const sem = buildPhaseFeed([
      tool({ name: "Write", input: { file_path: "/p/x" }, id: "b", ts: 1000 }),
    ])[0]
    expect(sem).toMatchObject({ kind: "acao", durationMs: null })
  })
})

describe("linha viva · o filho mostra o delta, nunca o eco do marco", () => {
  // O "Agora: Criar landing-plan.md" do build 193 repetia a linha logo acima
  // porque a linha viva era um ECO do marco. Aqui não existe linha separada: a
  // ação SEM desfecho é a última do próprio feed, viva, e as de cima já estão
  // no pretérito. Duplicar virou impossível por construção.
  it("com tudo concluído, nenhuma linha fica viva", () => {
    const feed = buildPhaseFeed(
      [tool({ name: "Write", input: { file_path: "/p/x.md" }, result: { ok: true, text: "", lines: 1 } })],
      { live: true },
    )
    expect(feed.some((r) => r.kind === "acao" && r.state === "viva")).toBe(false)
  })

  it("a ação sem desfecho é a ÚLTIMA do feed, e é a única viva", () => {
    const feed = buildPhaseFeed(
      [
        tool({ name: "Write", input: { file_path: "/p/a.md" }, id: "1", result: { ok: true, text: "", lines: 1 } }),
        tool({ name: "Bash", input: { command: "bun run test" }, id: "2" }),
      ],
      { live: true },
    )
    const vivas = feed.filter((r) => r.kind === "acao" && r.state === "viva")
    expect(vivas).toHaveLength(1)
    expect(feed[feed.length - 1]).toMatchObject({ id: "2", state: "viva" })
    // e o rótulo dela NUNCA é igual ao do marco imediatamente acima
    expect(feed[0]).not.toMatchObject({ label: "Executar testes" })
  })

  it("fase sem ação nenhuma não recebe 'preparando…'", () => {
    expect(buildPhaseFeed([], { live: true })).toHaveLength(0)
    expect(
      buildPhaseFeed([{ kind: "text", id: "t", text: "oi" }], { live: true }),
    ).toHaveLength(0)
  })
})
