import { initEngine, type MissionEngineState } from "@/lib/missionEngine"
import { prepareMissionGraphPlan } from "@/lib/missionGraphRuntime"
import { missionDir, missionSlug } from "@/lib/missionPaths"
import type { MissionRunState } from "@/lib/missionState"
import type { MissionPreset, MissionRun } from "@/lib/missionTypes"

export type InitializedMissionGraphRun =
  | {
      ok: true
      preset: MissionPreset
      engine: MissionEngineState
      run: MissionRun
      missionId: string
      dir: string
      startPhase: number
    }
  | { ok: false; error: string }

/** Materializa snapshot, ledger e cursor antes do primeiro await do launch. */
export function initializeMissionGraphRun(input: {
  convId: string
  preset: MissionPreset
  task: string
  resume?: MissionRunState
  newMissionId: string
  now: number
  visitNonce: () => string
}): InitializedMissionGraphRun {
  const prepared = prepareMissionGraphPlan(
    input.resume?.execution?.planSnapshot ?? input.preset,
  )
  if (!prepared.ok) return prepared
  const preset = prepared.snapshot
  const visitDefs = input.resume
    ? input.resume.phases.map((phase) => phase.def ?? prepared.entryPhase)
    : [prepared.entryPhase]
  const engine = initEngine({ ...preset, phases: visitDefs }, input.resume)
  const startPhase = engine.current
  const missionId = input.resume?.missionId ?? input.newMissionId
  const dir =
    input.resume?.dir ??
    missionDir(missionSlug(input.task, missionId, input.now))
  const run: MissionRun = {
    id: missionId,
    convId: input.convId,
    presetName: preset.name,
    task: input.task,
    dir,
    phases: visitDefs.map((def, index) => ({
      def: input.resume?.phases[index]?.def ?? def,
      visitId:
        input.resume?.phases[index]?.visitId ??
        `${missionId}:visit:${index}:${input.visitNonce()}`,
      nodeId:
        input.resume?.phases[index]?.nodeId ??
        (index === 0 ? prepared.entryNodeId : undefined),
      enteredViaEdgeId:
        input.resume?.phases[index]?.enteredViaEdgeId ?? null,
      outcome: input.resume?.phases[index]?.outcome,
      status: input.resume
        ? input.resume.phases[index]?.status === "running"
          ? "queued"
          : (input.resume.phases[index]?.status ?? "queued")
        : "queued",
      attempt: 1,
      costUsd: input.resume?.phases[index]?.costUsd ?? 0,
      costSource: input.resume?.phases[index]?.costSource,
      startedAt: null,
      endedAt: input.resume?.phases[index]?.endedAt ?? null,
      error: input.resume?.phases[index]?.error,
    })),
    current: startPhase,
    costTotal: input.resume?.costTotal ?? 0,
    maxCostUsd: preset.maxCostUsd,
    status: "running",
    startedAt: input.now,
    gatePolicy: preset.gatePolicy,
    gate: input.resume?.gate ?? null,
    recovery: input.resume?.recovery ?? null,
    execution: {
      version: 2,
      planId: preset.id,
      planRevision: preset.revision ?? 1,
      planSnapshot: preset,
      transitions: input.resume?.execution?.transitions ?? [],
    },
  }
  return { ok: true, preset, engine, run, missionId, dir, startPhase }
}
