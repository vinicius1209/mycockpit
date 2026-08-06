// A LINHA VIVA do rodapé é o único lugar que fala do "agora" (background-status
// B2.2). Estes casos travam o que ela DIZ em cada estado — o rótulo com N
// trabalhos (B2.5), o truncamento do nome (B2.1: quem cede é o nome, nunca o
// tempo) e o vocabulário sem termo técnico vazado (B2.3).
import { describe, expect, it } from "vitest"
import { deferredLabel, deferredLiveLine, deferredStopWarning } from "./chat"
import type { DeferredWork } from "@/lib/work"

const T0 = 1_754_400_000_000

// task_type/workflow_name reais do stream do CLI (docs/stream-json-notes.md).
function work(over: Partial<DeferredWork> = {}): DeferredWork {
  return {
    id: "wpue6int0",
    toolUseId: "toolu_01",
    kind: "local_workflow",
    name: "spike-ping",
    status: "running",
    summary: null,
    outputFile: null,
    tokens: null,
    startedAt: T0,
    updatedAt: T0,
    ...over,
  }
}

describe("linha viva do trabalho em background (B2.2/B2.5)", () => {
  it("sem trabalho vivo não existe linha (motor que não reporta não mente)", () => {
    expect(deferredLiveLine([])).toBeNull()
  })

  it("um trabalho: diz 'em background' UMA vez e nomeia quem está rodando", () => {
    const line = deferredLiveLine([work()])
    expect(line?.text).toBe("trabalho em background · spike-ping")
    expect(line?.count).toBe(1)
  })

  it("N trabalhos: conta e mostra só o mais recente, sem empilhar nome atrás de nome", () => {
    const line = deferredLiveLine([
      work({ id: "a", name: "spike-ping", startedAt: T0 }),
      work({ id: "b", name: "deep-research", startedAt: T0 + 5_000 }),
      work({ id: "c", name: "auditoria-de-custo", startedAt: T0 + 1_000 }),
    ])
    expect(line?.text).toBe("3 trabalhos em background · deep-research")
    expect(line?.count).toBe(3)
    // o detalhe completo fica no title; o detalhe de verdade abre no Fio Vivo
    expect(line?.detail).toBe("spike-ping, deep-research, auditoria-de-custo")
  })

  it("o cronômetro é do trabalho NOMEADO na linha, não do turno", () => {
    const line = deferredLiveLine([
      work({ id: "a", startedAt: T0 }),
      work({ id: "b", name: "deep-research", startedAt: T0 + 5_000 }),
    ])
    expect(line?.since).toBe(T0 + 5_000)
  })

  it("empate no nascimento desempata pela última atividade observada", () => {
    const line = deferredLiveLine([
      work({ id: "a", name: "antigo", startedAt: T0, updatedAt: T0 + 9 }),
      work({ id: "b", name: "novo", startedAt: T0, updatedAt: T0 + 900 }),
    ])
    expect(line?.text).toContain("novo")
    expect(line?.since).toBe(T0)
  })

  it("nome comprido é cortado com elipse (o tempo nunca cede espaço)", () => {
    const line = deferredLiveLine(
      [work({ name: "investigar a regressão de custo do turno longo" })],
      28,
    )
    expect(line?.text).toBe("trabalho em background · investigar a regressão de c…")
    expect(line?.text.length).toBeLessThanOrEqual("trabalho em background · ".length + 28)
    // o title guarda o nome inteiro
    expect(line?.detail).toBe("investigar a regressão de custo do turno longo")
  })

  it("nome exatamente no limite não ganha elipse", () => {
    const line = deferredLiveLine([work({ name: "a".repeat(28) })], 28)
    expect(line?.text).toBe(`trabalho em background · ${"a".repeat(28)}`)
  })
})

describe("aviso do Parar, na superfície do turno (B2.4 × D1.4)", () => {
  it("sem trabalho vivo o Parar não precisa de aviso", () => {
    expect(deferredStopWarning([])).toBeUndefined()
  })

  it("um trabalho: avisa que ele morre junto e fica interrompido", () => {
    expect(deferredStopWarning([work()])).toContain("morre junto")
  })

  it("N trabalhos: plural honesto com a contagem", () => {
    const warn = deferredStopWarning([work({ id: "a" }), work({ id: "b" })])
    expect(warn).toContain("os 2 trabalhos em background")
    expect(warn).toContain("morrem junto")
  })
})

describe("vocabulário do rótulo (B2.3)", () => {
  it("task_type do provider vira palavra humana, nunca 'local_agent' cru", () => {
    expect(deferredLabel(work({ name: null, kind: "local_agent" }))).toBe("subagente")
    expect(deferredLabel(work({ name: null, kind: "local_workflow" }))).toBe("workflow")
  })

  it("tipo desconhecido segue cru: traduzir o que não se conhece seria inventar", () => {
    expect(deferredLabel(work({ name: null, kind: "remote_thing" }))).toBe(
      "remote_thing",
    )
    expect(deferredLabel(work({ name: null, kind: null }))).toBe("wpue6int0")
  })

  it("nome do workflow vence o tipo", () => {
    expect(deferredLabel(work({ name: "deep-research", kind: "local_agent" }))).toBe(
      "deep-research",
    )
  })
})
