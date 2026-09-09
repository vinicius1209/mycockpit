import { describe, expect, it, vi } from "vitest"
import { comRedeDePreparo, type EstadoDoPreparo } from "./redeDePreparo"

function estadoFalso(conversas: string[]) {
  const limpezas: [string, string][] = []
  const estado: EstadoDoPreparo = {
    conversas: () => conversas,
    limpar: (convId, runId) => {
      limpezas.push([convId, runId])
    },
  }
  return { estado, limpezas }
}

describe("comRedeDePreparo", () => {
  it("despacho limpo passa e não limpa nada", async () => {
    const { estado, limpezas } = estadoFalso(["c1", "c2"])
    const ok = await comRedeDePreparo("r1", estado, async () => {})
    expect(ok).toBe(true)
    expect(limpezas).toEqual([])
  })

  it("passa o MESMO runId pro despacho (é o que a rede vai apagar depois)", async () => {
    const { estado } = estadoFalso([])
    const visto: string[] = []
    await comRedeDePreparo("r-42", estado, async (runId) => {
      visto.push(runId)
    })
    expect(visto).toEqual(["r-42"])
  })

  it("estouro no preparo apaga o carimbo em vez de travar a conversa", async () => {
    const { estado, limpezas } = estadoFalso(["c1", "c2", "c3"])
    const ok = await comRedeDePreparo("r1", estado, async () => {
      throw new Error("readDoctrine explodiu")
    })
    expect(ok).toBe(false)
    // A varredura é intencional: quem não prepara ESTE run ignora a limpeza.
    expect(limpezas).toEqual([
      ["c1", "r1"],
      ["c2", "r1"],
      ["c3", "r1"],
    ])
  })

  it("estouro SÍNCRONO também é pego (nem toda falha vira promessa rejeitada)", async () => {
    const { estado, limpezas } = estadoFalso(["c1"])
    const ok = await comRedeDePreparo("r1", estado, () => {
      throw new Error("estourou antes do primeiro await")
    })
    expect(ok).toBe(false)
    expect(limpezas).toEqual([["c1", "r1"]])
  })

  it("nada de catch mudo: a falha deixa rastro pra quem for depurar", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    const { estado } = estadoFalso([])
    await comRedeDePreparo("r1", estado, async () => {
      throw new Error("boom")
    })
    expect(erro).toHaveBeenCalled()
    erro.mockRestore()
  })

  it("sem conversa nenhuma na store, a rede não quebra", async () => {
    const { estado, limpezas } = estadoFalso([])
    const ok = await comRedeDePreparo("r1", estado, async () => {
      throw new Error("boom")
    })
    expect(ok).toBe(false)
    expect(limpezas).toEqual([])
  })
})
