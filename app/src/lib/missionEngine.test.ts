// MH4.2 — transições da MÁQUINA DE FASES (lib/missionEngine) em unit puro:
// o loop de correção do M2 e o desfecho honesto do MH1.1 testados direto no
// motor, sem store/efeitos — exatamente o que o refactor do MH4.1 tornou
// barato. Os pareceres das fixtures são frases no formato REAL que o template
// do reviewer produz (mesmas famílias do mission.review.test.ts, coletadas do
// endurecimento do reviewerApproved — fixture inventada esconde bug, ADR-016).
//
// As suítes do store (mission.review/reviewClamp/…) seguem provando o
// comportamento FIM-A-FIM; aqui é a mecânica de transição, estado a estado.

import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { MissionRunState } from "@/lib/missionState"
import type { PhaseResult } from "@/lib/mission"
import {
  MAX_REVIEW_LOOPS,
  advance,
  afterPhaseDone,
  applyRecoveryChoice,
  correctionIndex,
  failureTransition,
  finalCaveat,
  initEngine,
  nextTransition,
  rerunBudget,
  type MissionEngineState,
} from "./missionEngine"

const MISSION_ID = "m-engine-1234"
const SHORT = MISSION_ID.slice(0, 6)

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

/** Preset clássico executor → reviewer (o par mínimo do loop de correção). */
function buildReview(): MissionPreset {
  return preset([
    phaseDef({ id: "build", label: "Executar" }),
    phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
  ])
}

/** Roda a transição de fase concluída e AVANÇA (o passo do loop no store). */
function stepDone(
  engine: MissionEngineState,
  items: ChatItem[],
): ReturnType<typeof afterPhaseDone> {
  return afterPhaseDone(engine, items, MISSION_ID, Date.now(), true)
}

describe("loop de correção · rodada N abre fix + rereview", () => {
  it("reviewer reprova (formato real do parecer) → rodada 1: fase corretiva com o feedback como instrução + re-review apendadas", () => {
    let eng = initEngine(buildReview())
    // fase 0 (executor) concluída sem parecer
    eng = advance(stepDone(eng, []).state)
    // fase 1 (reviewer) reprova
    const parecer = "NÃO APROVADO: o handler em src/sync.ts engole a exceção."
    const done = stepDone(eng, [textItem(parecer)])

    expect(done.review).toEqual({ approved: false, feedback: parecer })
    expect(done.correction).not.toBeNull()
    const corr = done.correction!
    expect(corr.round).toBe(1)
    expect(corr.corrective.id).toBe(`fix-1-${SHORT}`)
    expect(corr.corrective.label).toBe("Corrigir (rodada 1)")
    // o executor corretivo herda a def do último executor e leva o parecer
    expect(corr.corrective.persona).toBe("executor")
    expect(corr.corrective.agent).toBe("claude-code")
    expect(corr.corrective.instructions).toContain(parecer)
    expect(corr.rereview.id).toBe(`rereview-1-${SHORT}`)
    expect(corr.rereview.label).toBe("Revisar (rodada 1)")
    expect(corr.rereview.persona).toBe("reviewer")
    // estado: 2 fases viram 4, contador de rodadas e matéria da lição avançam
    expect(done.state.phases).toHaveLength(4)
    expect(done.state.reviewLoops).toBe(1)
    expect(done.state.corrections).toEqual([parecer])
    expect(done.state.lastReview?.approved).toBe(false)
  })

  it("re-review reprova de novo → rodada 2 (ids fix-2/rereview-2, sem duplicar a rodada 1)", () => {
    let eng = initEngine(buildReview())
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [
        textItem("NÃO APROVADO: falta o teste do caso vazio em src/sync.ts."),
      ]).state,
    )
    // fase 2 (Corrigir rodada 1) ok
    eng = advance(stepDone(eng, []).state)
    // fase 3 (Revisar rodada 1) reprova de novo
    const done = stepDone(eng, [
      textItem("Ainda não está aprovado: o retry segue sem teste de regressão."),
    ])
    expect(done.correction?.round).toBe(2)
    expect(done.correction?.corrective.id).toBe(`fix-2-${SHORT}`)
    expect(done.state.phases.map((p) => p.label)).toEqual([
      "Executar",
      "Revisar",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Corrigir (rodada 2)",
      "Revisar (rodada 2)",
    ])
    expect(done.state.corrections).toHaveLength(2)
  })
})

