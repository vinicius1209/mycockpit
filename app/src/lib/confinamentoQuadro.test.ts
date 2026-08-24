// O quadro de confinamento: uma linha por modo, e um resumo DERIVADO delas.
//
// O mecanismo copiado do Orca é esse: no painel de Computer Use deles o resumo
// é `total - concedidas`, nunca um estado guardado à parte. Aqui vale o mesmo —
// se as linhas mudarem, o resumo muda junto por construção, e não existe
// caminho em que o topo diga "protegido" com as linhas dizendo o contrário.

import { describe, expect, it } from "vitest"
import {
  linhasDeConfinamento,
  resumoDoConfinamento,
  SEM_CONFINAMENTO,
  type Confinamento,
} from "@/lib/confinamento"

const COM_SANDBOX: Confinamento = {
  selo: "parcial",
  nota: "o sistema barra escrita no projeto",
}

describe("linhasDeConfinamento", () => {
  it("cobre TODOS os modos do eixo, do menos ao mais permissivo", () => {
    const linhas = linhasDeConfinamento(COM_SANDBOX)
    // Modo que não aparece aqui é modo cuja garantia ninguém consegue conferir.
    expect(linhas.map((l) => l.modo)).toEqual([
      "plan",
      "leitura",
      "fusionRo",
      "padrao",
      "auto",
      "liberado",
    ])
  })

  it("com sandbox: só os modos de escrita ZERO são confinados", () => {
    const linhas = linhasDeConfinamento(COM_SANDBOX)
    const confinados = linhas.filter((l) => l.confinado).map((l) => l.modo)
    expect(confinados).toEqual(["plan", "leitura", "fusionRo"])
  })

  it("SEM sandbox na máquina: NENHUM modo é confinado, nem os de escrita zero", () => {
    // A regra que isto trava: "ganharia selo" não é "está confinado". Numa
    // máquina sem sandbox-exec, mostrar 'Só lê' como confinado seria a
    // promessa falsa que o módulo inteiro existe pra impedir.
    const linhas = linhasDeConfinamento(SEM_CONFINAMENTO)
    expect(linhas.every((l) => !l.confinado)).toBe(true)
  })

  it("os dois 'não confinado' têm causas DIFERENTES, e a frase diz qual", () => {
    const semMaquina = linhasDeConfinamento(SEM_CONFINAMENTO)
    const comMaquina = linhasDeConfinamento(COM_SANDBOX)

    // modo de escrita zero, máquina sem sandbox → a culpa é da máquina
    expect(semMaquina.find((l) => l.modo === "leitura")?.frase).toMatch(
      /sem sandbox nesta máquina/,
    )
    // modo que escreve, máquina COM sandbox → não há o que barrar
    expect(comMaquina.find((l) => l.modo === "liberado")?.frase).toMatch(
      /não há escrita pra barrar/,
    )
  })

  it("a linha confinada repete a nota EXATA do Rust, sem reescrever", () => {
    const l = linhasDeConfinamento(COM_SANDBOX).find((x) => x.modo === "plan")
    expect(l?.frase).toBe(COM_SANDBOX.nota)
  })
})

describe("resumoDoConfinamento — derivado, não guardado", () => {
  it("conta o que as linhas dizem, com sandbox", () => {
    const r = resumoDoConfinamento(linhasDeConfinamento(COM_SANDBOX))
    expect(r).toEqual({ temSandbox: true, confinados: 3, total: 6 })
  })

  it("sem sandbox o resumo é zero, e `temSandbox` cai junto", () => {
    const r = resumoDoConfinamento(linhasDeConfinamento(SEM_CONFINAMENTO))
    expect(r).toEqual({ temSandbox: false, confinados: 0, total: 6 })
  })

  it("não existe resumo que contradiga as linhas", () => {
    for (const c of [COM_SANDBOX, SEM_CONFINAMENTO]) {
      const linhas = linhasDeConfinamento(c)
      const r = resumoDoConfinamento(linhas)
      expect(r.confinados).toBe(linhas.filter((l) => l.confinado).length)
      expect(r.total).toBe(linhas.length)
      expect(r.temSandbox).toBe(r.confinados > 0)
    }
  })
})
