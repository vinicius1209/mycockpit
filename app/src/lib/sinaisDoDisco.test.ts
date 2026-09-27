/** @vitest-environment jsdom */
// Os sinais de "a pasta pode ter mudado", agora compartilhados pela aba
// Alterações e pelo editor. O que é novo aqui é a gravação feita pelo app.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assinarMudancasNaPasta, avisarGravacao } from "@/lib/sinaisDoDisco"

const PASTA = "/Users/viniciusmachado/projetos/frota"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("sinais do disco", () => {
  it("gravar pelo app acorda só quem assina a mesma pasta, amortecido", () => {
    const aqui = vi.fn()
    const outra = vi.fn()
    const sair1 = assinarMudancasNaPasta(PASTA, aqui)
    const sair2 = assinarMudancasNaPasta("/outro/projeto", outra)
    avisarGravacao(PASTA)
    avisarGravacao(PASTA)
    expect(aqui).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(aqui).toHaveBeenCalledTimes(1)
    expect(outra).not.toHaveBeenCalled()
    sair1()
    sair2()
  })

  it("depois de desligar, nada mais chega", () => {
    const f = vi.fn()
    const sair = assinarMudancasNaPasta(PASTA, f)
    sair()
    avisarGravacao(PASTA)
    window.dispatchEvent(new Event("focus"))
    vi.advanceTimersByTime(1000)
    expect(f).not.toHaveBeenCalled()
  })

  it("a janela voltando ao foco acorda", () => {
    const f = vi.fn()
    const sair = assinarMudancasNaPasta(PASTA, f)
    window.dispatchEvent(new Event("focus"))
    vi.advanceTimersByTime(700)
    expect(f).toHaveBeenCalledTimes(1)
    sair()
  })
})

describe("uma assinatura por pasta", () => {
  it("dois ouvintes da mesma pasta não duplicam a varredura do chat", async () => {
    const { useChat } = await import("@/store/chat")
    const assinar = vi.spyOn(useChat, "subscribe")
    const a = assinarMudancasNaPasta(PASTA, vi.fn())
    const b = assinarMudancasNaPasta(PASTA, vi.fn())
    expect(assinar).toHaveBeenCalledTimes(1)
    a()
    b()
    // a última saída desliga; a próxima assina de novo
    const c = assinarMudancasNaPasta(PASTA, vi.fn())
    expect(assinar).toHaveBeenCalledTimes(2)
    c()
    assinar.mockRestore()
  })
})
