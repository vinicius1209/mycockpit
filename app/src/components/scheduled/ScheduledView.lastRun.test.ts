// O dot da linha do Agendado é ambiente e virou CINZA nos dois casos
// saudáveis ("nunca rodou" e "última deu certo"), como manda o STYLEGUIDE §2.
// Quem desempata os dois agora é este rótulo, então ele é obrigatório: se
// sumir, a lista volta a ter dois estados indistinguíveis.
import { describe, expect, it } from "vitest"
import {
  lastRunLabel,
  runStatusLabel,
  scheduleStatus,
} from "@/lib/schedulePresentation"

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

// "blocked" é o preflight de capability barrando ANTES de gastar: nem falha do
// turno, nem execução saudável. Ele chegava aqui com dot CINZA e rótulo
// "falhou" — a linha parecia em repouso e o histórico acusava um erro que não
// aconteceu, que são as duas metades erradas da mesma leitura.
describe("desfecho de execução: bloqueada não é falha nem repouso", () => {
  it("o dot separa os três desfechos", () => {
    expect(scheduleStatus("ok", false)).toBe("success")
    expect(scheduleStatus("failed", false)).toBe("error")
    expect(scheduleStatus("blocked", false)).toBe("queued")
    expect(scheduleStatus(null, false)).toBe("idle")
  })

  it("rodando vence qualquer desfecho anterior", () => {
    expect(scheduleStatus("failed", true)).toBe("running")
    expect(scheduleStatus("blocked", true)).toBe("running")
  })

  it("o rótulo nomeia o desfecho e não chama de falha o que não foi", () => {
    expect(runStatusLabel("ok")).toBe("ok")
    expect(runStatusLabel("failed")).toBe("falhou")
    expect(runStatusLabel("blocked")).toBe("bloqueada")
  })

  it("desfecho que a lista não conhece aparece como veio, sem virar 'falhou'", () => {
    expect(runStatusLabel("xpto")).toBe("xpto")
  })
})
