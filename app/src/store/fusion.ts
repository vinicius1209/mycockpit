// v0.3 Fusion — store IRMÃO do useChat (não estende ConvState). Um Fusion por
// conversa. A lane de cada candidato reusa SÓ o reducer de conteúdo (reduceItems);
// o `status` da lane é fonte ÚNICA (não derivada do controle do Linear).

import { create } from "zustand"
import type { AgentEvent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { reduceItems, type ChatItem } from "@/store/chat"

export type CandStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled"
  | "killed"

export interface FusionCandidate {
  id: string // slot estável (UI)
  runId: string // p/ cancelar/kill via cancel_agent
  agent: string
  reqModel: string | null
  effort: string | null
  label: string // "Claude · Opus" (desambigua repetidos)
  status: CandStatus // ← FONTE ÚNICA
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  streamingTextId: string | null
  startedAt: number | null
  finishOrder: number | null
  result?: Extract<ChatItem, { kind: "result" }>
  costUsd?: number
  costSource?: "reported" | "estimated" | "unknown"
  durationMs?: number
  killedReason?: "budget" | "user"
  cwd: string
  worktree?: { path: string; branch: string } | null // só Fase 2 (write-mode)
}

export interface FusionJudge {
  status: "idle" | "running" | "agree" | "disagree" | "single" | "unavailable"
  suggestedId: string | null
  rationale: string | null
  agreement: boolean | null // dupla-passada concordou? (confiança real)
  runnerupId: string | null
  passes: { winnerLabel: string; reason: string }[]
  notes: Record<string, string>
}

export type FusionPhase =
  | "configuring"
  | "running"
  | "judging"
  | "deciding"
  | "promoting"
  | "done"
  | "aborted"

export interface FusionRun {
  id: string
  convId: string
  itemId: string | null // liga ao ChatItem result promovido
  prompt: string
  preamble: string | null // contexto serializado (Fusion no meio da conversa)
  attachments: Attachment[]
  scope: "read-only" | "write"
  phase: FusionPhase
  candidates: FusionCandidate[]
  judge: FusionJudge
  chosenId: string | null
  judgeModel: string
  costTotal: number
  costDiscarded: number
  createdAt: number
}

export interface LeagueConfig {
  scope: "read-only" | "write"
  judgeModel: string
  candidates: { agent: string; model: string | null; effort: string | null }[]
}

const AGENT_LABEL: Record<string, string> = {
  "claude-code": "Claude",
  codex: "Codex",
  opencode: "OpenCode",
}

/** Rótulo legível de um candidato ("Claude · Opus"). */
export function candLabel(agent: string, model: string | null): string {
  const a = AGENT_LABEL[agent] ?? agent
  return model ? `${a} · ${model}` : a
}

const emptyJudge = (): FusionJudge => ({
  status: "idle",
  suggestedId: null,
  rationale: null,
  agreement: null,
  runnerupId: null,
  passes: [],
  notes: {},
})

/** Monta um FusionRun com os candidatos em `queued` (T1.2). O fan-out real
 *  (runAgent por candidato) entra no T2.2. */
export function buildFusionRun(
  convId: string,
  cfg: LeagueConfig,
  prompt: string,
  preamble: string | null,
  attachments: Attachment[],
  projectPath: string,
): FusionRun {
  const candidates: FusionCandidate[] = cfg.candidates.map((c) => ({
    id: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    agent: c.agent,
    reqModel: c.model,
    effort: c.effort,
    label: candLabel(c.agent, c.model),
    status: "queued",
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    startedAt: null,
    finishOrder: null,
    cwd: projectPath,
    worktree: null,
  }))
  return {
    id: crypto.randomUUID(),
    convId,
    itemId: null,
    prompt,
    preamble,
    attachments,
    scope: cfg.scope,
    phase: "running",
    candidates,
    judge: emptyJudge(),
    chosenId: null,
    judgeModel: cfg.judgeModel,
    costTotal: 0,
    costDiscarded: 0,
    createdAt: Date.now(),
  }
}

interface FusionState {
  byConv: Record<string, FusionRun>
  /** Registra um FusionRun pronto (candidatos queued). */
  start: (convId: string, run: FusionRun) => void
  /** Aplica um evento de UM candidato: conteúdo via reduceItems + status explícito. */
  handleCandidateEvent: (convId: string, candId: string, e: AgentEvent) => void
  /** Done: o processo do candidato saiu → marca done + ordem de chegada. */
  finishCandidate: (convId: string, candId: string) => void
  /** Remove o Fusion da conversa (após promover ou abortar). */
  clear: (convId: string) => void
}

function patchCand(
  fusion: FusionRun,
  candId: string,
  fn: (c: FusionCandidate) => FusionCandidate,
): FusionRun {
  return {
    ...fusion,
    candidates: fusion.candidates.map((c) => (c.id === candId ? fn(c) : c)),
  }
}

export const useFusion = create<FusionState>((set) => ({
  byConv: {},

  start: (convId, run) => set((s) => ({ byConv: { ...s.byConv, [convId]: run } })),

  // T1.3 — `set` síncrono; só a lane-alvo muda; status é fonte ÚNICA (não vem do
  // reduceEvent). Sem `await` entre ler e escrever → elimina o race de N escritas.
  handleCandidateEvent: (convId, candId, e) =>
    set((s) => {
      const fusion = s.byConv[convId]
      if (!fusion) return {}
      const next = patchCand(fusion, candId, (c) => {
        const merged = { ...c, ...reduceItems(c, e) }
        if (e.type === "result") {
          merged.status = "finalizing"
          merged.result = merged.items[merged.items.length - 1] as Extract<
            ChatItem,
            { kind: "result" }
          >
          merged.costUsd = e.cost_usd ?? undefined
          merged.costSource = e.cost_source
          merged.durationMs = c.startedAt ? Date.now() - c.startedAt : undefined
        } else if (e.type === "error") {
          merged.status = "error"
        } else if (e.type === "cancelled") {
          merged.status = "cancelled"
        } else if (c.status === "queued") {
          merged.status = "running" // 1º evento de conteúdo → rodando
        }
        return merged
      })
      return { byConv: { ...s.byConv, [convId]: next } }
    }),

  // T1.4 — Done (processo saiu). Se ainda não-terminal, marca done + finishOrder.
  finishCandidate: (convId, candId) =>
    set((s) => {
      const fusion = s.byConv[convId]
      if (!fusion) return {}
      const order = fusion.candidates.filter((c) => c.finishOrder != null).length
      const next = patchCand(fusion, candId, (c) => {
        const terminal =
          c.status === "error" || c.status === "cancelled" || c.status === "killed"
        return {
          ...c,
          status: terminal ? c.status : "done",
          finishOrder: c.finishOrder ?? order,
        }
      })
      return { byConv: { ...s.byConv, [convId]: next } }
    }),

  clear: (convId) =>
    set((s) => {
      const rest = { ...s.byConv }
      delete rest[convId]
      return { byConv: rest }
    }),
}))
