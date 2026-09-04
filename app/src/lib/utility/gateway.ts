import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { recordUtilityUsage } from "@/lib/db/conversationMaps"
import type {
  UtilityRequest,
  UtilityResult,
  UtilitySourceDescriptor,
  UtilityTaskKind,
} from "./types"
import { UTILITY_PROFILES } from "./profiles"

function unavailable<T>(
  startedAt: number,
  reason: UtilityResult<T>["fallbackReason"],
): UtilityResult<T> {
  return {
    status: "unavailable",
    source: null,
    timing: { startedAt, durationMs: Date.now() - startedAt },
    fallbackReason: reason,
  }
}

type UnknownRequest = UtilityRequest<unknown>
type UnknownResult = UtilityResult<unknown>
type Lane = "device" | "helper"

interface ScheduledJob {
  request: UnknownRequest
  key: string
  scope: string
  lane: Lane
  priority: number
  queuedAt: number
  deadlineAt: number
  attempts: Set<string>
  state: "pending" | "running"
  timer: ReturnType<typeof setTimeout>
  promise: Promise<UnknownResult>
  resolve: (result: UnknownResult) => void
}

const jobs: ScheduledJob[] = []
const jobsByKey = new Map<string, ScheduledJob>()
const jobsByAttempt = new Map<string, ScheduledJob>()
const running: Record<Lane, boolean> = { device: false, helper: false }

function priorityOf(task: UtilityTaskKind): number {
  return { high: 0, normal: 1, low: 2 }[UTILITY_PROFILES[task].priority]
}

function laneOf(task: UtilityTaskKind): Lane {
  return task === "conversation_map" ? "device" : "helper"
}

function scopeOf(request: UnknownRequest): string {
  return [
    request.task,
    request.conversationId ?? request.projectId ?? request.workingDirectory ?? "global",
  ].join(":")
}

function keyOf(request: UnknownRequest): string {
  return [
    scopeOf(request),
    request.inputDigest,
    request.routePolicy,
    request.locale,
    request.helperModel ?? "",
  ].join(":")
}

function terminalResult(
  job: ScheduledJob,
  status: "cancelled" | "timed_out",
): UnknownResult {
  return {
    status,
    source: null,
    timing: {
      startedAt: job.queuedAt,
      durationMs: Date.now() - job.queuedAt,
    },
    fallbackReason: status === "cancelled" ? "cancelled" : "deadline_exceeded",
  }
}

function finish(job: ScheduledJob, result: UnknownResult) {
  clearTimeout(job.timer)
  const index = jobs.indexOf(job)
  if (index >= 0) jobs.splice(index, 1)
  if (jobsByKey.get(job.key) === job) jobsByKey.delete(job.key)
  for (const attempt of job.attempts) {
    if (jobsByAttempt.get(attempt) === job) jobsByAttempt.delete(attempt)
  }
  job.resolve(result)
}

function drain(lane: Lane) {
  if (running[lane]) return
  const next = jobs
    .filter((job) => job.lane === lane && job.state === "pending")
    .sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt)[0]
  if (!next) return
  if (Date.now() >= next.deadlineAt) {
    finish(next, terminalResult(next, "timed_out"))
    drain(lane)
    return
  }
  running[lane] = true
  next.state = "running"
  void invoke<UnknownResult>("utility_generate", { request: next.request })
    .catch((error) => {
      console.warn("[inferência utilitária] chamada falhou", next.request.task, error)
      return {
        status: "failed" as const,
        source: null,
        timing: {
          startedAt: next.queuedAt,
          durationMs: Date.now() - next.queuedAt,
        },
        fallbackReason: "process_failed" as const,
      }
    })
    .then((result) => finish(next, result))
    .finally(() => {
      running[lane] = false
      drain(lane)
    })
}

