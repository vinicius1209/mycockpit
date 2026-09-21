// Snapshot v2 da missão em `.frota/missions/<slug>/run-state.json`.
// Congela plano, visitas, transições, gate e recovery a cada marco. Persistência
// é best-effort: falha de IO nunca derruba o run.

import { invoke } from "@tauri-apps/api/core"
import { caminhoNaPasta } from "@/lib/frotaDir"
import type { CostSource } from "@/lib/agent"
import { activePointerPath, runStatePath } from "@/lib/missionPaths"
import { snapshotMissionPlan } from "@/lib/missionPlans"
import { validMissionRunLedger } from "@/lib/missionStateGraph"
import type {
  MissionGate,
  MissionGraphExecution,
  MissionNodeOutcome,
  MissionPhaseDef,
  MissionPhaseStatus,
  MissionPreset,
  MissionRecovery,
  MissionReviewCaveat,
  MissionRun,
  MissionStatus,
  MissionTransition,
} from "@/lib/missionTypes"

export const RUN_STATE_VERSION = 2

export type RunStateStatus = MissionStatus | "abandoned"

/** Uma visita persistida. `def` viaja junto porque loops podem visitar o mesmo
 *  nó mais de uma vez e recovery pode trocar o agent apenas naquela visita. */
export interface RunStatePhase {
  /** Sempre escrito no v2; opcional só para fixtures internas. */
  def?: MissionPhaseDef
  visitId?: string
  nodeId?: string
  enteredViaEdgeId?: string | null
  outcome?: MissionNodeOutcome
  status: MissionPhaseStatus
  costUsd: number
  costSource?: CostSource
  endedAt?: number
  error?: string
}

/** Snapshot completo do pipeline num marco. */
export interface MissionRunState {
  version: number
  missionId: string
  dir: string
  convId: string
  task: string
  /** Snapshot original do plano. O ledger cronológico fica em `phases`. */
  preset: MissionPreset
  /** Sempre escrito no JSON v2; opcional só para fixtures internas. */
  execution?: MissionGraphExecution
  current: number
  phases: RunStatePhase[]
  costTotal: number
  maxCostUsd: number | null
  gateDecisions?: string | null
  /** Interações pendentes são parte do checkpoint v2. */
  gate?: MissionGate | null
  recovery?: MissionRecovery | null
  reviewLoops?: number
  lastReview?: RunStateReview | null
  reviewCaveat?: MissionReviewCaveat | null
  status: RunStateStatus
  updatedAt: number
}

export interface RunStateReview {
  approved: boolean
  feedback: string
}

export interface ReviewLoopState {
  loops: number
  last: RunStateReview | null
}

export interface InterruptedMission {
  state: MissionRunState
  cwd: string
}