describe("loop de correção · ONDE a correção entra na fila", () => {
  /** Plano com o revisor NO MEIO (o caso que os presets de fábrica escondem:
   *  neles o revisor é a última fase). */
  function buildRevisorNoMeio(): MissionPreset {
    return preset([
      phaseDef({ id: "build", label: "Migrar o schema" }),
      phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
      phaseDef({ id: "port", label: "Portar o checkout" }),
      phaseDef({ id: "hist", label: "Portar o histórico" }),
    ])
  }

  it("revisor NO MEIO reprova: as corretivas entram logo depois dele, e as fases seguintes continuam DEPOIS da correção (nunca rodam sobre o reprovado)", () => {
    let eng = initEngine(buildRevisorNoMeio())
    eng = advance(stepDone(eng, []).state) // fase 0 (executor)
    const done = stepDone(eng, [
      textItem("NÃO APROVADO: a migração perde os contratos vigentes."),
    ])

    expect(done.state.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Portar o checkout",
      "Portar o histórico",
    ])
    // a fase corrente é a revisora e NÃO se move: a inserção é toda adiante
    // dela (índice, handoffs e runId das fases já pagas seguem válidos).
    expect(done.state.current).toBe(1)
    expect(done.correction?.at).toBe(2)
    expect(done.correction?.before).toBe(4)
    expect(done.correction?.after).toBe(6)
    // e o próximo passo do pipeline é a correção, não a fase 3 do plano
    const next = nextTransition(advance(done.state), 0, null)
    expect(next.kind).toBe("run")
    if (next.kind === "run") expect(next.def.label).toBe("Corrigir (rodada 1)")
  })

  it("revisor NA ÚLTIMA fase: a posição é o fim do plano (o comportamento dos presets de fábrica não muda)", () => {
    let eng = initEngine(buildReview())
    eng = advance(stepDone(eng, []).state)
    const done = stepDone(eng, [textItem("NÃO APROVADO: engole a exceção.")])
    expect(done.correction?.at).toBe(2)
    expect(done.correction?.at).toBe(done.correction?.before)
    expect(done.state.phases.map((p) => p.label)).toEqual([
      "Executar",
      "Revisar",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
    ])
  })

  it("rodada 2 com revisor no meio: a segunda correção entra depois da re-review da rodada 1, e a cauda do plano continua por último", () => {
    let eng = initEngine(buildRevisorNoMeio())
    eng = advance(stepDone(eng, []).state) // 0 Migrar
    eng = advance(
      stepDone(eng, [textItem("NÃO APROVADO: perde os contratos vigentes.")])
        .state,
    ) // 1 Revisar
    eng = advance(stepDone(eng, []).state) // 2 Corrigir (rodada 1)
    const done = stepDone(eng, [
      textItem("Ainda não está aprovado: o rollback segue sem teste."),
    ]) // 3 Revisar (rodada 1)

    expect(done.correction?.round).toBe(2)
    expect(done.correction?.at).toBe(4)
    expect(done.state.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Corrigir (rodada 2)",
      "Revisar (rodada 2)",
      "Portar o checkout",
      "Portar o histórico",
    ])
    // a corretiva da rodada 2 herda o ÚLTIMO executor antes do revisor, que é
    // a corretiva da rodada 1 (o trabalho mais recente), não o executor do
    // lançamento.
    expect(done.correction?.corrective.instructions).toContain(
      "o rollback segue sem teste",
    )
  })

  it("correctionIndex é a posição logo após a fase revisora (regra pura, sem estado)", () => {
    expect(correctionIndex(0)).toBe(1)
    expect(correctionIndex(4)).toBe(5)
  })

  it("as duas fases nascem com PROCEDÊNCIA (rodada + instante injetado): fase que entrou no meio do voo não pode parecer nativa", () => {
    let eng = initEngine(buildRevisorNoMeio())
    eng = advance(stepDone(eng, []).state)
    const AGORA = 1_700_000_000_000
    const done = afterPhaseDone(
      eng,
      [textItem("NÃO APROVADO: perde os contratos vigentes.")],
      MISSION_ID,
      AGORA,
      true,
    )
    expect(done.correction?.corrective.appendedInFlight).toEqual({
      round: 1,
      at: AGORA,
    })
    expect(done.correction?.rereview.appendedInFlight).toEqual({
      round: 1,
      at: AGORA,
    })
    // e SÓ elas: as fases do lançamento seguem sem carimbo
    expect(
      done.state.phases
        .filter((p) => p.appendedInFlight)
        .map((p) => p.label),
    ).toEqual(["Corrigir (rodada 1)", "Revisar (rodada 1)"])
    // a re-review herda a def do revisor, e o carimbo da rodada NOVA vence o
    // da rodada anterior (nada de procedência velha viajando de carona)
    const round2 = afterPhaseDone(
      advance(advance(done.state)),
      [textItem("Ainda não está aprovado: falta o rollback.")],
      MISSION_ID,
      AGORA + 60_000,
      true,
    )
    expect(round2.correction?.rereview.appendedInFlight).toEqual({
      round: 2,
      at: AGORA + 60_000,
    })
  })
})

