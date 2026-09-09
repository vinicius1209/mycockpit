import { beforeEach, describe, expect, it } from "vitest"
import {
  _assinantesDoOlhar,
  _resetOlhar,
  _setAmbienteDoOlhar,
  olharAgora,
  olharDisponivel,
  subscribeOlhar,
  type AmbienteDoOlhar,
} from "@/lib/olhar"

/** Janela de mentira: conta assinaturas, segura os handlers e deixa o teste
 *  decidir quando o quadro roda. É o que permite provar o coalescimento sem
 *  navegador (a suíte roda em node). */
function ambienteFalso(opcoes: { aceita?: boolean; comQuadro?: boolean } = {}) {
  const { aceita = true, comQuadro = true } = opcoes
  const handlers = new Map<string, ((e: unknown) => void)[]>()
  const quadros = new Map<number, () => void>()
  let proximoId = 1
  const contagem = { ouvir: 0, parar: 0, quadrosAgendados: 0 }

  const ambiente: AmbienteDoOlhar = {
    aceita: () => aceita,
    ouvir: (tipo, fn) => {
      contagem.ouvir++
      handlers.set(tipo, [...(handlers.get(tipo) ?? []), fn])
    },
    parar: (tipo, fn) => {
      contagem.parar++
      handlers.set(tipo, (handlers.get(tipo) ?? []).filter((h) => h !== fn))
    },
    agendarQuadro: (fn) => {
      if (!comQuadro) return null
      contagem.quadrosAgendados++
      const id = proximoId++
      quadros.set(id, fn)
      return id
    },
    cancelarQuadro: (id) => {
      quadros.delete(id)
    },
  }

  return {
    ambiente,
    contagem,
    quantos: (tipo: string) => (handlers.get(tipo) ?? []).length,
    /** Dispara um `pointermove` de mouse na posição dada. */
    mover: (x: number, y: number, pointerType = "mouse") => {
      for (const h of handlers.get("pointermove") ?? []) {
        h({ pointerType, clientX: x, clientY: y })
      }
    },
    sair: () => {
      for (const h of handlers.get("pointerleave") ?? []) h({})
    },
    /** Roda os quadros pendentes (o que o rAF do navegador faria). */
    pintar: () => {
      const pendentes = [...quadros.values()]
      quadros.clear()
      for (const fn of pendentes) fn()
    },
  }
}

let restaurar: () => void = () => {}

beforeEach(() => {
  restaurar()
  _resetOlhar()
  restaurar = () => {}
})

describe("disponibilidade", () => {
  it("ambiente que aceita: há olhar", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    expect(olharDisponivel()).toBe(true)
  })

  it("ambiente que recusa (movimento reduzido, toque, sem janela): não há olhar", () => {
    const j = ambienteFalso({ aceita: false })
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    expect(olharDisponivel()).toBe(false)
  })

  it("recusado, nem chega a ouvir o ponteiro, e a posição fica nula", () => {
    const j = ambienteFalso({ aceita: false })
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    expect(j.contagem.ouvir).toBe(0)
    expect(olharAgora()).toBeNull()
    off()
  })

  it("em node, sem janela, o default é inerte: importar o módulo não quebra", () => {
    // Sem `_setAmbienteDoOlhar`: é o ambiente real do teste (node puro).
    expect(olharDisponivel()).toBe(false)
    const off = subscribeOlhar(() => {})
    expect(olharAgora()).toBeNull()
    off()
  })
})

describe("ouvinte único", () => {
  it("um `pointermove` de janela para N assinantes, não um por cara", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const a = subscribeOlhar(() => {})
    const b = subscribeOlhar(() => {})
    const c = subscribeOlhar(() => {})
    expect(j.quantos("pointermove")).toBe(1)
    expect(_assinantesDoOlhar()).toBe(3)
    a()
    b()
    c()
  })

  it("o último a sair desliga o ouvinte (ouvinte não sobrevive à tela)", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const a = subscribeOlhar(() => {})
    const b = subscribeOlhar(() => {})
    a()
    expect(j.quantos("pointermove")).toBe(1)
    b()
    expect(j.quantos("pointermove")).toBe(0)
  })
})

describe("posição", () => {
  it("publica a posição do mouse depois do quadro", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const vistos: unknown[] = []
    const off = subscribeOlhar(() => vistos.push(olharAgora()))
    j.mover(10, 20)
    expect(olharAgora()).toBeNull() // ainda não pintou
    j.pintar()
    expect(olharAgora()).toEqual({ x: 10, y: 20 })
    expect(vistos).toEqual([{ x: 10, y: 20 }])
    off()
  })

  it("coalesce por quadro: dez movimentos viram UM aviso, com o último valor", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    let avisos = 0
    const off = subscribeOlhar(() => avisos++)
    for (let i = 0; i < 10; i++) j.mover(i, i)
    expect(j.contagem.quadrosAgendados).toBe(1)
    j.pintar()
    expect(avisos).toBe(1)
    expect(olharAgora()).toEqual({ x: 9, y: 9 })
    off()
  })

  it("toque não move o olhar: arrastar a tela não é pairar", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    j.mover(50, 50, "touch")
    j.pintar()
    expect(olharAgora()).toBeNull()
    off()
  })

  it("ponteiro fora da janela volta a null: não se mira num cursor que saiu", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    j.mover(5, 5)
    j.pintar()
    expect(olharAgora()).not.toBeNull()
    j.sair()
    j.pintar()
    expect(olharAgora()).toBeNull()
    off()
  })

  it("o snapshot é ESTÁVEL entre quadros (senão o React re-renderiza em laço)", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    j.mover(1, 2)
    j.pintar()
    expect(olharAgora()).toBe(olharAgora())
    off()
  })

  it("desligar limpa a posição: quem monta depois não herda um cursor velho", () => {
    const j = ambienteFalso()
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    j.mover(7, 7)
    j.pintar()
    off()
    expect(olharAgora()).toBeNull()
  })

  it("sem quadro no ambiente, despacha na hora (coalescer é otimização)", () => {
    const j = ambienteFalso({ comQuadro: false })
    restaurar = _setAmbienteDoOlhar(j.ambiente)
    const off = subscribeOlhar(() => {})
    j.mover(3, 4)
    expect(olharAgora()).toEqual({ x: 3, y: 4 })
    off()
  })
})
