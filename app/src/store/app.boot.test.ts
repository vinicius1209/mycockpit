// Onde o app ABRE (ADR-040, condição 1). Isto é teste, não comentário, porque
// é o tipo de regra que uma frente futura relaxa sem nada quebrar: se um dia
// algo voltar a forçar o boot no Painel, ninguém percebe olhando a tela (o
// Painel abre bonito, só que ele não é mais a superfície de trabalho).

import { describe, expect, it } from "vitest"
import { migratePersistedApp, useApp } from "@/store/app"
import { GLOBAL_NAVIGATION } from "@/components/layout/globalNavigation"

describe("boot: em que superfície o app abre", () => {
  it("instalação nova abre no Trabalho, não no Painel", () => {
    // nada persistido ⇒ vale o default do store, e ele é o Trabalho: é lá que
    // o produto mora (conversas), e a retrospectiva é consulta, não sessão.
    expect(useApp.getState().viewMode).toBe("linear")
  })

  it("usuário existente mantém a última aba que usou, inclusive o Painel", () => {
    // a regra é "abre no Trabalho pra quem nunca escolheu", nunca "força o
    // Trabalho": a preferência persistida é do usuário, e a v5 não a reescreve.
    expect(migratePersistedApp({ viewMode: "painel" }, 4).viewMode).toBe("painel")
    expect(migratePersistedApp({ viewMode: "linear" }, 4).viewMode).toBe("linear")
  })

  it("modo persistido que não existe mais continua caindo no Trabalho", () => {
    expect(migratePersistedApp({ viewMode: "office" }, 3).viewMode).toBe("linear")
    expect(migratePersistedApp({ viewMode: "sdd" }, 4).viewMode).toBe("linear")
  })

  it("o Painel segue acessível em Geral (retrospectiva global, ADR-187)", () => {
    const painel = GLOBAL_NAVIGATION.find((m) => m.id === "painel")
    expect(painel?.label).toBe("Painel")
    expect(GLOBAL_NAVIGATION.map((m) => m.id)).toEqual(["painel", "fleet", "scheduled", "flightPlans"])
  })
})

describe("boot: a faixa de decisão não nasce expandida", () => {
  it("decisionsOpen começa falso e não é persistido", () => {
    expect(useApp.getState().decisionsOpen).toBe(false)
    // decisão pendente não se dispensa entre boots: o estado da faixa é da
    // sessão, e a faixa some sozinha quando a fila esvazia.
    expect(Object.keys(migratePersistedApp({}, 4))).not.toContain("decisionsOpen")
  })
})
