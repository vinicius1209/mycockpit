import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import fioReal from "@/test/fio-real.json"
import { ehEntregavel, entregasDoTrecho, entregasPorResultado } from "./entregas"

// Itens reais do banco da Frota (27/09/2026), com o caminho trocado para uma
// extensão de entregável: o único Write de "entregável" no banco era um
// LEIA-ME.txt, e as criações do Codex eram código. A FORMA é a gravada.
const writeReal = (file_path: string, ok = true): ChatItem =>
  ({
    kind: "tool",
    id: `w-${file_path}`,
    name: "Write",
    input: { content: "PRIME INTERNACIONAL – LANDING PAGE", file_path },
    toolId: "toolu_01NBzavNv6Eyme3xCe4KBSvd",
    ts: 1790255259556,
    result: { ok, text: `File created successfully at: ${file_path}`, lines: 1 },
  }) as ChatItem

const editCodexReal = (mudancas: Array<{ kind: unknown; path: string }>): ChatItem =>
  ({
    kind: "tool",
    id: `e-${mudancas.length}`,
    name: "Edit",
    input: mudancas,
    toolId: "item_81",
    ts: 1789396985593,
    result: { ok: true, text: "", lines: 0 },
  }) as ChatItem

const user = (id: string): ChatItem => ({ kind: "user", id, text: "consolida setembro", ts: 1 }) as ChatItem
const result = (id: string): ChatItem => ({ kind: "result", id, ok: true, ts: 2 }) as ChatItem

const DIST = "/Users/viniciusmachado/projetos/prime/nova-lading-page/dist/prime-landing-v3"

describe("o que o turno entregou", () => {
  it("um turno de código real não gera cartão nenhum", () => {
    // 90 Writes reais (Java, TSX, SQL, scripts em /tmp) e nenhum entregável.
    const items = fioReal as unknown as ChatItem[]
    const porTurno = entregasPorResultado(items, 0)
    expect(porTurno.size).toBeGreaterThan(0)
    expect([...porTurno.values()].every((l) => l.length === 0)).toBe(true)
  })

  it("arquivo escrito inteiro com extensão de entregável vira entrega", () => {
    const e = entregasDoTrecho([writeReal(`${DIST}/relatorio.pdf`), writeReal(`${DIST}/index.tsx`)])
    expect(e).toEqual([{ caminho: `${DIST}/relatorio.pdf` }])
  })

  it("a criação do Codex conta nos dois formatos, a edição não", () => {
    const e = entregasDoTrecho([
      editCodexReal([
        { kind: "update", path: "/p/docs/STATUS.csv" },
        { kind: "add", path: "/p/docs/evidence/faturas.csv" },
        { kind: { type: "add" }, path: "/p/docs/evidence/grafico.png" },
      ]),
    ])
    expect(e.map((x) => x.caminho)).toEqual(["/p/docs/evidence/faturas.csv", "/p/docs/evidence/grafico.png"])
  })

  it("escrita que falhou ou foi interrompida não é entrega", () => {
    const interrompido = { ...writeReal(`${DIST}/b.pdf`), result: { ok: true, text: "", lines: 0, interrupted: true } } as ChatItem
    expect(entregasDoTrecho([writeReal(`${DIST}/a.pdf`, false), interrompido])).toEqual([])
  })

  it("o mesmo arquivo reescrito aparece uma vez, na posição da última escrita", () => {
    const e = entregasDoTrecho([writeReal("/x/a.pdf"), writeReal("/x/b.csv"), writeReal("/x/a.pdf")])
    expect(e.map((x) => x.caminho)).toEqual(["/x/b.csv", "/x/a.pdf"])
  })

  it("cada turno leva só as próprias entregas", () => {
    const items = [user("u1"), writeReal("/x/a.pdf"), result("r1"), user("u2"), writeReal("/x/b.csv"), result("r2")]
    const m = entregasPorResultado(items, 0)
    expect(m.get("r1")?.map((x) => x.caminho)).toEqual(["/x/a.pdf"])
    expect(m.get("r2")?.map((x) => x.caminho)).toEqual(["/x/b.csv"])
  })

  it("turno fechado reaproveita o mesmo array, e o memo do fio não quebra", () => {
    const items = [user("u1"), writeReal("/x/a.pdf"), result("r1"), user("u2")]
    const antes = entregasPorResultado(items, 0)
    const depois = entregasPorResultado([...items, writeReal("/x/b.pdf")], 0, antes)
    expect(depois.get("r1")).toBe(antes.get("r1"))
  })

  it("extensão decide, sem diferenciar maiúscula", () => {
    expect(ehEntregavel("/x/Relatorio.PDF")).toBe(true)
    expect(ehEntregavel("/x/index.html")).toBe(false)
    expect(ehEntregavel("/x/LEIA-ME.txt")).toBe(false)
    expect(ehEntregavel("/x/.pdf")).toBe(false)
  })
})
