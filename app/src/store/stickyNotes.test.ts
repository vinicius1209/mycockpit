import { beforeEach, describe, expect, it } from "vitest"
import { useStickyNotes, selectNotesFor } from "./stickyNotes"
import {
  ALVO_QUALQUER,
  alvosDeNota,
  normalizarAlvo,
  rotuloDoAlvo,
} from "@/components/notes/noteTargets"
import { DESTINATIONS } from "@/lib/agents"
import type { StickyNote } from "@/components/notes/types"

/** Base mínima pra montar nota nos testes de filtro. */
const base: StickyNote = {
  id: "base",
  content: "",
  color: "sand",
  createdAt: 0,
  updatedAt: 0,
}

describe("stickyNotes store", () => {
  beforeEach(() => {
    useStickyNotes.setState({
      notes: [],
      dockOpen: false,
      activeFilter: "all",
    })
  })

  it("adiciona uma nova nota com valores padrão", () => {
    const note = useStickyNotes.getState().addNote({ content: "Primeira anotação" })
    expect(note.content).toBe("Primeira anotação")
    const state = useStickyNotes.getState()
    expect(state.notes.length).toBe(1)
    expect(state.notes[0].content).toBe("Primeira anotação")
    expect(state.notes[0].color).toBe("sand")
    expect(state.dockOpen).toBe(true)
  })

  it("atualiza o conteúdo e propriedades da nota", () => {
    const note = useStickyNotes.getState().addNote({ content: "Texto original" })
    useStickyNotes.getState().updateNote(note.id, { content: "Texto alterado", color: "indigo" })
    const updated = useStickyNotes.getState().notes.find((n) => n.id === note.id)
    expect(updated?.content).toBe("Texto alterado")
    expect(updated?.color).toBe("indigo")
  })

  it("exclui uma nota", () => {
    const n1 = useStickyNotes.getState().addNote({ content: "Nota 1" })
    const n2 = useStickyNotes.getState().addNote({ content: "Nota 2" })
    expect(useStickyNotes.getState().notes.length).toBe(2)
    useStickyNotes.getState().deleteNote(n1.id)
    expect(useStickyNotes.getState().notes.length).toBe(1)
    expect(useStickyNotes.getState().notes[0].id).toBe(n2.id)
  })

  describe("selectNotesFor", () => {
    it("ordena por recência e respeita o filtro por alvo", () => {
      // O pin saiu (ADR-117): a única régua de ordem é a data.
      const s = useStickyNotes.getState()
      s.addNote({ content: "velha" })
      s.addNote({ content: "nova" })
      const ordem = selectNotesFor(useStickyNotes.getState().notes).map((n) => n.content)
      // Só recência: a última escrita encabeça, sem pin pra furar a fila.
      expect(ordem[0]).toBe("nova")
    })
  })
})

describe("nota não sobrevive à conversa que a hospedava", () => {
  it("clearConversationNotes leva as notas daquela conversa e só elas", () => {
    // Ligado em `store/chat/remove.ts`. Sem isso a nota fica com um `convId`
    // que não casa com nada: invisível em todo escopo e sem gesto que a apague.
    useStickyNotes.setState({ notes: [] })
    const s = useStickyNotes.getState()
    s.addNote({ convId: "c1", content: "da c1" })
    s.addNote({ convId: "c2", content: "da c2" })
    s.addNote({ projectId: "p1", content: "do projeto" })

    useStickyNotes.getState().clearConversationNotes("c1")

    const restantes = useStickyNotes.getState().notes
    expect(restantes.map((n) => n.content).sort()).toEqual(["da c2", "do projeto"])
  })
})

describe("o alvo da nota vem do registry", () => {
  it("apelido antigo do localStorage ainda encontra o agent", () => {
    // A gaveta gravava `claude`; o registry chama de `claude-code`. Sem
    // normalizar, a nota de ontem perdia o destino hoje.
    expect(normalizarAlvo("claude")).toBe("claude-code")
    expect(rotuloDoAlvo("claude")).toBe("Claude Code")
  })

  it("alvo desconhecido vira 'Geral' em vez de sumir da lista", () => {
    // Nota que some porque o destino envelheceu é a pior falha possível aqui:
    // ela não avisa.
    expect(normalizarAlvo("agent-que-nao-existe")).toBe(ALVO_QUALQUER)
    expect(normalizarAlvo(undefined)).toBe(ALVO_QUALQUER)
  })

  it("a lista de alvos deriva do registry, não de nomes escritos à mão", () => {
    const ids = alvosDeNota().map((a) => a.id)
    expect(ids[0]).toBe(ALVO_QUALQUER)
    // Os ids depois do "Geral" são exatamente os do registry, na ordem dele.
    expect(ids.slice(1)).toEqual(DESTINATIONS.map((d) => d.id))
    // E o apelido que a versão anterior usava NÃO está entre eles.
    expect(ids).not.toContain("claude")
  })

  it("o filtro por alvo casa a nota gravada com apelido antigo", () => {
    const notas = [
      { ...base, id: "a", targetAgent: "claude" },
      { ...base, id: "b", targetAgent: "codex" },
    ]
    expect(
      selectNotesFor(notas, { filtro: "claude-code" }).map((n) => n.id),
    ).toEqual(["a"])
  })
})

describe("addNote de quem guarda do composer", () => {
  it("respeita id, anexos e origem, e não abre a gaveta com abrir: false", () => {
    useStickyNotes.setState({ notes: [], dockOpen: false })
    const anexo = {
      path: "attachments/notes/n-guardada/4df9cc61137de769.png",
      name: "image.png",
      kind: "image" as const,
      mime: "image/png",
      bytes: 581018,
    }
    const nota = useStickyNotes
      .getState()
      .addNote({ id: "n-guardada", content: "revisar o aviso", attachments: [anexo], origem: "composer" }, { abrir: false })
    expect(nota).toMatchObject({ id: "n-guardada", attachments: [anexo], origem: "composer" })
    expect(useStickyNotes.getState().dockOpen).toBe(false)
    useStickyNotes.getState().addNote({ content: "da gaveta" })
    expect(useStickyNotes.getState().dockOpen).toBe(true)
    expect(useStickyNotes.getState().notes[0].origem).toBeUndefined()
  })
})