/** Serializa o run em memória num snapshot persistível. */
export function runToState(
  run: MissionRun,
  gateDecisions?: string | null,
  review?: ReviewLoopState | null,
): MissionRunState {
  const fallbackPlan = snapshotMissionPlan({
    id: run.id,
    revision: 1,
    name: run.presetName,
    phases: run.phases.map((p) => p.def),
    maxCostUsd: run.maxCostUsd,
    ...(run.gatePolicy ? { gatePolicy: run.gatePolicy } : {}),
  })
  const execution: MissionGraphExecution = cloneJson(
    run.execution ?? {
      version: 2,
      planId: fallbackPlan.id,
      planRevision: fallbackPlan.revision ?? 1,
      planSnapshot: fallbackPlan,
      transitions: [],
    },
  )
  return {
    version: RUN_STATE_VERSION,
    missionId: run.id,
    dir: run.dir,
    convId: run.convId,
    task: run.task,
    preset: cloneJson(execution.planSnapshot),
    execution,
    current: run.current,
    phases: run.phases.map((p, index) => ({
      def: cloneJson(p.def),
      visitId: p.visitId ?? `${run.id}:visit:${index}`,
      nodeId: p.nodeId ?? `node-${p.def.id}`,
      enteredViaEdgeId: p.enteredViaEdgeId ?? null,
      ...((p.outcome ?? inferredOutcome(p.status))
        ? { outcome: p.outcome ?? inferredOutcome(p.status)! }
        : {}),
      status: p.status,
      costUsd: p.costUsd,
      ...(p.costSource ? { costSource: p.costSource } : {}),
      ...(p.endedAt ? { endedAt: p.endedAt } : {}),
      ...(p.error ? { error: p.error } : {}),
    })),
    costTotal: run.costTotal,
    maxCostUsd: run.maxCostUsd,
    gateDecisions: gateDecisions ?? null,
    gate: run.gate ? cloneJson(run.gate) : null,
    recovery: run.recovery ? cloneJson(run.recovery) : null,
    reviewLoops: review?.loops ?? 0,
    lastReview: review?.last ?? null,
    reviewCaveat: run.reviewCaveat ?? null,
    status: run.status,
    updatedAt: Date.now(),
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function inferredOutcome(status: MissionPhaseStatus): MissionNodeOutcome | null {
  if (status === "done") return "success"
  if (status === "error") return "failure"
  return null
}

const COST_SOURCES: CostSource[] = ["reported", "estimated", "unknown"]
const STATUSES: RunStateStatus[] = [
  "running",
  "done",
  "error",
  "aborted",
  "abandoned",
]
const PHASE_STATUSES: MissionPhaseStatus[] = [
  "queued",
  "running",
  "done",
  "error",
  "aborted",
]

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function validPhaseDef(v: unknown): v is MissionPhaseDef {
  const o = record(v)
  if (!o) return false
  const lists = [o.entryCriteria, o.exitCriteria]
  const appended = o.appendedInFlight
  return (
    typeof o.id === "string" && !!o.id &&
    typeof o.label === "string" &&
    (o.persona === "planner" || o.persona === "executor" || o.persona === "reviewer") &&
    typeof o.agent === "string" && !!o.agent &&
    (o.model === null || typeof o.model === "string") &&
    (o.effort === null || typeof o.effort === "string") &&
    typeof o.maxRetries === "number" && Number.isFinite(o.maxRetries) && o.maxRetries >= 1 &&
    (o.instructions === undefined || typeof o.instructions === "string") &&
    lists.every((x) => x === undefined || (Array.isArray(x) && x.every((s) => typeof s === "string"))) &&
    (o.autonomy === undefined || o.autonomy === "auto" || o.autonomy === "inherit") &&
    (appended === undefined || (!!record(appended) &&
      typeof record(appended)!.round === "number" && typeof record(appended)!.at === "number"))
  )
}

function validGraph(v: unknown): boolean {
  if (v === undefined) return true
  const o = record(v)
  if (!o || o.version !== 1 || (o.entryNodeId !== null && typeof o.entryNodeId !== "string")) return false
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) return false
  return o.nodes.every((n) => {
    const x = record(n), p = record(x?.position)
    return !!x && !!p && typeof x.id === "string" && typeof x.phaseId === "string" &&
      typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)
  }) && o.edges.every((e) => {
    const x = record(e)
    return !!x && typeof x.id === "string" && typeof x.source === "string" && typeof x.target === "string" &&
      (x.condition === "success" || x.condition === "failure" || x.condition === "always") &&
      (x.label === undefined || typeof x.label === "string") &&
      (x.maxTraversals === undefined || (typeof x.maxTraversals === "number" && Number.isInteger(x.maxTraversals) && x.maxTraversals >= 1))
  })
}

function parsePreset(v: unknown): MissionPreset | null {
  const o = record(v)
  if (!o || typeof o.id !== "string" || !o.id || typeof o.name !== "string") return null
  if (!Array.isArray(o.phases) || o.phases.length === 0 || !o.phases.every(validPhaseDef)) return null
  if (o.maxCostUsd !== null && (typeof o.maxCostUsd !== "number" || !Number.isFinite(o.maxCostUsd) || o.maxCostUsd < 0)) return null
  if (o.revision !== undefined && (typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 1)) return null
  if (o.description !== undefined && typeof o.description !== "string") return null
  if (o.mode !== undefined && o.mode !== "linear" && o.mode !== "graph") return null
  if (o.mode === "graph" && o.graph === undefined) return null
  if (!validGraph(o.graph)) return null
  if (o.gatePolicy !== undefined && o.gatePolicy !== "agente" && o.gatePolicy !== "sempre-apos-planejar" && o.gatePolicy !== "nunca") return null
  return cloneJson(o as unknown as MissionPreset)
}

