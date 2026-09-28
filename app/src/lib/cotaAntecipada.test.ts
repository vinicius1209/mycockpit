import { beforeEach, describe, expect, it } from "vitest"
import type { UsageSnapshot } from "@/lib/usageWindow"
import {
  _resetEpisodios,
  chaveDoEpisodio,
  cotaPerto,
  dispensarEpisodio,
  episodioDispensado,
  folgaDoMotor,
  temPlanoComFolga,
} from "./cotaAntecipada"

// A FORMA é a dos snapshots reais do medidor (`usageWindow.test.ts`: statusline
// do Claude e rpc do Codex); só os percentuais mudam por cenário.
const AGORA = 1_786_543_000_000
const RESET_5H = 1_786_557_000 // ~3h50 depois de AGORA

function claude(usado5h: number, fetchedAt = AGORA): UsageSnapshot {
  return {
    agent: "claude-code",
    source: "statusline",
    windows: [
      { id: "5h", label: "5 h", usedPercent: usado5h, resetsAt: RESET_5H, windowMinutes: 300 },
      { id: "7d", label: "7 dias", usedPercent: 28.999999999999996, resetsAt: 1_786_996_800, windowMinutes: 10_080 },
    ],
    planType: null,
    fetchedAt,
  }
}

const CODEX: UsageSnapshot = {
  agent: "codex",
  source: "rpc",
  windows: [{ id: "7d", label: "7 dias", usedPercent: 30, resetsAt: 1_787_056_559, windowMinutes: 10_080 }],
  planType: "plus",
  fetchedAt: AGORA,
}

beforeEach(() => _resetEpisodios())

describe("a cota avisa antes de acabar", () => {
  it("abaixo do limiar e sem ritmo, nada", () => {
    expect(cotaPerto(claude(62), undefined, AGORA)).toBeNull()
  })

  it("a partir de 85% numa janela lida, está perto", () => {
    const p = cotaPerto(claude(91), undefined, AGORA)
    expect(p?.motivo).toBe("limiar")
    expect(p?.janela.id).toBe("5h")
  })

  it("janela esgotada não é perto: é o caso da cota esgotada", () => {
    expect(cotaPerto(claude(100), undefined, AGORA)).toBeNull()
  })

  it("janela que já virou não conta", () => {
    expect(cotaPerto(claude(91), undefined, RESET_5H * 1000 + 1)).toBeNull()
  })

  it("leitura velha (mais de 30 min) não afirma nada", () => {
    expect(cotaPerto(claude(91), undefined, AGORA + 31 * 60_000)).toBeNull()
  })

  it("o ritmo de duas leituras da mesma janela diz quando acaba", () => {
    // 60% → 78% em 1 h: chega a 100% em ~1h13, antes do reset (~3h50).
    const anterior = claude(60, AGORA - 60 * 60_000)
    const p = cotaPerto(claude(78), anterior, AGORA)
    expect(p?.motivo).toBe("ritmo")
    expect(p?.acabaEm).toBeGreaterThan(AGORA)
    expect(p!.acabaEm!).toBeLessThan(RESET_5H * 1000)
  })

  it("uma leitura só não projeta", () => {
    expect(cotaPerto(claude(78), undefined, AGORA)).toBeNull()
  })

  it("uso parado não projeta", () => {
    expect(cotaPerto(claude(78), claude(78, AGORA - 60 * 60_000), AGORA)).toBeNull()
  })

  it("ritmo que só acaba depois do reset não avisa", () => {
    // 60% → 62% em 1 h: 100% em 19 h, bem depois do reset.
    expect(cotaPerto(claude(62), claude(60, AGORA - 60 * 60_000), AGORA)).toBeNull()
  })
})

describe("a folga de cada destino", () => {
  it("motor com medidor e leitura recente mostra quanto está livre pela pior janela", () => {
    expect(folgaDoMotor("codex", CODEX, AGORA)).toEqual({ tipo: "folga", livre: 70, janela: "7 dias", leituraEm: AGORA })
  })

  it("motor sem medidor nunca ganha folga inventada", () => {
    expect(folgaDoMotor("opencode", undefined, AGORA)).toEqual({ tipo: "sem-medidor" })
  })

  it("motor com medidor sem leitura recente não é sugerido", () => {
    expect(folgaDoMotor("agy", undefined, AGORA)).toEqual({ tipo: "sem-leitura" })
    expect(temPlanoComFolga([{ tipo: "sem-leitura" }, { tipo: "sem-medidor" }])).toBe(false)
  })

  it("só sugere com folga de verdade", () => {
    expect(temPlanoComFolga([{ tipo: "folga", livre: 12, janela: "5 h", leituraEm: AGORA }])).toBe(false)
    expect(temPlanoComFolga([{ tipo: "folga", livre: 70, janela: "7 dias", leituraEm: AGORA }])).toBe(true)
  })
})

describe("Agora não encerra o episódio", () => {
  it("vale para a mesma janela até ela virar", () => {
    const p = cotaPerto(claude(91), undefined, AGORA)!
    const chave = chaveDoEpisodio("c1", "claude-code", p)
    dispensarEpisodio(chave)
    expect(episodioDispensado(chave)).toBe(true)
    const outraJanela = { ...p, janela: { ...p.janela, resetsAt: RESET_5H + 18_000 } }
    expect(episodioDispensado(chaveDoEpisodio("c1", "claude-code", outraJanela))).toBe(false)
  })
})
