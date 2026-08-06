// Truncamento PELO COMEÇO do parcial (clipPartialStart): as últimas palavras
// ditas ficam sempre visíveis — o excesso some pelo início, com "…".
// E a fase do pill (dictationPillView): soltar o botão não é o fim.
import { describe, expect, it } from "vitest"
import {
  PARTIAL_CLIP_CHARS,
  clipPartialStart,
  dictationPillView,
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