function parseTransition(v: unknown): MissionTransition | null {
  const o = record(v)
  if (!o || typeof o.edgeId !== "string" || !o.edgeId || typeof o.sourceNodeId !== "string" ||
      typeof o.targetNodeId !== "string" || !Number.isInteger(o.sourceVisit) || !Number.isInteger(o.targetVisit) ||
      (o.sourceVisit as number) < 0 || (o.targetVisit as number) < 0 ||
      (o.outcome !== "success" && o.outcome !== "failure") ||
      typeof o.at !== "number" || !Number.isFinite(o.at) || o.at < 0) return null
  return cloneJson(o as unknown as MissionTransition)
}

function parseExecution(v: unknown): MissionGraphExecution | null {
  if (v === undefined) return null
  const o = record(v)
  const snapshot = parsePreset(o?.planSnapshot)
  if (!o || o.version !== 2 || typeof o.planId !== "string" || !o.planId ||
      !Number.isInteger(o.planRevision) || (o.planRevision as number) < 1 || !snapshot ||
      o.planId !== snapshot.id || o.planRevision !== (snapshot.revision ?? 1) || !Array.isArray(o.transitions)) return null
  const transitions = o.transitions.map(parseTransition)
  if (transitions.some((t) => t === null)) return null
  return { version: 2, planId: o.planId, planRevision: o.planRevision as number,
    planSnapshot: snapshot, transitions: transitions as MissionTransition[] }
}

function parseStatePhase(v: unknown, fallback: MissionPhaseDef | undefined, missionId: string, index: number): RunStatePhase | null {
  const o = record(v)
  if (!o || !PHASE_STATUSES.includes(o.status as MissionPhaseStatus)) return null
  const def = validPhaseDef(o.def) ? cloneJson(o.def) : fallback ? cloneJson(fallback) : null
  if (!def) return null
  if (o.outcome !== undefined && o.outcome !== "success" && o.outcome !== "failure") return null
  if (o.enteredViaEdgeId !== undefined && o.enteredViaEdgeId !== null && typeof o.enteredViaEdgeId !== "string") return null
  const status = o.status as MissionPhaseStatus
  const outcome = (o.outcome as MissionNodeOutcome | undefined) ?? inferredOutcome(status)
  return {
    def,
    visitId: typeof o.visitId === "string" && o.visitId ? o.visitId : `${missionId}:visit:${index}`,
    nodeId: typeof o.nodeId === "string" && o.nodeId ? o.nodeId : `node-${def.id}`,
    enteredViaEdgeId: typeof o.enteredViaEdgeId === "string" ? o.enteredViaEdgeId : null,
    ...(outcome ? { outcome } : {}),
    status,
    costUsd: typeof o.costUsd === "number" && Number.isFinite(o.costUsd) && o.costUsd >= 0 ? o.costUsd : 0,
    ...(COST_SOURCES.includes(o.costSource as CostSource) ? { costSource: o.costSource as CostSource } : {}),
    ...(typeof o.endedAt === "number" && o.endedAt > 0 ? { endedAt: o.endedAt } : {}),
    ...(typeof o.error === "string" && o.error ? { error: o.error } : {}),
  }
}

function validGate(v: unknown): v is MissionGate {
  const o = record(v)
  return !!o && Number.isInteger(o.phase) && (o.phase as number) >= 0 &&
    Array.isArray(o.questions) && o.questions.every((q) => typeof q === "string")
}

function validRecovery(v: unknown): v is MissionRecovery {
  const o = record(v)
  return !!o && Number.isInteger(o.phase) && (o.phase as number) >= 0 &&
    typeof o.error === "string" && typeof o.message === "string"
}

