// Estado GLOBAL dos jobs de update dos CLIs (painel "CLIs instaladas").
//
// Por que store global, e não estado do SettingsDialog (incidente 2026-07):
// o botão "Atualizar" usava `busy` local do componente + `toast.loading`
// ANÔNIMO por clique. Cada clique disparava um `update_agent` novo (N `brew
// upgrade` concorrentes brigando pelo lock do brew), os toasts "Atualizando…"
// empilhavam duplicados, e fechar o modal matava o estado enquanto a Promise
// seguia viva. O job agora é do APP: o Rust (update.rs) deduplica e roda em
// background; aqui a gente só espelha o estado (fonte única = registry do
// Rust) e dá um toast com id ESTÁVEL por agent (`update:<agent>`), promovido
// de loading pra success/error no desfecho — nunca empilha, e fechar/reabrir
// o modal não cria outro.
//
// Fail-open: se o listener de `update://event` falhar, o polling de segurança
// (update_jobs a cada 5s enquanto houver job vivo) e a re-hidratação ao abrir
// o modal ainda fecham o ciclo. Pior caso = comportamento antigo
// (request-response), nunca um botão travado sem saída.

import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { isTauri } from "@/lib/db"
import { detectAgents, toProbeMap } from "@/lib/detect"
import { useApp } from "@/store/app"

/** Espelha UpdateJob do Rust (update.rs), camelCase via serde.
 *  `unchanged`: o comando saiu 0 mas a versão NÃO mudou (brew "already
 *  installed") — desfecho verificado, nunca vira success falso. */
export type UpdateJobStatus = "running" | "ok" | "unchanged" | "failed"

export interface UpdateJob {
  agent: string
  status: UpdateJobStatus
  /** "npm" | "homebrew" | "self-update" | "none" | "" (resolvendo) */
  method: string
  command: string
  startedAt: number
  outputTail: string
  /** versão do binário depois do job ("" = não deu pra ler). */
  version: string
  /** path REAL (canonizado) do binário que o app gerencia; "" = não achado. */
  managedPath: string
  /** DEMAIS paths do binário no PATH do app: não-vazio = instalação duplicada. */
  otherPaths: string[]
}

/** Payload de `update://event` (update.rs). */
interface UpdateEventPayload {
  agent: string
  phase: "started" | "finished"
  ok: boolean | null
  status: UpdateJobStatus
  method: string
  command: string
  startedAt: number
  outputTail: string
  version: string
  managedPath: string
  otherPaths: string[]
}

const AGENT_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
}

function labelOf(agent: string): string {
  return AGENT_LABELS[agent] ?? agent
}

/** Id ESTÁVEL do toast por agent: loading e desfecho usam o MESMO id, então o
 *  sonner substitui em vez de empilhar (era o bug dos toasts duplicados). */
export function updateToastId(agent: string): string {
  return `update:${agent}`
}

interface UpdatesState {
  byAgent: Record<string, UpdateJob>
}

export const useUpdates = create<UpdatesState>(() => ({ byAgent: {} }))

/** Estado do botão "Atualizar" de um agent: `spinning` = o job DELE está vivo;
 *  `disabled` = QUALQUER job vivo (dois brew concorrentes brigam pelo lock —
 *  melhor um update por vez, como o painel sempre prometeu). Pura, testável. */
export function updateButtonState(
  byAgent: Record<string, UpdateJob>,
  agent: string,
): { spinning: boolean; disabled: boolean } {
  const spinning = byAgent[agent]?.status === "running"
  const disabled = Object.values(byAgent).some((j) => j.status === "running")
  return { spinning, disabled }
}

/** Re-verificação de versões pós-sucesso (o "Verificar agora" mínimo): roda o
 *  detect e grava o snapshot, pra linha "instalado vX" atualizar sozinha —
 *  mesmo com o modal fechado. Catálogo/modelos agy ficam com o botão manual. */
async function recheckVersions(): Promise<void> {
  const tools = await detectAgents()
  const now = Date.now()
  const { setSettings } = useApp.getState()
  if (tools.length > 0) {
    setSettings({ detected: toProbeMap(tools, now), lastUpdateCheck: now })
  } else {
    setSettings({ lastUpdateCheck: now })
  }
}

/** Anuncia o DESFECHO no mesmo toast do loading (id estável). */
function announceOutcome(job: UpdateJob): void {
  const label = labelOf(job.agent)
  const id = updateToastId(job.agent)
  const recheck = () =>
    void recheckVersions().catch((e) => {
      console.warn("[updates] re-verificação pós-update falhou:", e)
    })
  if (job.status === "ok") {
    // "atualizado" VERIFICADO: o Rust só entrega `ok` quando a versão do
    // binário mudou de verdade (classify_outcome), não pelo exit 0.
    toast.success(
      `${label} atualizado (${job.method})${job.version ? ` para v${job.version}` : ""}.`,
      { id },
    )
    recheck()
    return
  }
  if (job.status === "unchanged") {
    // exit 0 sem a versão mudar (brew "already installed"): informativo, não
    // success falso — o incidente do "atualizado" que não atualizava nada.
    toast(
      `${label} já está na última do canal ${job.method}${job.version ? ` (v${job.version})` : ""}.`,
      { id },
    )
    recheck() // o probe por canal conserta o "última vX" e some com o botão
    return
  }
  if (job.method === "none" || !job.command) {
    // sem canal / não chegou a rodar → neutro, com o caminho manual na descrição.
    toast(`Não deu pra atualizar ${label} automaticamente.`, {
      id,
      description: job.outputTail.slice(-400),
    })
    return
  }
  toast.error(`Falha ao atualizar ${label} (${job.command}).`, {
    id,
    description: job.outputTail.slice(-300),
  })
}

