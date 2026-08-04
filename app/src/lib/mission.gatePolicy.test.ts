// MH3.3 — política de gate do preset (gateOutcome): "agente" = clássico,
// "nunca" = não pausa (perguntas viram notice), "sempre-apos-planejar" = gate
// obrigatório após a fase 1 mesmo sem perguntas. Perguntas de fixture são as
// open_questions REAIS que os planners emitem no handoff .mission/*.json.
import { describe, expect, it } from "vitest"
import { PLAN_GATE_QUESTION, gateOutcome } from "./mission"

// open_questions como saem do handoff real de um planner (JSON do blackboard).
const REAL_QUESTIONS = [
  "Devo usar a porta 5175 do dev server ou a 1420 do Tauri?",
  "O componente novo entra em components/chat ou components/mission?",
]

describe("gateOutcome — política 'agente' (default, fail-open)", () => {
  it("policy ausente (preset antigo) = comportamento clássico: gate quando há perguntas E próxima fase", () => {
    const out = gateOutcome({
      policy: undefined,
      openQuestions: REAL_QUESTIONS,
      phaseIndex: 0,
      hasNextPhase: true,
    })
    expect(out.kind).toBe("gate")
    expect(out.questions).toEqual(REAL_QUESTIONS)
  })

  it("sem perguntas → segue direto (none)", () => {
    const out = gateOutcome({
      policy: "agente",
      openQuestions: [],
      phaseIndex: 0,
      hasNextPhase: true,
    })
    expect(out).toEqual({ kind: "none", questions: [] })
  })

  it("sem próxima fase nunca abre gate (as pendências vão pro resumo final)", () => {
    const out = gateOutcome({
      policy: "agente",
      openQuestions: REAL_QUESTIONS,
      phaseIndex: 2,
      hasNextPhase: false,
    })
    expect(out.kind).toBe("none")
  })
})

describe("gateOutcome — política 'nunca'", () => {
  it("perguntas que ABRIRIAM gate viram notice (informação nunca some)", () => {
    const out = gateOutcome({
      policy: "nunca",
      openQuestions: REAL_QUESTIONS,
      phaseIndex: 0,
      hasNextPhase: true,
    })
    expect(out.kind).toBe("notice")
    expect(out.questions).toEqual(REAL_QUESTIONS)
  })

  it("sem perguntas → none (nada a avisar)", () => {
    const out = gateOutcome({
      policy: "nunca",
      openQuestions: undefined,
      phaseIndex: 1,
      hasNextPhase: true,
    })
    expect(out).toEqual({ kind: "none", questions: [] })
  })

  it("última fase com perguntas → none (já iam pro resumo, não ao gate)", () => {
    const out = gateOutcome({
      policy: "nunca",
      openQuestions: REAL_QUESTIONS,
      phaseIndex: 2,
      hasNextPhase: false,
    })
    expect(out.kind).toBe("none")
  })
})

describe("gateOutcome — política 'sempre-apos-planejar'", () => {
  it("fase 1 SEM perguntas → gate obrigatório com a pergunta padrão de revisão do plano", () => {
    const out = gateOutcome({
      policy: "sempre-apos-planejar",
      openQuestions: [],
      phaseIndex: 0,
      hasNextPhase: true,
    })
    expect(out.kind).toBe("gate")
    expect(out.questions).toEqual([PLAN_GATE_QUESTION])
    expect(PLAN_GATE_QUESTION).toBe("Revise o plano antes de executar")
  })

  it("fase 1 COM perguntas → gate com as perguntas do planner (a padrão não entra por cima)", () => {
    const out = gateOutcome({
      policy: "sempre-apos-planejar",
      openQuestions: REAL_QUESTIONS,
      phaseIndex: 0,
      hasNextPhase: true,
    })
    expect(out.kind).toBe("gate")
    expect(out.questions).toEqual(REAL_QUESTIONS)
  })

  it("fases seguintes seguem a regra do 'agente' (gate só com perguntas)", () => {
    expect(
      gateOutcome({
        policy: "sempre-apos-planejar",
        openQuestions: [],
        phaseIndex: 1,
        hasNextPhase: true,
      }).kind,
    ).toBe("none")
    expect(
      gateOutcome({
        policy: "sempre-apos-planejar",
        openQuestions: REAL_QUESTIONS,
        phaseIndex: 1,
        hasNextPhase: true,
      }).kind,
    ).toBe("gate")
  })

  it("missão de UMA fase não gata (não há próxima fase pra receber a revisão)", () => {
    const out = gateOutcome({
      policy: "sempre-apos-planejar",
      openQuestions: [],
      phaseIndex: 0,
      hasNextPhase: false,
    })
    expect(out.kind).toBe("none")
  })
})