function schedule(request: UnknownRequest): Promise<UnknownResult> {
  const key = keyOf(request)
  const duplicate = jobsByKey.get(key)
  if (duplicate) {
    duplicate.attempts.add(request.attemptId)
    jobsByAttempt.set(request.attemptId, duplicate)
    return duplicate.promise
  }
  const scope = scopeOf(request)
  for (const older of [...jobs]) {
    if (older.scope === scope && older.state === "pending") {
      finish(older, terminalResult(older, "cancelled"))
    }
  }
  const queuedAt = Date.now()
  let resolve!: (result: UnknownResult) => void
  const promise = new Promise<UnknownResult>((done) => {
    resolve = done
  })
  const job: ScheduledJob = {
    request,
    key,
    scope,
    lane: laneOf(request.task),
    priority: priorityOf(request.task),
    queuedAt,
    deadlineAt: queuedAt + request.deadlineMs,
    attempts: new Set([request.attemptId]),
    state: "pending",
    timer: setTimeout(() => {
      if (job.state === "pending") finish(job, terminalResult(job, "timed_out"))
    }, request.deadlineMs),
    promise,
    resolve,
  }
  jobs.push(job)
  jobsByKey.set(key, job)
  jobsByAttempt.set(request.attemptId, job)
  drain(job.lane)
  return promise
}

export function createUtilityAttemptId(): string {
  return crypto.randomUUID()
}

export async function probeUtilitySources(
  locale = "pt-BR",
): Promise<UtilitySourceDescriptor[]> {
  if (!isTauri()) return []
  try {
    const sources = await invoke<UtilitySourceDescriptor[]>("utility_probe", {
      locale,
    })
    return Array.isArray(sources) ? sources : []
  } catch (error) {
    console.warn("[inferência utilitária] probe falhou", error)
    return []
  }
}

export function generateUtility<TInput, TOutput>(
  request: UtilityRequest<TInput>,
): Promise<UtilityResult<TOutput>> {
  const startedAt = Date.now()
  if (request.routePolicy === "off" || !isTauri()) {
    return Promise.resolve(unavailable(startedAt, "framework_unavailable"))
  }
  return schedule(request as UnknownRequest) as Promise<UtilityResult<TOutput>>
}

export async function cancelUtility(attemptId: string): Promise<void> {
  if (!isTauri()) return
  const job = jobsByAttempt.get(attemptId)
  if (job?.state === "pending") {
    finish(job, terminalResult(job, "cancelled"))
    return
  }
  try {
    await invoke("utility_cancel", {
      attemptId: job?.request.attemptId ?? attemptId,
    })
  } catch (error) {
    console.warn("[inferência utilitária] cancelamento falhou", attemptId, error)
  }
}

async function digestText(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}

type TextUtilityTask = Exclude<UtilityTaskKind, "conversation_map">

/**
 * Compatibilidade dos consumidores que já usavam o helper remoto antes do
 * gateway. O opt-in legado vale apenas para a finalidade passada aqui; nunca
 * autoriza o mapa da conversa nem outro consumidor por consequência.
 */
export async function generateUtilityText(input: {
  task: TextUtilityTask
  model: string
  cwd: string
  prompt: string
  deadlineMs?: number
}): Promise<string> {
  const attemptId = createUtilityAttemptId()
  const result = await generateUtility<{ prompt: string }, string>({
    attemptId,
    task: input.task,
    locale: "pt-BR",
    payload: { prompt: input.prompt },
    inputDigest: await digestText(input.prompt),
    routePolicy: "approved_helper",
    workingDirectory: input.cwd,
    deadlineMs:
      input.deadlineMs ?? UTILITY_PROFILES[input.task].defaultDeadlineMs,
    helperModel: input.model,
    remoteAuthorized: true,
  })
  if (result.source) {
    void recordUtilityUsage({
      task: input.task,
      sourceId: result.source.id,
      ok: result.status === "ok",
      costUsd: result.cost?.usd ?? null,
      latencyMs: result.timing.durationMs,
    }).catch((error) =>
      console.warn("[inferência utilitária] uso não persistido", error),
    )
  }
  if (result.status !== "ok" || typeof result.value !== "string") {
    throw new Error(result.fallbackReason ?? result.status)
  }
  return result.value
}