describe("loop de correção · clamp de MAX_REVIEW_LOOPS", () => {
  it("rodadas esgotadas: reprovação na re-review final NÃO abre rodada 3 (nenhuma fase nova), só registra o veredito", () => {
    let eng = initEngine(buildReview())
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [textItem("NÃO APROVADO: falta o teste do caso vazio.")])
        .state,
    )
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [
        textItem("Ainda não está aprovado: o retry segue sem regressão."),
      ]).state,
    )
    eng = advance(stepDone(eng, []).state)
    expect(eng.reviewLoops).toBe(MAX_REVIEW_LOOPS)
    // re-review da rodada 2 (a última possível) reprova DE NOVO
    const parecer =
      "APROVADO COM RESSALVAS: funciona, mas sem teste de regressão para o retry."
    const done = stepDone(eng, [textItem(parecer)])
    expect(done.correction).toBeNull()
    expect(done.state.phases).toHaveLength(6)
    expect(done.state.reviewLoops).toBe(MAX_REVIEW_LOOPS)
    // o veredito reprovado fica registrado (é ele que vira a ressalva no fim)
    expect(done.state.lastReview).toEqual({ approved: false, feedback: parecer })
  })

  it("teto vale igual com o revisor NO MEIO: 2 rodadas inseridas no meio e a 3ª reprovação não insere nada (a cauda do plano segue intacta)", () => {
    let eng = initEngine(
      preset([
        phaseDef({ id: "build", label: "Migrar o schema" }),
        phaseDef({ id: "review", label: "Revisar o schema", persona: "reviewer" }),
        phaseDef({ id: "port", label: "Portar o checkout" }),
      ]),
    )
    eng = advance(stepDone(eng, []).state) // 0 Migrar
    eng = advance(
      stepDone(eng, [textItem("NÃO APROVADO: perde os contratos.")]).state,
    ) // 1 Revisar
    eng = advance(stepDone(eng, []).state) // 2 Corrigir (rodada 1)
    eng = advance(
      stepDone(eng, [textItem("Ainda não está aprovado: falta o rollback.")])
        .state,
    ) // 3 Revisar (rodada 1)
    eng = advance(stepDone(eng, []).state) // 4 Corrigir (rodada 2)
    expect(eng.reviewLoops).toBe(MAX_REVIEW_LOOPS)

    // 5 Revisar (rodada 2) reprova DE NOVO: rodadas esgotadas
    const done = stepDone(eng, [
      textItem("NÃO APROVADO: o caso de erro de rede segue sem cobertura."),
    ])
    expect(done.correction).toBeNull()
    expect(done.state.phases.map((p) => p.label)).toEqual([
      "Migrar o schema",
      "Revisar o schema",
      "Corrigir (rodada 1)",
      "Revisar (rodada 1)",
      "Corrigir (rodada 2)",
      "Revisar (rodada 2)",
      "Portar o checkout",
    ])
    expect(done.state.reviewLoops).toBe(MAX_REVIEW_LOOPS)
  })

  it("clamp re-hidratado da retomada: reviewLoops do run-state esgotado impede rodada extra já na primeira reprovação pós-crash", () => {
    const pre = buildReview()
    const state: MissionRunState = {
      version: 1,
      missionId: MISSION_ID,
      dir: ".mycockpit/missions/m-engine",
      convId: "c1",
      task: "tarefa",
      preset: pre,
      current: 1,
      phases: [
        { status: "done", costUsd: 0.5 },
        { status: "running", costUsd: 0 },
      ],
      costTotal: 0.5,
      maxCostUsd: null,
      gateDecisions: null,
      reviewLoops: MAX_REVIEW_LOOPS,
      lastReview: { approved: false, feedback: "NÃO APROVADO: segue sem teste." },
      status: "running",
      updatedAt: 123,
    }
    const eng = initEngine(pre, state)
    expect(eng.current).toBe(1)
    expect(eng.reviewLoops).toBe(MAX_REVIEW_LOOPS)
    const done = stepDone(eng, [
      textItem("NÃO APROVADO: o retry segue engolindo a exceção."),
    ])
    expect(done.correction).toBeNull()
  })

  it("reviewer reprovou mas NÃO há executor anterior → sem rodada (não existe quem corrija), veredito registrado", () => {
    const eng = initEngine(
      preset([phaseDef({ id: "review", label: "Revisar", persona: "reviewer" })]),
    )
    const done = stepDone(eng, [
      textItem("NÃO APROVADO: o diff está vazio, nada foi implementado."),
    ])
    expect(done.correction).toBeNull()
    expect(done.state.reviewLoops).toBe(0)
    expect(finalCaveat(done.state)?.rounds).toBe(0)
  })
})

