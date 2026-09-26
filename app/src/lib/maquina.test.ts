import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { fmtGb, fraseDoSono, linhaDoSono, tomDaMaquina, turnosNaMaquina, type EstadoDoSono } from "./maquina"

// Leitura REAL desta máquina (26/09/2026, `sistema::tests::sonda`):
// "mem 10397/16384 MB · cpu 31% · 8 núcleos".
const REAL = { memUsadaMb: 10_397, memTotalMb: 16_384, cpuPct: 31, nucleos: 8 }

describe("a máquina na faixa (ADR-262)", () => {
  it("GB com uma casa quando ela diz algo", () => {
    expect(fmtGb(REAL.memUsadaMb)).toBe("10")
    expect(fmtGb(REAL.memTotalMb)).toBe("16")
    expect(fmtGb(2_457)).toBe("2,4")
    expect(fmtGb(1_024)).toBe("1")
  })

  it("cinza no normal; âmbar com a memória apertada ou um turno pesado; vermelho no limite", () => {
    expect(tomDaMaquina(REAL, 2_400)).toBe("ok")
    expect(tomDaMaquina(REAL, 4_200)).toBe("warn")
    expect(tomDaMaquina({ ...REAL, memUsadaMb: 14_500 }, 0)).toBe("warn")
    expect(tomDaMaquina({ ...REAL, memUsadaMb: 15_800 }, 0)).toBe("danger")
  })

  it("só turnos vivos e medidos, do maior para o menor", () => {
    const l = {
      a: { rssMb: 1_300, descendants: 6 },
      b: { rssMb: 2_457, descendants: 18 },
      c: { rssMb: 900, descendants: 2 }, // turno já acabou
      d: { rssMb: null, descendants: null }, // ainda sem medida
    }
    expect(turnosNaMaquina(l, new Set(["a", "b", "d"])).map((t) => t.convId)).toEqual(["b", "a"])
  })
})

describe("o sono da máquina (manter acordado)", () => {
  const sono = (e: Partial<EstadoDoSono>): EstadoDoSono => ({
    acordado: false,
    modo: "agent",
    falhou: false,
    suportado: true,
    turnos: 0,
    ...e,
  })

  it("com agente: diz quantos turnos seguram, ou que nada roda", () => {
    expect(linhaDoSono(sono({ acordado: true, turnos: 2 }))).toEqual({
      texto: "Mantendo acordado",
      detalhe: "com agente · 2 turnos",
      tom: "vivo",
    })
    expect(linhaDoSono(sono({}))).toEqual({
      texto: "Dorme normalmente",
      detalhe: "com agente · nada rodando",
      tom: "quieto",
    })
    expect(fraseDoSono(sono({ acordado: true, turnos: 1 }))).toBe(
      "Mantendo acordado enquanto 1 turno roda.",
    )
  })

  it("sempre e nunca dizem o modo, sem contagem", () => {
    expect(linhaDoSono(sono({ acordado: true, modo: "on" }))?.detalhe).toBe("sempre")
    expect(linhaDoSono(sono({ modo: "off" }))?.detalhe).toBe("nunca")
    expect(fraseDoSono(sono({ acordado: true, modo: "on" }))).toBe(
      "Mantendo acordado enquanto o app estiver aberto.",
    )
  })

  it("a xícara vem do estado real: a preferência sozinha não acorda nada", () => {
    // "Sempre" pedido, mas a trava não existe (ainda não abriu): não mente.
    expect(linhaDoSono(sono({ modo: "on", acordado: false }))?.texto).toBe("Dorme normalmente")
  })

  it("falha de abrir a trava aparece em âmbar, nunca some", () => {
    const l = linhaDoSono(sono({ falhou: true, modo: "on" }))
    expect(l?.tom).toBe("warn")
    expect(l?.texto).toBe("Não consegui segurar o sono")
  })

  it("onde o Frota não segura o sono, a linha some e o painel diz por quê", () => {
    expect(linhaDoSono(sono({ suportado: false }))).toBeNull()
    expect(fraseDoSono(sono({ suportado: false }))).toBe("Neste sistema o Frota não segura o sono.")
  })
})
