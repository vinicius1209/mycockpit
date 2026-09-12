import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { MarcoDeCorte } from "@/components/chat/MarcoDeCorte"
import type { CausaDoCorte } from "@/lib/corte"

// Item `cancelled` REAL da conversa "[feat] cliente coleta" (09/09/2026).
const CORTE_REAL = { kind: "cancelled" as const, id: "corte-coleta", ts: 1_788_962_247_781 }

afterEach(() => {
  vi.useRealTimers()
})

function marco(cause?: CausaDoCorte, agora = CORTE_REAL.ts + 86_400_000): string {
  vi.useFakeTimers()
  vi.setSystemTime(agora)
  return renderToStaticMarkup(
    <MarcoDeCorte item={cause ? { ...CORTE_REAL, cause } : CORTE_REAL} />,
  )
}

describe("MarcoDeCorte: o fio diz quem cortou", () => {
  it("envio forçado durante o turno", () => {
    expect(marco("correcao")).toContain("você interrompeu para corrigir")
  })

  it("botão Parar", () => {
    expect(marco("parada")).toContain("você interrompeu o turno")
  })

  it("disputa abortada", () => {
    expect(marco("disputa")).toContain("você interrompeu a disputa")
  })

  it("o corte real de 09/09, gravado antes da causa existir, não ganha autor inventado", () => {
    const html = marco(undefined)
    expect(html).toContain("interrompido")
    expect(html).not.toContain("você")
  })
})

describe("MarcoDeCorte: entrada só quando nasce agora", () => {
  it("corte que acabou de acontecer acende", () => {
    expect(marco("correcao", CORTE_REAL.ts + 30)).toContain("fio-nasce")
  })

  it("corte relido no dia seguinte chega pronto", () => {
    expect(marco("correcao")).not.toContain("fio-nasce")
  })
})
