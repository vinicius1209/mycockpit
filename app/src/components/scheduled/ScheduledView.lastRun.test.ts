// O dot da linha do Agendado é ambiente e virou CINZA nos dois casos
// saudáveis ("nunca rodou" e "última deu certo"), como manda o STYLEGUIDE §2.
// Quem desempata os dois agora é este rótulo, então ele é obrigatório: se
// sumir, a lista volta a ter dois estados indistinguíveis.
import { describe, expect, it } from "vitest"
import { lastRunLabel } from "./ScheduledView"

describe("lastRunLabel", () => {
  it("automação que nunca rodou diz isso, não inventa horário", () => {
    expect(lastRunLabel(null)).toBe("nunca rodou")
    expect(lastRunLabel(undefined)).toBe("nunca rodou")
  })

  it("automação que já rodou mostra QUANDO foi a última", () => {
    const rotulo = lastRunLabel(new Date(2026, 7, 12, 9, 5).getTime())
    expect(rotulo).toBe("última 12/08, 09:05")
  })

  it("os dois casos saudáveis são textos diferentes (é o desempate do dot cinza)", () => {
    expect(lastRunLabel(null)).not.toBe(lastRunLabel(Date.now()))
  })
})
