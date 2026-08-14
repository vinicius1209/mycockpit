// R6 — a fase concluída precisa DIZER o que fez. Antes mostrava só o custo, e
// nem duração tinha (MissionPhaseRun não guardava fim).

import { describe, expect, it } from "vitest"
import { lastDeliverable, phaseReceipt, receiptLine } from "./missionReceipt"
import type { MissionPhaseRun } from "./missionTypes"
import type { ChatItem } from "@/store/chat"

function tool(name: string, input: unknown, id: string): ChatItem {
  return {
    kind: "tool",
    id,
    name,
    input,
    result: { ok: true, text: "", lines: 1 },
  } as ChatItem
}

function fase(over: Partial<MissionPhaseRun> = {}, agent = "claude-code"): MissionPhaseRun {
  return {
    def: {
      id: "plan",
      label: "Planejar",
      persona: "planner",
      agent,
      model: "opus",
      effort: null,
      maxRetries: 1,
    },
    status: "done",
    attempt: 1,
    costUsd: 0,
    startedAt: 0,
    ...over,
  } as MissionPhaseRun
}

describe("entregável da fase", () => {
  it("é a última ESCRITA reportada, não a última leitura", () => {
    const p = fase({
      items: [
        tool("Write", { file_path: "/p/landing-plan.md" }, "1"),
        tool("Read", { file_path: "/p/STYLEGUIDE.md" }, "2"),
      ],
    })
    expect(lastDeliverable(p)).toBe("Criar landing-plan.md")
  })

  it("sem escrita reportada não se inventa um entregável", () => {
    expect(lastDeliverable(fase({ items: [] }))).toBeNull()
  })
})

describe("recibo colapsado · a ordem é fixa e o resumo É a informação", () => {
  const p = fase({
    costUsd: 2.07,
    costSource: "reported",
    startedAt: 0,
    endedAt: 1_002_000,
    items: [
      tool("Write", { file_path: "/p/landing-plan.md" }, "1"),
      tool("Read", { file_path: "/p/a.md" }, "2"),
    ],
  })

  it("entregável → impacto → duração → custo → quem fez", () => {
    expect(receiptLine(phaseReceipt(p))).toBe(
      "Criar landing-plan.md · 2 ações · 16min 42s · US$ 2,07 · Claude",
    )
  })

  it("o motor vem por ÚLTIMO (quem varre procura o entregável)", () => {
    const partes = receiptLine(phaseReceipt(p)).split(" · ")
    expect(partes[partes.length - 1]).toBe("Claude")
  })

  it("a duração é a CONGELADA, não uma conta contra o agora", () => {
    expect(phaseReceipt(p).duration).toBe("16min 42s")
  })

  it("fase sem fim carimbado não mostra duração inventada", () => {
    expect(phaseReceipt(fase({ endedAt: null })).duration).toBeNull()
  })
})

describe("recibo de motor que não narra", () => {
  // Era o agy até a 1.1.9. Desde a 1.1.13 ele narra e mede (stream-json,
  // medido 14/08/2026), então quem sustenta este ramo é o motor ainda não
  // integrado — a decisão sai da capability, nunca do nome.
  it("diz 'sem ações relatadas' em vez de fingir zero ações", () => {
    const r = phaseReceipt(
      fase({ startedAt: 0, endedAt: 483_000, items: [] }, "opencode"),
    )
    expect(r.impact).toBe("sem ações relatadas")
    expect(r.cost).toBe("não mede")
    expect(receiptLine(r)).toBe(
      "sem ações relatadas · 8min 03s · não mede · OpenCode",
    )
  })
})

describe("falha nunca se esconde", () => {
  it("fase interrompida ou com erro é marcada como ruim", () => {
    expect(phaseReceipt(fase({ status: "aborted" })).bad).toBe(true)
    expect(phaseReceipt(fase({ status: "error" })).bad).toBe(true)
    expect(phaseReceipt(fase({ status: "done" })).bad).toBe(false)
  })
})