/** Normaliza o veredito persistido (lixo/ausente ⇒ null). */
function parseReview(v: unknown): RunStateReview | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.approved !== "boolean" || typeof o.feedback !== "string") {
    return null
  }
  return { approved: o.approved, feedback: o.feedback }
}

/** Normaliza a ressalva persistida (lixo/ausente ⇒ null). */
function parseCaveat(v: unknown): MissionReviewCaveat | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.rounds !== "number" || typeof o.feedback !== "string") {
    return null
  }
  return { rounds: o.rounds, feedback: o.feedback }
}

/** Parse defensivo do v2. Arquivos v1 não migram. */
export function parseRunState(raw: string): MissionRunState | null {
  if (!raw || !raw.trim()) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  const o = obj as Record<string, unknown>
  if (o.version !== RUN_STATE_VERSION) return null
  if (typeof o.missionId !== "string" || !o.missionId) return null
  if (typeof o.dir !== "string" || !o.dir) return null
  if (typeof o.convId !== "string" || !o.convId) return null
  if (typeof o.task !== "string") return null
  const preset = parsePreset(o.preset)
  if (!preset) return null
  const execution = parseExecution(o.execution)
  if (!execution) return null
  const status = o.status as RunStateStatus
  if (!STATUSES.includes(status)) return null
  if (!Array.isArray(o.phases)) return null
  const parsedPhases = o.phases.map((p, i) => parseStatePhase(p, preset.phases[i], o.missionId as string, i))
  if (parsedPhases.some((p) => p === null)) return null
  const visits = parsedPhases as RunStatePhase[]
  if (!validMissionRunLedger(execution, visits)) return null
  if (o.gate != null && !validGate(o.gate)) return null
  if (o.recovery != null && !validRecovery(o.recovery)) return null
  return {
    version: RUN_STATE_VERSION,
    missionId: o.missionId,
    dir: o.dir,
    convId: o.convId,
    task: o.task,
    preset: cloneJson(execution.planSnapshot),
    execution,
    current: Number.isInteger(o.current) && (o.current as number) >= 0 ? o.current as number : 0,
    phases: visits,
    costTotal: typeof o.costTotal === "number" && Number.isFinite(o.costTotal) && o.costTotal >= 0 ? o.costTotal : 0,
    maxCostUsd: typeof o.maxCostUsd === "number" && Number.isFinite(o.maxCostUsd) && o.maxCostUsd >= 0 ? o.maxCostUsd : null,
    gateDecisions: typeof o.gateDecisions === "string" ? o.gateDecisions : null,
    gate: o.gate == null ? null : cloneJson(o.gate as unknown as MissionGate),
    recovery: o.recovery == null ? null : cloneJson(o.recovery as unknown as MissionRecovery),
    reviewLoops: typeof o.reviewLoops === "number" && o.reviewLoops >= 0 ? o.reviewLoops : 0,
    lastReview: parseReview(o.lastReview),
    reviewCaveat: parseCaveat(o.reviewCaveat),
    status,
    updatedAt: typeof o.updatedAt === "number" ? o.updatedAt : 0,
  }
}

/** A detecção deve oferecer RETOMADA? Só arquivo `running` (o app morreu com a
 *  missão em voo) e da PRÓPRIA conversa. done/error/aborted/abandoned são
 *  terminais — o usuário já viu (ou descartou) o desfecho. */
export function shouldOfferResume(
  state: MissionRunState,
  convId: string,
): boolean {
  return state.status === "running" && state.convId === convId
}

/** Lê o snapshot de UMA missão (pasta `dir` sob o cwd). null em qualquer falha
 *  (sem arquivo, JSON inválido, fora do Tauri) — o chamador não oferece
 *  retomada. */