/** Aplica um snapshot de job no store e cuida dos toasts NA TRANSIÇÃO.
 *  `source`:
 *  - "event": veio de `update://event` (ou do retorno do próprio start) —
 *    desfecho sempre anunciado;
 *  - "snapshot": veio de `update_jobs` (re-hidratação/polling) — desfecho só
 *    quando ANTES estava `running` aqui (job que terminou numa sessão antiga
 *    do modal não ganha toast ao reabrir). */
function applyJob(job: UpdateJob, source: "event" | "snapshot"): void {
  const prev = useUpdates.getState().byAgent[job.agent]
  useUpdates.setState((s) => ({ byAgent: { ...s.byAgent, [job.agent]: job } }))

  if (job.status === "running") {
    // toast único por episódio: só quando o job APARECE rodando (re-hidratar
    // com o mesmo job vivo não re-cria/ressuscita o toast).
    if (prev?.status !== "running") {
      toast.loading(`Atualizando ${labelOf(job.agent)}…`, {
        id: updateToastId(job.agent),
      })
    }
    ensurePolling()
    return
  }
  const wasRunning = prev?.status === "running"
  if (source === "event" || wasRunning) {
    announceOutcome(job)
  }
  stopPollingIfIdle()
}

/** Traduz o payload do evento num snapshot de job. `status` vem do Rust (é o
 *  desfecho verificado); o fallback por phase/ok cobre payload antigo. */
function jobFromEvent(p: UpdateEventPayload): UpdateJob {
  const fallback: UpdateJobStatus =
    p.phase === "started" ? "running" : p.ok ? "ok" : "failed"
  return {
    agent: p.agent,
    status: p.status ?? fallback,
    method: p.method,
    command: p.command,
    startedAt: p.startedAt,
    outputTail: p.outputTail,
    version: p.version ?? "",
    managedPath: p.managedPath,
    otherPaths: p.otherPaths ?? [],
  }
}

/** Handler dos eventos (exportado pro teste dirigir started/finished). */
export function _handleUpdateEvent(p: UpdateEventPayload): void {
  applyJob(jobFromEvent(p), "event")
}

// ---- polling de segurança (fail-open quando os eventos falham) -------------

let pollTimer: ReturnType<typeof setInterval> | null = null

function ensurePolling(): void {
  if (pollTimer != null || !isTauri()) return
  pollTimer = setInterval(() => {
    void invoke<UpdateJob[]>("update_jobs")
      .then((jobs) => {
        for (const job of jobs) applyJob(job, "snapshot")
        stopPollingIfIdle()
      })
      .catch((e) => {
        // sem catch mudo: o polling é a rede de segurança, falha dele é notícia.
        console.warn("[updates] polling de update_jobs falhou:", e)
      })
  }, 5_000)
}

function stopPollingIfIdle(): void {
  if (pollTimer == null) return
  const anyRunning = Object.values(useUpdates.getState().byAgent).some(
    (j) => j.status === "running",
  )
  if (!anyRunning) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ---- API pública ------------------------------------------------------------

/** Início de update pelo GESTO do usuário. A trava REAL é no backend (job
 *  `running` por agent); aqui só evitamos o invoke redundante e damos o
 *  feedback imediato no mesmo toast estável. */
export async function startUpdate(agent: string): Promise<void> {
  const prev = useUpdates.getState().byAgent[agent]
  if (prev?.status === "running") return
  const label = labelOf(agent)
  const id = updateToastId(agent)
  toast.loading(`Atualizando ${label}…`, { id })
  try {
    const job = await invoke<UpdateJob>("update_agent", { agent })
    applyJob(job, "event")
  } catch (e) {
    toast.error(e instanceof Error ? e.message : `Falha ao atualizar ${label}`, {
      id,
    })
  }
}

/** Re-hidrata o store com o snapshot do registry (chamado ao abrir o modal):
 *  job vivo volta a mostrar spinner/toast; job que terminou com o modal
 *  fechado e ainda constava `running` aqui ganha o desfecho atrasado. */
export async function hydrateUpdateJobs(): Promise<void> {
  if (!isTauri()) return
  try {
    const jobs = await invoke<UpdateJob[]>("update_jobs")
    for (const job of jobs) applyJob(job, "snapshot")
  } catch (e) {
    // fail-open: sem snapshot os eventos continuam valendo.
    console.warn("[updates] re-hidratação de update_jobs falhou:", e)
  }
}

// ---- boot -------------------------------------------------------------------

let subscribed = false

/** Assina `update://event` UMA vez no boot (side-effect import no App.tsx,
 *  padrão @/lib/companion). Fora do Tauri é no-op. */
export function initUpdateEvents(): void {
  if (subscribed || !isTauri()) return
  subscribed = true
  void listen<UpdateEventPayload>("update://event", (event) => {
    _handleUpdateEvent(event.payload)
  }).catch((e) => {
    subscribed = false
    console.warn("[updates] listener de update://event falhou:", e)
  })
}

initUpdateEvents()

/** Reset de estado de módulo pros testes (padrão _resetWatchdogState). */
export function _resetUpdatesState(): void {
  useUpdates.setState({ byAgent: {} })
  if (pollTimer != null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  subscribed = false
}