describe("desfecho · ressalva vs done limpo (MH1.1)", () => {
  it("reprovação final com rodadas esgotadas → finalCaveat carrega rounds e o parecer (nunca done seco)", () => {
    let eng = initEngine(buildReview())
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [textItem("NÃO APROVADO: engole a exceção.")]).state,
    )
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [textItem("Ainda não está aprovado: falta o teste.")]).state,
    )
    eng = advance(stepDone(eng, []).state)
    const parecerFinal =
      "APROVADO COM RESSALVAS: funciona, mas sem teste de regressão para o retry."
    eng = advance(stepDone(eng, [textItem(parecerFinal)]).state)

    expect(finalCaveat(eng)).toEqual({
      rounds: 2,
      feedback: parecerFinal,
    })
    // e a transição de saída do pipeline entrega a mesma ressalva
    const fin = nextTransition(eng, 1.3, null)
    expect(fin).toEqual({
      kind: "finish",
      reviewCaveat: { rounds: 2, feedback: parecerFinal },
    })
  })

  it("aprovação na re-review → done LIMPO (caveat null): o loop corrigiu de verdade", () => {
    let eng = initEngine(buildReview())
    eng = advance(stepDone(eng, []).state)
    eng = advance(
      stepDone(eng, [textItem("NÃO APROVADO: engole a exceção.")]).state,
    )
    eng = advance(stepDone(eng, []).state)
    const done = stepDone(eng, [
      textItem("APROVADO. As correções cobrem os dois pontos."),
    ])
    expect(done.review?.approved).toBe(true)
    expect(done.correction).toBeNull()
    eng = advance(done.state)
    expect(finalCaveat(eng)).toBeNull()
    expect(nextTransition(eng, 0.9, null)).toEqual({
      kind: "finish",
      reviewCaveat: null,
    })
  })

  it("missão sem reviewer → caveat null (não há parecer a ressalvar)", () => {
    let eng = initEngine(preset([phaseDef({ id: "build", label: "Executar" })]))
    eng = advance(stepDone(eng, []).state)
    expect(finalCaveat(eng)).toBeNull()
  })
})

