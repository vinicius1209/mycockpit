import { describe, expect, it } from "vitest"
import {
  alturaDaPista,
  deveTeleportar,
  molaParada,
  passoDaMola,
  RECUO_DA_PISTA_PX,
  type EstadoDaMola,
} from "@/components/chat/molaDoFio"

/** Roda a mola quadro a quadro até assentar (ou estourar o teto). */
function perseguir(inicio: EstadoDaMola, alvoNoQuadro: (i: number) => number, teto = 600) {
  let e = inicio
  const posicoes: number[] = []
  for (let i = 0; i < teto; i++) {
    const r = passoDaMola(e, alvoNoQuadro(i), 1)
    e = r.estado
    posicoes.push(e.pos)
    if (r.assentou) return { e, posicoes, quadros: i + 1 }
  }
  return { e, posicoes, quadros: Infinity }
}

describe("mola do fim do fio", () => {
  it("chega ao fim sem passar dele e assenta, parando o laço", () => {
    const { e, posicoes, quadros } = perseguir(molaParada(0), () => 22)
    expect(quadros).toBeLessThan(120)
    expect(e.pos).toBe(22)
    expect(Math.max(...posicoes)).toBeLessThanOrEqual(22)
  })

  it("sobe em vários quadros, não num degrau só", () => {
    const { posicoes } = perseguir(molaParada(0), () => 22)
    // O primeiro quadro anda uma fração da linha: é isso que tira o degrau.
    expect(posicoes[0]).toBeGreaterThan(0)
    expect(posicoes[0]).toBeLessThan(5)
    expect(posicoes.filter((p) => p > 0 && p < 22).length).toBeGreaterThan(10)
  })

  it("é monótona: perseguindo o fim, o texto nunca volta para baixo", () => {
    const { posicoes } = perseguir(molaParada(0), (i) => 40 + i * 1.5, 200)
    for (let i = 1; i < posicoes.length; i++) {
      expect(posicoes[i]).toBeGreaterThanOrEqual(posicoes[i - 1])
    }
  })

  it("com o fim crescendo sem parar, acompanha de perto em vez de ficar para trás", () => {
    // 3 px por quadro é streaming rápido (uma linha a cada ~7 quadros).
    // Sem parar no "assentou": no app, cada crescimento reacorda o laço.
    let e = molaParada(0)
    for (let i = 1; i <= 240; i++) e = passoDaMola(e, i * 3, 1).estado
    expect(240 * 3 - e.pos).toBeLessThan(40)
  })

  it("um engasgo recupera no máximo 8 quadros, sem pular direto ao fim", () => {
    const r = passoDaMola(molaParada(0), 1000, 500)
    expect(r.estado.pos).toBeGreaterThan(0)
    expect(r.estado.pos).toBeLessThan(1000)
  })

  it("o deslize da pista desacelera e cobre ~90% do caminho em ~14 quadros", () => {
    let e: EstadoDaMola = { ...molaParada(0), deslizando: true }
    const passos: number[] = []
    for (let i = 0; i < 14; i++) {
      e = passoDaMola(e, 300, 1).estado
      passos.push(e.pos)
    }
    expect(e.pos).toBeGreaterThan(0.85 * 300)
    // Desacelera: o primeiro passo é o maior.
    expect(passos[0]).toBeGreaterThan(passos[1] - passos[0])
  })

  it("o deslize termina no alvo e devolve a vez para a mola", () => {
    let e: EstadoDaMola = { ...molaParada(0), deslizando: true }
    let assentou = false
    for (let i = 0; i < 80 && !assentou; i++) {
      const r = passoDaMola(e, 300, 1)
      e = r.estado
      assentou = r.assentou
    }
    expect(assentou).toBe(true)
    expect(e.deslizando).toBe(false)
    expect(e.pos).toBe(300)
  })

  it("se o fim encolhe (bloco que fechou), a mola desce junto sem ficar além dele", () => {
    const r = passoDaMola({ ...molaParada(500), alvoAnt: 500 }, 420, 1)
    expect(r.estado.pos).toBeLessThanOrEqual(500)
    const { e } = perseguir(r.estado, () => 420)
    expect(e.pos).toBe(420)
  })
})

describe("teleporte", () => {
  it("desliza até duas telas e meia; além disso, teleporta", () => {
    expect(deveTeleportar(1200, 600)).toBe(false)
    expect(deveTeleportar(1600, 600)).toBe(true)
  })

  it("fio escondido (altura zero) nunca teleporta por conta da medida vazia", () => {
    expect(deveTeleportar(5000, 0)).toBe(false)
  })
})

describe("pista ao enviar", () => {
  it("reserva o espaço que falta para a mensagem ficar no topo", () => {
    // Mensagem em 1000; tela de 600; conteúdo acaba em 1100 (a mensagem e um
    // pouco de resposta). O fim do scroll precisa cair em 1000 - recuo.
    const h = alturaDaPista({ alturaAtual: 0, scrollHeight: 1100, clientHeight: 600, topoDaMensagem: 1000 })
    const maxScroll = 1100 + h - 600
    expect(maxScroll).toBe(1000 - RECUO_DA_PISTA_PX)
  })

  it("encolhe na mesma medida em que a resposta cresce: a tela não anda", () => {
    const antes = alturaDaPista({ alturaAtual: 0, scrollHeight: 1100, clientHeight: 600, topoDaMensagem: 1000 })
    // A resposta cresceu 50px; o scrollHeight inclui a pista atual.
    const depois = alturaDaPista({ alturaAtual: antes, scrollHeight: 1100 + antes + 50, clientHeight: 600, topoDaMensagem: 1000 })
    expect(antes - depois).toBe(50)
    expect(1100 + 50 + depois - 600).toBe(1000 - RECUO_DA_PISTA_PX)
  })

  it("quando a resposta passa da tela, a pista zera", () => {
    const h = alturaDaPista({ alturaAtual: 0, scrollHeight: 1900, clientHeight: 600, topoDaMensagem: 1000 })
    expect(h).toBe(0)
  })

  it("conversa curta (mensagem perto do topo) não segura abaixo de zero", () => {
    const h = alturaDaPista({ alturaAtual: 0, scrollHeight: 300, clientHeight: 600, topoDaMensagem: 10 })
    expect(300 + h - 600).toBe(0)
  })
})
