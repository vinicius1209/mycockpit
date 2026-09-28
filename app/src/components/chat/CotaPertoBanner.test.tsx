import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Perto } from "@/lib/cotaAntecipada"
import { DetalheDaCota, resumoDaCota, textoDaFolga, textoDoAviso, type DestinoComFolga } from "./CotaPertoBanner"

// Janela na forma real do medidor (statusline do Claude), com o uso do cenário.
const AGORA = new Date(2026, 8, 27, 15, 50).getTime()
const VOLTA = new Date(2026, 8, 27, 18, 0).getTime()
const janela = { id: "5h", label: "5 h", usedPercent: 91, resetsAt: VOLTA / 1000, windowMinutes: 300 }

const PERTO: Perto = { janela, motivo: "limiar", acabaEm: null, leituraEm: AGORA - 3 * 60_000 }

const DESTINOS: DestinoComFolga[] = [
  { id: "codex", label: "Codex", folga: { tipo: "folga", livre: 70, janela: "7 dias", leituraEm: AGORA }, gastoHoje: null },
  { id: "agy", label: "Antigravity", folga: { tipo: "sem-leitura" }, gastoHoje: null },
  { id: "opencode", label: "OpenCode", folga: { tipo: "sem-medidor" }, gastoHoje: 0.42 },
]

describe("o aviso antes de a cota acabar", () => {
  it("perto do limite diz quanto foi usado, quando volta e que nada muda sozinho", () => {
    const t = textoDoAviso("Claude Code", PERTO, AGORA)
    expect(t.titulo).toBe("Claude Code perto do limite (5 h)")
    expect(t.detalhe).toContain("91% usado · volta às 18:00 (em 2h 10min).")
    expect(t.detalhe).toContain("Nada muda até você escolher.")
  })

  it("pelo ritmo, diz a hora estimada e que é estimativa", () => {
    const acaba = new Date(2026, 8, 27, 16, 40).getTime()
    const t = textoDoAviso("Claude Code", { ...PERTO, motivo: "ritmo", acabaEm: acaba, janela: { ...janela, usedPercent: 78 } }, AGORA)
    expect(t.titulo).toBe("No ritmo de agora, Claude Code acaba antes de voltar")
    expect(t.detalhe).toContain("Chega a 100% por volta das 16:40")
    expect(t.detalhe).toContain("Estimativa pelo ritmo medido, não promessa.")
  })

  it("cada destino diz o que se sabe dele, sem inventar folga", () => {
    expect(DESTINOS.map(textoDaFolga)).toEqual(["70% livre · 7 dias", "sem leitura recente", "sem medidor · US$ 0,420 hoje"])
  })

  it("a tira resume numa linha: o motor e quanto foi usado", () => {
    expect(resumoDaCota("Claude Code", PERTO)).toBe("Claude Code 91%")
  })

  it("a gaveta mostra os destinos, trava o sem leitura e oferece Dispensar, não Agora não", () => {
    const html = renderToStaticMarkup(
      createElement(DetalheDaCota, {
        sourceLabel: "Claude Code",
        perto: PERTO,
        destinos: DESTINOS,
        now: AGORA,
        onSelect: () => {},
        onDispensar: () => {},
      }),
    )
    expect(html).toContain("Próximo envio com:")
    expect(html).toContain("70% livre · 7 dias")
    expect(html).toContain(">Dispensar<")
    expect(html).toContain("até a janela de 5 h virar")
    expect(html).not.toContain("Agora não")
    expect(html).toContain("Leitura há 3 min.")
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Antigravity/)
  })
})
