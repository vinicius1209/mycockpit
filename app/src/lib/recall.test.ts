import { describe, expect, it } from "vitest"
import {
  pathTokens,
  recallMatches,
  strongMatches,
  tokenize,
  type DeliveryRecord,
} from "./recall"

function delivery(p: Partial<DeliveryRecord>): DeliveryRecord {
  return {
    id: p.id ?? crypto.randomUUID(),
    task: p.task ?? "",
    planSummary: p.planSummary ?? "",
    filesTouched: p.filesTouched ?? [],
    costUsd: p.costUsd ?? null,
    agent: p.agent ?? "claude-code",
    model: p.model ?? null,
    createdAt: p.createdAt ?? 0,
  }
}

describe("tokenize", () => {
  it("minúsculas, sem acento, ≥3 chars, sem stopwords", () => {
    const t = tokenize("Adicionar botão de Exportação no Painel")
    expect(t.has("botao")).toBe(true)
    expect(t.has("exportacao")).toBe(true)
    expect(t.has("painel")).toBe(true)
    // stopword + palavra curta descartadas
    expect(t.has("de")).toBe(false)
    expect(t.has("no")).toBe(false)
    expect(t.has("adicionar")).toBe(false)
  })
})

describe("pathTokens", () => {
  it("quebra path em segmentos + base sem extensão", () => {
    const t = pathTokens(["src/lib/recall.ts", "app/store/mission.ts"])
    expect(t.has("recall")).toBe(true)
    expect(t.has("lib")).toBe(true)
    expect(t.has("mission")).toBe(true)
    expect(t.has("store")).toBe(true)
    // extensão não vira token
    expect(t.has("ts")).toBe(false)
  })
})

describe("recallMatches", () => {
  const deliveries = [
    delivery({
      id: "recall",
      task: "Implementar recall de entregas similares no planner",
      planSummary: "tabela deliveries, matching por keyword e path overlap",
      filesTouched: ["src/lib/recall.ts", "src/store/mission.ts"],
      createdAt: 100,
    }),
    delivery({
      id: "voice",
      task: "Ditado de voz para o composer, transcrição on-device",
      planSummary: "usar whisper local, gravar áudio e transcrever pt-BR",
      filesTouched: ["src/components/chat/MicButton.tsx"],
      createdAt: 200,
    }),
  ]

  it("casa a entrega certa por keyword + path", () => {
    const m = recallMatches(
      "Preciso de recall das entregas passadas no prompt do planner",
      deliveries,
    )
    expect(m.length).toBeGreaterThan(0)
    expect(m[0].delivery.id).toBe("recall")
    expect(m[0].confidence).not.toBe("low")
  })

  it("tarefa sem relação nenhuma não casa (evita ruído)", () => {
    const m = recallMatches("Configurar pipeline de deploy na Vercel", deliveries)
    expect(m).toHaveLength(0)
  })

  it("task vazia devolve vazio", () => {
    expect(recallMatches("", deliveries)).toHaveLength(0)
  })

  it("respeita o cap (limit)", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      delivery({
        id: `d${i}`,
        task: "recall de entregas similares no planner",
        filesTouched: ["src/lib/recall.ts"],
        createdAt: i,
      }),
    )
    expect(recallMatches("recall entregas planner", many, { limit: 2 })).toHaveLength(2)
  })

  it("ordena por score desc, desempate pela mais recente", () => {
    const dups = [
      delivery({ id: "old", task: "recall entregas planner", filesTouched: ["src/lib/recall.ts"], createdAt: 1 }),
      delivery({ id: "new", task: "recall entregas planner", filesTouched: ["src/lib/recall.ts"], createdAt: 2 }),
    ]
    const m = recallMatches("recall entregas planner", dups)
    expect(m[0].delivery.id).toBe("new")
  })
})

describe("strongMatches", () => {
  it("filtra os low (só high/medium injetam)", () => {
    const matches = [
      { delivery: delivery({ id: "a" }), score: 0.6, confidence: "high" as const },
      { delivery: delivery({ id: "b" }), score: 0.3, confidence: "medium" as const },
      { delivery: delivery({ id: "c" }), score: 0.16, confidence: "low" as const },
    ]
    expect(strongMatches(matches).map((m) => m.delivery.id)).toEqual(["a", "b"])
  })
})
