import { beforeEach, describe, expect, it } from "vitest"
import { chaveDosComentarios, comentariosDa, useComentariosDoDiff } from "./comentariosDoDiff"
import type { DiffComment } from "@/lib/deliveryDiff"

const comentario = (id: string, path = "app/src/components/layout/MainTabs.tsx"): DiffComment => ({
  id,
  path,
  side: "new",
  lineNo: 42,
  codeText: "const vista = chaveDaVista(tab)",
  note: "isso aqui não devia cair na Conversa",
})

beforeEach(() => useComentariosDoDiff.setState({ porChave: {} }))

describe("comentários do diff sobrevivem a trocar de aba (ADR-251)", () => {
  it("guardar, editar a mesma linha e tirar", () => {
    const k = chaveDosComentarios("c1", "/repo")
    const s = useComentariosDoDiff.getState()
    s.guardar(k, comentario("a"))
    s.guardar(k, { ...comentario("a"), note: "editado" })
    expect(Object.keys(comentariosDa(useComentariosDoDiff.getState(), k))).toEqual(["a"])
    expect(comentariosDa(useComentariosDoDiff.getState(), k).a.note).toBe("editado")
    s.tirar(k, "a")
    expect(comentariosDa(useComentariosDoDiff.getState(), k)).toEqual({})
  })

  it("outra conversa ou outra pasta não vê a revisão desta", () => {
    useComentariosDoDiff.getState().guardar(chaveDosComentarios("c1", "/repo"), comentario("a"))
    const s = useComentariosDoDiff.getState()
    expect(comentariosDa(s, chaveDosComentarios("c2", "/repo"))).toEqual({})
    expect(comentariosDa(s, chaveDosComentarios("c1", "/repo/.frota/worktrees/x"))).toEqual({})
  })

  it("conversa apagada leva só a revisão dela", () => {
    const s = useComentariosDoDiff.getState()
    s.guardar(chaveDosComentarios("c1", "/repo"), comentario("a"))
    s.guardar(chaveDosComentarios("c1", "/wt"), comentario("b"))
    s.guardar(chaveDosComentarios("c10", "/repo"), comentario("c"))
    s.esquecerConversa("c1")
    expect(Object.keys(useComentariosDoDiff.getState().porChave)).toEqual([chaveDosComentarios("c10", "/repo")])
  })

  it("tirar ou limpar o que não existe não avisa ninguém", () => {
    let avisos = 0
    const desligar = useComentariosDoDiff.subscribe(() => {
      avisos++
    })
    useComentariosDoDiff.getState().tirar("x", "y")
    useComentariosDoDiff.getState().limpar("x")
    useComentariosDoDiff.getState().esquecerConversa("x")
    desligar()
    expect(avisos).toBe(0)
  })
})
