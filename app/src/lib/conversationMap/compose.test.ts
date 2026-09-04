import { describe, expect, it } from "vitest"
import { composeConversationMapView } from "./compose"
import type {
  DeterministicConversationFacts,
  SemanticConversationMapV1,
} from "./types"

const facts: DeterministicConversationFacts = {
  conversationId: "c1",
  title: null,
  initialSubject: null,
  latestOutcome: null,
  tasks: [],
  background: [],
  pendingInteractions: [],
  runtime: { running: false, finalizing: false },
}

const semantic: SemanticConversationMapV1 = {
  schemaVersion: 1,
  currentFocus: {
    id: "claim",
    text: "Leitura automática",
    certainty: "inferred",
    evidence: [{ itemId: "u1", role: "user", channel: "executor" }],
  },
  explicitGoal: null,
  directionChanges: [],
  understandings: [],
  constraints: [],
  openThreads: [],
  latestOutcomeSummary: null,
}

describe("composição do mapa", () => {
  it("faz o pin humano vencer sem alterar o mapa gerado", () => {
    const view = composeConversationMapView({
      facts,
      semantic,
      pins: {
        schemaVersion: 1,
        revision: 1,
        currentFocus: { id: "pin", text: "Foco corrigido", pinnedAt: 10 },
        constraints: [],
      },
      semanticStatus: "current",
    })

    expect(view.currentFocus?.text).toBe("Foco corrigido")
    expect(view.provenance.mode).toBe("semantic_with_pins")
    expect(semantic.currentFocus?.text).toBe("Leitura automática")
  })

  it("continua útil em facts only", () => {
    const view = composeConversationMapView({
      facts,
      semantic: null,
      pins: { schemaVersion: 1, revision: 0, constraints: [] },
      semanticStatus: "unavailable",
    })

    expect(view.provenance.mode).toBe("facts_only")
    expect(view.provenance.semanticStatus).toBe("unavailable")
  })
})
