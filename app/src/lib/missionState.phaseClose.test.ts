// O recibo da fase concluída (R6) pede dois campos que o MissionPhaseRun não
// tinha: a PROCEDÊNCIA do custo e o FIM congelado. Nenhum dos dois vive no
// SQLite (a tabela `missions` só indexa a missão inteira), então isto é
// mudança do run-state.json — parse tolerante, zero migração. Este teste é a
// guarda da ida e da volta, incluindo o arquivo LEGADO (gravado antes dos
// campos), que não pode voltar mentindo duração nem custo medido.

import { describe, expect, it } from "vitest"
import { parseRunState, runToState } from "./missionState"
import type { MissionPhaseRun, MissionRun } from "./missionTypes"

function fase(over: Partial<MissionPhaseRun> = {}): MissionPhaseRun {
  return {
    def: {
      id: "plan",
      label: "Planejar",
      persona: "planner",
      agent: "claude-code",
      model: null,
      effort: null,
      maxRetries: 1,
    },
    status: "done",
    attempt: 1,
    costUsd: 2.07,
    startedAt: 1_000,
    ...over,
  }
}

function run(phases: MissionPhaseRun[]): MissionRun {
  return {
    id: "m1",
    convId: "c1",
    presetName: "UI-first",
    task: "tarefa",
    dir: ".mycockpit/missions/x",
    phases,
    current: phases.length,
    costTotal: 2.07,
    maxCostUsd: 15,
    status: "done",
    startedAt: 500,
  }
}

describe("run-state · fim e procedência de custo da fase", () => {
  it("leva os dois campos pro arquivo e traz de volta iguais", () => {
    const st = runToState(
      run([fase({ costSource: "reported", endedAt: 9_000 })]),
    )
    const volta = parseRunState(JSON.stringify(st))
    expect(volta?.phases[0]).toMatchObject({
      costUsd: 2.07,
      costSource: "reported",
      endedAt: 9_000,
    })
  })

  it("fase ainda aberta não grava fim (não existe fim pra congelar)", () => {
    const st = runToState(run([fase({ status: "running", endedAt: null })]))
    expect(st.phases[0].endedAt).toBeUndefined()
  })

  it("arquivo LEGADO volta sem os campos, e a UI cai em — e sem duração", () => {
    // é o run-state gravado antes desta frente: preencher com zero/agora seria
    // exatamente o teatro que a mudança existe pra matar.
    const legado = JSON.stringify({
      ...runToState(run([fase()])),
      phases: [{ status: "done", costUsd: 2.07 }],
    })
    const volta = parseRunState(legado)
    expect(volta?.phases[0].costSource).toBeUndefined()
    expect(volta?.phases[0].endedAt).toBeUndefined()
  })

  it("procedência inválida no arquivo é descartada, nunca aceita crua", () => {
    const sujo = JSON.stringify({
      ...runToState(run([fase()])),
      phases: [{ status: "done", costUsd: 2.07, costSource: "chutado", endedAt: 0 }],
    })
    const volta = parseRunState(sujo)
    expect(volta?.phases[0].costSource).toBeUndefined()
    expect(volta?.phases[0].endedAt).toBeUndefined()
  })
})
