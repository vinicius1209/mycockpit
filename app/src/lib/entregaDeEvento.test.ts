import { describe, expect, it, vi } from "vitest"
import { AVISO_DE_FALHA_DE_ENTREGA, entregarSemTravar, relatoVisivel } from "./entregaDeEvento"

/** Réplica da regra de ordem do `Channel` de `@tauri-apps/api` 2.11.1
 *  (core.js): a mensagem de índice N só é entregue depois da N-1, e o índice
 *  só avança DEPOIS que `onmessage` retorna. */
function canalDoTauri<T>(onmessage: (m: T) => void) {
  let proximo = 0
  const pendentes: Record<number, T> = {}
  return (index: number, message: T) => {
    if (index !== proximo) {
      pendentes[index] = message
      return
    }
    onmessage(message)
    proximo++
    while (proximo in pendentes) {
      const m = pendentes[proximo]
      delete pendentes[proximo]
      onmessage(m)
      proximo++
    }
  }
}

type Evento = { type: string; text?: string }

function emitir(receber: (index: number, m: Evento) => void, eventos: Evento[]) {
  eventos.forEach((e, i) => {
    try {
      receber(i, e)
    } catch {
      // o callback do Tauri roda num eval; a exceção vira window.error e some
    }
  })
}

const TURNO: Evento[] = [
  { type: "text_delta", text: "Pronto: " },
  { type: "text_delta", text: "o fio " },
  { type: "text_delta", text: "inteiro" },
  { type: "result" },
]

describe("canal do run não trava quando um evento falha", () => {
  it("sem proteção, uma exceção congela o resto do turno (o incidente)", () => {
    const aplicados: string[] = []
    const handler = (e: Evento) => {
      if (e.text === "o fio ") throw new Error("Minified React error #185")
      aplicados.push(e.text ?? e.type)
    }
    emitir(canalDoTauri(handler), TURNO)
    expect(aplicados).toEqual(["Pronto: "])
  })

  it("com proteção, o evento que falhou é relatado e o resultado ainda chega", () => {
    const aplicados: string[] = []
    const relatar = vi.fn()
    const handler = (e: Evento) => {
      if (e.text === "o fio ") throw new Error("Minified React error #185")
      aplicados.push(e.text ?? e.type)
    }
    emitir(canalDoTauri(entregarSemTravar(handler, relatar)), TURNO)
    expect(aplicados).toEqual(["Pronto: ", "inteiro", "result"])
    expect(relatar).toHaveBeenCalledTimes(1)
    expect(relatar.mock.calls[0][0]).toEqual({ type: "text_delta", text: "o fio " })
  })

  it("sem falha, entrega tudo e não relata nada", () => {
    const relatar = vi.fn()
    const aplicados: string[] = []
    emitir(canalDoTauri(entregarSemTravar((e: Evento) => aplicados.push(e.type), relatar)), TURNO)
    expect(aplicados).toHaveLength(4)
    expect(relatar).not.toHaveBeenCalled()
  })

  it("o relato padrão vai para o log com o tipo do evento", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    entregarSemTravar(() => {
      throw new Error("x")
    })({ type: "result" })
    expect(erro.mock.calls[0][0]).toContain('"result"')
    erro.mockRestore()
  })
})

describe("a falha fica visível no fio, não só no log", () => {
  it("um aviso por run, emitido depois, fora da pilha que falhou", () => {
    const avisos: string[] = []
    const agendados: (() => void)[] = []
    const registrar = vi.fn()
    const relatar = relatoVisivel<Evento>((m) => avisos.push(m), (fn) => agendados.push(fn), registrar)
    const handler = (e: Evento) => {
      if (e.type === "text_delta") throw new Error("Minified React error #185")
    }
    emitir(canalDoTauri(entregarSemTravar(handler, relatar)), TURNO)
    // três deltas falharam: os três vão para o log, mas o aviso é um só
    expect(registrar).toHaveBeenCalledTimes(3)
    expect(avisos).toEqual([])
    expect(agendados).toHaveLength(1)
    agendados[0]()
    expect(avisos).toEqual([AVISO_DE_FALHA_DE_ENTREGA])
  })

  it("se até o aviso falhar, sobra o log e nada lança", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    const relatar = relatoVisivel<Evento>(
      () => {
        throw new Error("store quebrada")
      },
      (fn) => fn(),
      () => {},
    )
    expect(() => relatar({ type: "text_delta" }, new Error("x"))).not.toThrow()
    expect(erro.mock.calls.some((c) => String(c[0]).includes("nem o aviso"))).toBe(true)
    erro.mockRestore()
  })

  it("o aviso não tem travessão e diz onde está o detalhe", () => {
    expect(AVISO_DE_FALHA_DE_ENTREGA).not.toContain("—")
    expect(AVISO_DE_FALHA_DE_ENTREGA).toContain("log do app")
  })
})
