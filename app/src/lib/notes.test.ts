// Notas do humano no fio (lib/notes): o que fica PENDENTE, como o bloco chega
// ao agente e onde a nota aparece na tela. Tudo puro — sem store, sem render.

import { describe, expect, it } from "vitest"
import { notesBlock, pendingNotes, placeNotes, NOTE_QUOTE_MAX } from "./notes"
import type { ChatItem } from "@/store/chat"

const user = (id: string, text: string): ChatItem => ({ kind: "user", id, text })
const resp = (id: string, text: string): ChatItem => ({ kind: "text", id, text })
const nota = (id: string, text: string, anchorId: string, sent?: boolean): ChatItem => ({
  kind: "note",
  id,
  text,
  anchorId,
  ...(sent ? { sent } : {}),
})

describe("pendingNotes", () => {
  it("sem nota, nada pendente", () => {
    expect(pendingNotes([user("u1", "oi"), resp("t1", "olá")])).toEqual([])
  })

  it("nota carimbada NÃO volta (senão repetiria a instrução todo turno)", () => {
    const fio = [resp("t1", "feito"), nota("n1", "revisa", "t1", true)]
    expect(pendingNotes(fio)).toEqual([])
  })

  it("só as não entregues", () => {
    const fio = [
      resp("t1", "feito"),
      nota("n1", "velha", "t1", true),
      nota("n2", "nova", "t1"),
    ]
    expect(pendingNotes(fio).map((n) => n.id)).toEqual(["n2"])
  })
})

describe("notesBlock", () => {
  it("nada pendente não vira cabeçalho vazio", () => {
    expect(notesBlock([resp("t1", "feito"), nota("n1", "x", "t1", true)])).toBeNull()
  })

  it("cita o turno ancorado e enquadra como DIREÇÃO do humano", () => {
    const fio = [resp("t1", "Refatorei o parser"), nota("n1", "faltou o caso vazio", "t1")]
    const out = notesBlock(fio)!
    expect(out).toContain("<notas-do-usuario>")
    expect(out).toContain('Sobre "Refatorei o parser"')
    expect(out).toContain("faltou o caso vazio")
    // o enquadramento é o que impede a nota de ser lida como fala a responder
    expect(out).toContain("DIREÇÃO")
    expect(out).toContain("</notas-do-usuario>")
  })

  it("trunca a citação longa (a nota ancora, não recita o turno)", () => {
    const longo = "x".repeat(NOTE_QUOTE_MAX + 80)
    const out = notesBlock([resp("t1", longo), nota("n1", "arruma", "t1")])!
    const linha = out.split("\n").find((l) => l.startsWith("- Sobre"))!
    expect(linha.length).toBeLessThan(NOTE_QUOTE_MAX + 40)
    expect(linha).toContain("…")
  })

  it("âncora que sumiu ainda entrega a nota (sem citação, nunca engolida)", () => {
    const out = notesBlock([nota("n1", "isso aqui", "turno-que-sumiu")])!
    expect(out).toContain("isso aqui")
    expect(out).not.toContain("Sobre \"")
  })

  it("âncora sem texto (tool) não inventa citação vazia", () => {
    const fio: ChatItem[] = [
      { kind: "tool", id: "x1", name: "Bash", input: {} },
      nota("n1", "cuidado aqui", "x1"),
    ]
    expect(notesBlock(fio)!).toContain("- cuidado aqui")
  })

  it("várias notas mantêm a ordem em que foram escritas", () => {
    const fio = [
      resp("t1", "a"),
      nota("n1", "primeira", "t1"),
      nota("n2", "segunda", "t1"),
    ]
    const out = notesBlock(fio)!
    expect(out.indexOf("primeira")).toBeLessThan(out.indexOf("segunda"))
  })
})

describe("placeNotes (ordem de RENDER)", () => {
  it("põe a nota logo abaixo do turno que ela comenta", () => {
    // armazenamento é append-only: a nota nasce no FIM do fio.
    const fio = [
      user("u1", "faz"),
      resp("t1", "fiz"),
      user("u2", "outra"),
      resp("t2", "feito"),
      nota("n1", "sobre o primeiro", "t1"),
    ]
    expect(placeNotes(fio).map((it) => it.id)).toEqual([
      "u1",
      "t1",
      "n1",
      "u2",
      "t2",
    ])
  })

  it("duas notas no mesmo turno preservam a ordem entre si", () => {
    const fio = [resp("t1", "fiz"), nota("n1", "a", "t1"), nota("n2", "b", "t1")]
    expect(placeNotes(fio).map((it) => it.id)).toEqual(["t1", "n1", "n2"])
  })

  it("nota órfã fica onde está (some do lugar certo, nunca da tela)", () => {
    const fio = [resp("t1", "fiz"), nota("n1", "x", "turno-que-sumiu")]
    expect(placeNotes(fio).map((it) => it.id)).toEqual(["t1", "n1"])
  })

  it("fio sem nota volta idêntico (mesma referência, sem cópia à toa)", () => {
    const fio = [user("u1", "oi"), resp("t1", "olá")]
    expect(placeNotes(fio)).toBe(fio)
  })

  it("não perde nem duplica item nenhum", () => {
    const fio = [
      user("u1", "faz"),
      resp("t1", "fiz"),
      nota("n1", "a", "t1"),
      resp("t2", "mais"),
      nota("n2", "b", "t2"),
    ]
    const out = placeNotes(fio)
    expect(out).toHaveLength(fio.length)
    expect(new Set(out.map((i) => i.id)).size).toBe(fio.length)
  })
})
