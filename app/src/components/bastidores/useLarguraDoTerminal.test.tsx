/** @vitest-environment jsdom */
// Erro real do Frota.log de 21/09/2026: "Layout not found for Panel context",
// lançado por `getSize()` quando o painel direito monta com o terminal dos
// Bastidores já aberto. O ref existe antes de o grupo registrar o painel.
import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { LARGURA_DO_TERMINAL, useLarguraDoTerminal } from "./useLarguraDoTerminal"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function painel(prontoDepoisDe: number, tamanho = 30) {
  let chamadas = 0
  const resize = vi.fn()
  const p = {
    getSize: () => {
      if (++chamadas <= prontoDepoisDe) throw new Error("Layout not found for Panel context")
      return { asPercentage: tamanho, inPixels: 0 }
    },
    resize,
  } as unknown as PanelImperativeHandle
  return { ref: { current: p }, resize }
}

describe("useLarguraDoTerminal", () => {
  it("painel ainda fora do layout não derruba o efeito, e alarga quando entra", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] })
    const { ref, resize } = painel(2)
    expect(() => renderHook(() => useLarguraDoTerminal(ref, true))).not.toThrow()
    expect(resize).not.toHaveBeenCalled()
    vi.advanceTimersToNextFrame()
    vi.advanceTimersToNextFrame()
    expect(resize).toHaveBeenCalledWith(`${LARGURA_DO_TERMINAL}%`)
  })

  it("painel que nunca entra no layout: desiste sem mexer em nada", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] })
    const { ref, resize } = painel(Number.POSITIVE_INFINITY)
    renderHook(() => useLarguraDoTerminal(ref, true))
    for (let i = 0; i < 20; i++) vi.advanceTimersToNextFrame()
    expect(resize).not.toHaveBeenCalled()
  })

  it("com o painel pronto, alarga na hora e devolve a largura ao fechar", () => {
    const { ref, resize } = painel(0, 30)
    const { rerender } = renderHook(({ aberto }) => useLarguraDoTerminal(ref, aberto), {
      initialProps: { aberto: true },
    })
    expect(resize).toHaveBeenLastCalledWith(`${LARGURA_DO_TERMINAL}%`)
    rerender({ aberto: false })
    expect(resize).toHaveBeenLastCalledWith("30%")
  })
})