export async function readRunState(
  cwd: string,
  dir: string,
): Promise<MissionRunState | null> {
  try {
    const rel = runStatePath(dir)
    const raw = await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${rel}`,
    })
    return parseRunState(raw)
  } catch {
    return null
  }
}

/** Ponteiro por conversa → dir da missão ativa/última (retomada sem varrer FS,
 *  já que as pastas são gitignoradas). */
interface ActivePointer {
  dir: string
}

/** Grava o ponteiro da conversa apontando pro dir da missão. Best-effort. */
export async function writeActivePointer(
  cwd: string,
  convId: string,
  dir: string,
): Promise<string | null> {
  try {
    await invoke("write_mission_state", {
      cwd,
      relPath: activePointerPath(convId),
      content: JSON.stringify({ dir } satisfies ActivePointer),
    })
    return null
  } catch (err) {
    console.warn("[missão] falha ao gravar ponteiro de missão ativa:", err)
    return "não foi possível gravar o ponteiro da missão ativa"
  }
}

/** Lê o dir da missão ativa/última da conversa (null se não há ponteiro). */
export async function readActivePointer(
  cwd: string,
  convId: string,
): Promise<string | null> {
  try {
    const raw = await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/${activePointerPath(convId)}`,
    })
    const o = JSON.parse(raw) as Partial<ActivePointer>
    return typeof o.dir === "string" && o.dir ? o.dir : null
  } catch {
    return null
  }
}

/** Detecta a missão interrompida de uma conversa: segue o ponteiro → lê o
 *  run-state daquela pasta. null se não há ponteiro ou run-state. */
export async function readInterruptedFor(
  cwd: string,
  convId: string,
): Promise<MissionRunState | null> {
  const dir = await readActivePointer(cwd, convId)
  if (!dir) return null
  return readRunState(cwd, dir)
}

/** Garante que `.frota/.gitignore` (=`*`) exista no cwd da missão. O
 *  onboarding do projeto semeia isso, mas um worktree fresco (cwd de missão sem
 *  onboarding) não teria — e os artefatos de missão ficariam rastreáveis no git.
 *  Best-effort e SEM clobber: só escreve se o arquivo estiver AUSENTE. */
export async function ensureMissionsGitignore(cwd: string): Promise<void> {
  try {
    await invoke<string>("read_text_file", {
      root: cwd,
      path: `${cwd}/.mycockpit/.gitignore`,
    })
    return // já existe (semeado pelo onboarding ou por nós) → não toca
  } catch {
    // ausente → semeia; write_mission_state cria a pasta e valida o caminho.
    try {
      await invoke("write_mission_state", {
        cwd,
        relPath: caminhoNaPasta(".gitignore"),
        content: "*\n",
      })
    } catch (err) {
      console.warn("[missão] falha ao semear .mycockpit/.gitignore:", err)
    }
  }
}

/** Fila de escrita POR cwd: os marcos disparam fire-and-forget e o comando
 *  Rust roda em thread pool — sem a corrente, duas escritas próximas poderiam
 *  pousar fora de ordem (um snapshot `running` velho por cima do `done`/`aborted`
 *  terminal ⇒ o boot re-ofereceria retomada de missão encerrada). */
const writeChain = new Map<string, Promise<string | null>>()

/** Grava o snapshot no worktree (escrita atômica no Rust, serializada por cwd
 *  na ordem das chamadas). BEST-EFFORT: falha vira warn no console e a missão
 *  segue — persistir nunca derruba o run. */
export function writeRunState(
  cwd: string,
  state: MissionRunState,
): Promise<string | null> {
  // serializa AGORA (snapshot do marco), grava na vez dela.
  const content = JSON.stringify(state, null, 2)
  const relPath = runStatePath(state.dir)
  // corrente por ARQUIVO (cwd+dir): missões diferentes no mesmo cwd têm dirs
  // distintos e não competem; a ordem só importa dentro da MESMA missão.
  const key = `${cwd}::${relPath}`
  const next = (writeChain.get(key) ?? Promise.resolve(null)).then(async () => {
    try {
      await invoke("write_mission_state", { cwd, relPath, content })
      return null
    } catch (err) {
      console.warn("[missão] falha ao persistir run-state no worktree:", err)
      return "não foi possível gravar o checkpoint da missão"
    }
  })
  writeChain.set(key, next)
  return next
}
