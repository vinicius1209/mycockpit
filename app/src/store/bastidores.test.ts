import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  VISTAS_MAX,
  abrirVista,
  chaveDaSaida,
  fixarVista,
  useBastidores,
  vistasDa,
  type VistaAberta,
} from "./bastidores"

const v = (itemId: string, convId = "c1"): VistaAberta => ({ convId, itemId })

describe("regras do mosaico (ADR-200)", () => {
  it("abrir sem vistas cria a primeira; abrir de novo o mesmo só foca", () => {
    const a = abrirVista([], 0, v("x"))
    expect(a).toEqual({ vistas: [v("x")], foco: 0 })
    expect(abrirVista(a.vistas, 0, v("x"))).toEqual(a)
  })

  it("abrir outro substitui a vista em foco, não soma", () => {
    const r = abrirVista([v("a"), v("b")], 1, v("c"))
    expect(r.vistas).toEqual([v("a"), v("c")])
    expect(r.foco).toBe(1)
  })

  it("fixar soma até três; cheio, sai a mais antiga fora de foco", () => {
    let r: { vistas: VistaAberta[]; foco: number } = { vistas: [], foco: 0 }
    for (const id of ["a", "b", "c"]) r = fixarVista(r.vistas, r.foco, v(id))
    expect(r.vistas).toHaveLength(VISTAS_MAX)
    r = fixarVista(r.vistas, 0, v("d"))
    expect(r.vistas.map((x) => x.itemId)).toEqual(["a", "c", "d"])
  })

  it("cada conversa tem suas vistas", () => {
    const r = fixarVista([v("a"), v("b"), v("c")], 0, v("z", "c2"))
    expect(vistasDa(r.vistas, "c2")).toEqual([v("z", "c2")])
    expect(vistasDa(r.vistas, "c1")).toHaveLength(3)
  })
})

describe("saída ao vivo agrupada", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useBastidores.setState({ vistas: [], foco: 0, saidas: {} })
  })
  afterEach(() => vi.useRealTimers())

  it("vários deltas no mesmo intervalo viram uma entrega só", () => {
    const sets = vi.fn()
    const unsub = useBastidores.subscribe(sets)
    const { anexarSaida } = useBastidores.getState()
    anexarSaida("c1", "item-cmd-1", "cx 2\n")
    anexarSaida("c1", "item-cmd-1", "cx 3\n")
    anexarSaida("c1", "item-cmd-1", "fim\n")
    expect(sets).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(sets).toHaveBeenCalledTimes(1)
    expect(
      useBastidores.getState().saidas[chaveDaSaida("c1", "item-cmd-1")].linhas,
    ).toEqual(["cx 2", "cx 3", "fim"])
    unsub()
  })
})
