// Truncamento PELO COMEÇO do parcial (clipPartialStart): as últimas palavras
// ditas ficam sempre visíveis — o excesso some pelo início, com "…".
// E a fase do pill (dictationPillView): soltar o botão não é o fim.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  DictationPill,
  PARTIAL_CLIP_CHARS,
  clipPartialStart,
  dictationPillView,
  inputSignalBars,
  inputSignalLabel,
} from "./DictationOverlay"

describe("clipPartialStart", () => {
  it("texto curto passa intacto (sem reticências)", () => {
    expect(clipPartialStart("oi, tudo bem")).toBe("oi, tudo bem")
  })

  it("normaliza espaços repetidos e bordas", () => {
    expect(clipPartialStart("  a  b\n c ")).toBe("a b c")
  })

  it("texto longo: corta pelo COMEÇO e prefixa …", () => {
    const long = `${"blá ".repeat(80)}palavras finais`
    const out = clipPartialStart(long)
    expect(out.startsWith("…")).toBe(true)
    expect(out.endsWith("palavras finais")).toBe(true)
    expect(out.length).toBeLessThanOrEqual(PARTIAL_CLIP_CHARS + 1)
  })

  it("corta em fronteira de palavra quando ela está perto do corte", () => {
    const long = `início ${"x".repeat(10)} ${"palavra ".repeat(30)}fim`
    const out = clipPartialStart(long, 60)
    // nunca começa com pedaço de palavra ("…alavra") — o resto após o corte
    // em fronteira só contém palavras inteiras da cauda.
    expect(out).toMatch(/^…(palavra )+fim$/)
  })

  it("sem espaço perto do corte (palavra gigante): mantém a cauda crua", () => {
    const out = clipPartialStart("a".repeat(300), 50)
    expect(out).toBe(`…${"a".repeat(50)}`)
  })

  it("max exato não trunca", () => {
    const t = "b".repeat(100)
    expect(clipPartialStart(t, 100)).toBe(t)
  })
})

describe("dictationPillView", () => {
  it("gravando: pill de pé, em vermelho, sem estado de finalização", () => {
    const v = dictationPillView("rec")
    expect(v.visible).toBe(true)
    expect(v.finalizing).toBe(false)
    expect(v.placeholder).toBe("Ouvindo…")
    // dica default do pill (Esc + atalho) — a fase não sobrescreve
    expect(v.hint).toBeUndefined()
  })

  it("busy: o pill CONTINUA de pé, dizendo que está finalizando", () => {
    const v = dictationPillView("busy")
    expect(v.visible).toBe(true)
    expect(v.finalizing).toBe(true)
    expect(v.placeholder).toBe("Finalizando…")
    expect(v.hint).toBeTruthy()
  })

  it("idle e starting: sem pill (não há gravação pra mostrar)", () => {
    expect(dictationPillView("idle").visible).toBe(false)
    expect(dictationPillView("starting").visible).toBe(false)
  })

  it("nenhuma copy usa travessão", () => {
    const textos = (["idle", "starting", "rec", "busy"] as const).flatMap(
      (p) => {
        const v = dictationPillView(p)
        return [v.placeholder, v.hint ?? ""]
      },
    )
    expect(textos.some((t) => t.includes("—"))).toBe(false)
  })
})

describe("medidor de entrada", () => {
  it("silêncio mantém as três barras no piso", () => {
    expect(inputSignalBars(0)).toEqual([3, 3, 3])
    expect(inputSignalLabel(0)).toBe("Sem sinal do microfone")
  })

  it("sinal real aumenta as barras sem passar do teto", () => {
    expect(inputSignalBars(0.5)).toEqual([6, 8, 7])
    expect(inputSignalBars(10)).toEqual([8, 12, 10])
    expect(inputSignalLabel(0.5)).toBe("Sinal presente no microfone")
  })

  it("valor inválido degrada para ausência de sinal", () => {
    expect(inputSignalBars(Number.NaN)).toEqual([3, 3, 3])
    expect(inputSignalLabel(Number.NaN)).toBe("Sem sinal do microfone")
  })

  it("publica no pill o device efetivo e o nível acessível", () => {
    const html = renderToStaticMarkup(
      createElement(DictationPill, {
        partial: null,
        since: Date.now(),
        deviceName: "Microfone (MacBook Pro)",
        level: 0.42,
      }),
    )
    expect(html).toContain("Microfone (MacBook Pro)")
    expect(html).toContain('role="meter"')
    expect(html).toContain('aria-valuenow="42"')
    expect(html).toContain('aria-label="Sinal presente no microfone"')
  })
})