describe("transições de entrada e falha (mecânica do motor)", () => {
  it("nextTransition: fase pendente e orçamento ok → run com a def corrente", () => {
    const eng = initEngine(buildReview())
    const t = nextTransition(eng, 0.5, 10)
    expect(t.kind).toBe("run")
    if (t.kind === "run") {
      expect(t.index).toBe(0)
      expect(t.def.label).toBe("Executar")
    }
  })

  it("nextTransition: teto atingido antes da fase → teto com o motivo do checkBudget", () => {
    const eng = initEngine(buildReview())
    const t = nextTransition(eng, 12, 10)
    expect(t).toEqual({
      kind: "teto",
      reason: "orçamento da missão esgotado (US$ 12.00 de US$ 10.00)",
    })
  })

  it("failureTransition: budgetExceeded vence QUALQUER rastro de limite (teto nunca vira card de recuperação)", () => {
    const result: PhaseResult = {
      ok: false,
      items: [{ kind: "limit", id: "l1", message: "rate limit atingido" } as ChatItem],
      costUsd: 4,
      costSource: undefined,
      error: "teto de custo da missão atingido durante a fase",
      budgetExceeded: true,
    }
    const t = failureTransition(result, 1, 5)
    expect(t).toEqual({
      kind: "teto-fase",
      reason: "teto de US$ 5.00 atingido durante a fase 2",
    })
  })

  it("failureTransition: falha com rastro de limite → recovery com mensagem humana e motivo de desistência", () => {
    const result: PhaseResult = {
      ok: false,
      items: [],
      costUsd: 0.2,
      costSource: undefined,
      error: "Rate limit exceeded. Will retry after the reset.",
    }
    const t = failureTransition(result, 0, null)
    expect(t.kind).toBe("recovery")
    if (t.kind === "recovery") {
      expect(t.error).toContain("Rate limit")
      expect(t.message).toContain("Escolha outro agent/modelo")
      expect(t.abandonReason).toContain("Rate limit")
    }
  })

  it("failureTransition: falha comum (bug) → falha fatal com o motivo", () => {
    const result: PhaseResult = {
      ok: false,
      items: [],
      costUsd: 0.1,
      costSource: undefined,
      error: "a fase terminou sem sucesso",
    }
    expect(failureTransition(result, 0, null)).toEqual({
      kind: "falha",
      error: "a fase terminou sem sucesso",
      reason: "a fase terminou sem sucesso",
    })
  })

  it("applyRecoveryChoice troca agent/modelo/effort SÓ da fase corrente (a mesma fase re-roda)", () => {
    let eng = initEngine(buildReview())
    eng = applyRecoveryChoice(eng, {
      agent: "codex",
      model: "gpt-5.2",
      effort: "high",
    })
    expect(eng.phases[0]).toMatchObject({
      agent: "codex",
      model: "gpt-5.2",
      effort: "high",
      persona: "executor",
      label: "Executar",
    })
    expect(eng.phases[1].agent).toBe("claude-code")
    expect(eng.current).toBe(0)
  })

  it("rerunBudget: recuperação já estourada é recusada antes de gastar", () => {
    expect(rerunBudget(4, 5)).toEqual({ ok: true })
    const t = rerunBudget(6, 5)
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.reason).toContain("orçamento da missão esgotado")
  })
})

describe("initEngine · retomada", () => {
  function runState(over: Partial<MissionRunState>): MissionRunState {
    return {
      version: 1,
      missionId: MISSION_ID,
      dir: ".mycockpit/missions/m-engine",
      convId: "c1",
      task: "tarefa",
      preset: buildReview(),
      current: 0,
      phases: [
        { status: "done", costUsd: 0.5 },
        { status: "queued", costUsd: 0 },
      ],
      costTotal: 0.5,
      maxCostUsd: null,
      gateDecisions: null,
      status: "running",
      updatedAt: 123,
      ...over,
    }
  }

  it("gate RESPONDIDO com a fase do gate já done → começa na PRÓXIMA (não re-paga fase concluída)", () => {
    const eng = initEngine(
      buildReview(),
      runState({
        current: 0,
        gateDecisions: "## Decisões do usuário (gate humano)\n1. P: usar SQLite?\n   R: sim",
      }),
    )
    expect(eng.current).toBe(1)
  })

  it("gate PENDENTE (sem gateDecisions) → re-roda a fase corrente do zero", () => {
    const eng = initEngine(buildReview(), runState({ current: 0 }))
    expect(eng.current).toBe(0)
  })

  it("current fora do range no arquivo → clamp defensivo pra última fase", () => {
    const eng = initEngine(buildReview(), runState({ current: 99 }))
    expect(eng.current).toBe(1)
  })
})
