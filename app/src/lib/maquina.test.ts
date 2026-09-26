import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))

import { fmtGb, tomDaMaquina, turnosNaMaquina } from "./maquina"

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
