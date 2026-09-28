// v0.3 Fusion, store IRMÃO do useChat (não estende ConvState). Um Fusion por
// conversa. A lane de cada candidato reusa SÓ o reducer de conteúdo (reduceItems);
// o `status` da lane é fonte ÚNICA (não derivada do controle do Linear).

import { create } from "zustand"
import { runAgent, cancelAgent, type AgentEvent, type CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { blocoDaDoutrina, readDoctrine } from "@/lib/doctrine"
import { reduceItems, useChat, type ChatItem } from "@/store/chat"
import { useApp } from "@/store/app"
import {
  runJudge,
  serializeContext,
  runWithConcurrency,
  emptyJudge,
  candLabel,
  decideChosen,
} from "@/lib/fusion"
import {
  renderTranscript,
  exportConvContext,
  memoryPointerLine,
} from "@/lib/transcript"
import {
  saveFusionRun,
  loadPendingFusion,
  clearPendingFusion,
  recordTurnCost,
} from "@/lib/db"
import type { AgentRunConfig } from "@/lib/types"
import { LEAGUE_AGENTS } from "@/lib/agents"
import { expandPrefixedDraft } from "@/lib/slashDispatch"
import { isFailed, isRunning, type CandStatus } from "@/store/fusionStatus"
export { isFailed, isRunning, type CandStatus } from "@/store/fusionStatus"

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
  costSource?: CostSource
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
  candidates: AgentRunConfig[]
}

/** Default do "Disputar": o agent efetivo e o primeiro OUTRO motor disponível
 *  com a capability `disputes` (nunca um par fixo). Read-only, juiz sonnet.
 *  Fica ao lado de `launch` para todo caller herdar a mesma política. */
export function defaultLeague(run: AgentRunConfig): LeagueConfig {
  const complementary =
    LEAGUE_AGENTS.find((a) => a.disputes && a.id !== run.agent)?.id ??
    // sem outro disputante declarado: qualquer outro motor disponível é mais
    // honesto que repetir o mesmo (disputa de um só não compara nada).
    LEAGUE_AGENTS.find((a) => a.id !== run.agent)?.id ??
    run.agent
  return {
    scope: "read-only",
    judgeModel: "sonnet",
    candidates: [
      { agent: run.agent, model: run.model, effort: run.effort },
      { agent: complementary, model: null, effort: null },
    ],
  }
}

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
  /** Dispara o Fusion: fan-out de N candidatos read-only em paralelo + juiz. */
  launch: (
    convId: string,
    cfg: LeagueConfig,
    prompt: string,
    attachments: Attachment[],
    projectPath: string,
    permission: string,
  ) => Promise<void>
  /** Roda o juiz (dupla-passada) sobre os sobreviventes → fase deciding. */
  runJudgePhase: (convId: string) => Promise<void>
  /** Aborta a disputa em voo: cancela os candidatos, pula o juiz, limpa o board. */
  abort: (convId: string) => void
  /** Confirma o vencedor → promove pra conversa + arquiva + limpa o board. */
  confirm: (convId: string, candId: string) => Promise<void>
  /** Restaura uma disputa PENDENTE do disco (caso 2) ao abrir a conversa. */
  restorePending: (convId: string) => Promise<void>
  /** Descarta uma disputa pendente, limpa o board + marca resolvida no disco. */
  discard: (convId: string) => void
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

export const useFusion = create<FusionState>((set, get) => {
  /** Patch parcial de UM FusionRun (no-op se a conversa não tem disputa).
   *  Espelha o `patch` do chat store. */
  const patchConv = (
    convId: string,
    p: Partial<FusionRun> | ((cur: FusionRun) => Partial<FusionRun>),
  ) =>
    set((s) => {
      const cur = s.byConv[convId]
      if (!cur) return {}
      const partial = typeof p === "function" ? p(cur) : p
      return { byConv: { ...s.byConv, [convId]: { ...cur, ...partial } } }
    })

  return {
  byConv: {},

  start: (convId, run) => set((s) => ({ byConv: { ...s.byConv, [convId]: run } })),

  // T1.3, `set` síncrono; só a lane-alvo muda; status é fonte ÚNICA (não vem do
  // reduceEvent). Sem `await` entre ler e escrever → elimina o race de N escritas.
  handleCandidateEvent: (convId, candId, e) => {
    // Ledger de resoluções observadas (P2): lanes da disputa também ensinam o
    // app sobre o que cada CLI resolve (só grava; notices de shift ficam no
    // chat Linear pra não poluir a arena).
    if (e.type === "session") {
      const cand = get().byConv[convId]?.candidates.find((c) => c.id === candId)
      if (cand) {
        useApp.getState().recordResolution(cand.agent, cand.reqModel, e.model)
      }
    }
    // Ledger: custo do candidato (disputa é caminho disjunto do chat/missão →
    // sem dupla contagem; sem preço entra NULL, ADR-047). REPLACE por runId.
    if (e.type === "result") {
      const cand = get().byConv[convId]?.candidates.find((c) => c.id === candId)
      const projectId = useChat.getState().byId[convId]?.projectId
      if (cand && projectId) {
        void recordTurnCost({
          runId: cand.runId,
          projectId,
          convId,
          agent: cand.agent,
          model: cand.model ?? cand.reqModel,
          costUsd: e.cost_usd,
          costSource: e.cost_source ?? null,
          input: e.input_tokens ?? 0,
          output: e.output_tokens ?? 0,
          cache: (e.cache_read ?? 0) + (e.cache_creation ?? 0),
        })
      }
    }
    set((s) => {
      const fusion = s.byConv[convId]
      if (!fusion) return {}
      const next = patchCand(fusion, candId, (c) => {
        const merged = {
          ...c,
          ...reduceItems(c, e, { agent: c.agent, reqModel: c.reqModel }),
        }
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
          merged.startedAt = Date.now()
        }
        return merged
      })
      return { byConv: { ...s.byConv, [convId]: next } }
    })
  },

  // T1.4, Done (processo saiu). Se ainda não-terminal, marca done + finishOrder.
  finishCandidate: (convId, candId) =>
    set((s) => {
      const fusion = s.byConv[convId]
      if (!fusion) return {}
      const order = fusion.candidates.filter((c) => c.finishOrder != null).length
      const next = patchCand(fusion, candId, (c) => ({
        ...c,
        status:
          c.status === "blocked" || isFailed(c.status) ? c.status : "done",
        finishOrder: c.finishOrder ?? order,
      }))
      return { byConv: { ...s.byConv, [convId]: next } }
    }),

  clear: (convId) =>
    set((s) => {
      const rest = { ...s.byConv }
      delete rest[convId]
      return { byConv: rest }
    }),

  // T2.2, fan-out de N candidatos read-only em paralelo (concorrência limitada=3).
  launch: async (convId, cfg, prompt, attachments, projectPath, permission) => {
    // Uma disputa por vez: em voo, ignora; esperando decisão, resolve a antiga
    // no disco antes de abrir a nova (senão o restorePending ressuscitaria um
    // zumbi).
    const existing = get().byConv[convId]
    if (existing) {
      if (
        existing.phase === "running" ||
        existing.phase === "judging" ||
        existing.phase === "promoting"
      ) {
        return
      }
      get().discard(convId)
    }
    const prevConv = useChat.getState().byId[convId]
    // Preâmbulo enriquecido (user/text + tool calls compactadas) + MEMÓRIA
    // PLENA consultável: exporta o transcript completo pro arquivo do projeto
    // e aponta o caminho no preâmbulo — o candidato PUXA mais contexto se
    // precisar. Best-effort: falha no export → segue só com o recap.
    let preamble: string | null = null
    if (prevConv && prevConv.items.length) {
      preamble = serializeContext(prevConv.items)
      if (projectPath) {
        try {
          const md = renderTranscript(prevConv.items, { agent: prevConv.agent })
          const rel = await exportConvContext(projectPath, convId, md)
          preamble += `\n\n${memoryPointerLine(rel)}`
        } catch {
          // sem ponteiro, a disputa segue com o recap
        }
      }
    }
    const run = buildFusionRun(convId, cfg, prompt, preamble, attachments, projectPath)
    set((s) => ({ byConv: { ...s.byConv, [convId]: run } }))
    useChat.getState().beginFusion(convId, prompt, attachments)

    const preamblePrefix = preamble ? `${preamble}\n\n---\n\n` : ""
    // DOUTRINA do projeto: cada candidato é um run NOVO de uma CLI diferente —
    // sem este bloco a disputa acontece com metade dos concorrentes cegos às
    // regras do projeto (só o Claude Code leria um CLAUDE.md). Sempre injeta
    // (não existe "1º turno" aqui). Best-effort: sem arquivo, segue igual.
    let doctrinePrefix = ""
    if (projectPath) {
      const block = blocoDaDoutrina(await readDoctrine(projectPath))
      if (block) doctrinePrefix = `${block}\n\n`
    }
    // `/comando` expande por candidato: cada lane pode ser outro motor, e a
    // expansão é do agent dela. Com preâmbulo ou doutrina, o pedido vai
    // embutido e nem comando nativo viaja cru. Sem match, segue texto.
    const embedded = preamblePrefix !== "" || doctrinePrefix !== ""
    const promptFor = (agent: string) =>
      expandPrefixedDraft(prompt, projectPath, agent, embedded, `${doctrinePrefix}${preamblePrefix}`)
    const perm = cfg.scope === "read-only" ? "fusion-ro" : permission

    await runWithConcurrency(run.candidates, 3, async (c) => {
      try {
        const expanded = await promptFor(c.agent)
        await runAgent(
          c.runId,
          convId,
          c.agent,
          c.reqModel,
          c.effort,
          expanded.text,
          c.cwd,
          null, // resume=null: candidato é sessão fresca
          perm,
          attachments,
          (e) => {
            if (e.type === "preflight_blocked") {
              set((s) => {
                const f = s.byConv[convId]
                if (!f) return {}
                return {
                  byConv: {
                    ...s.byConv,
                    [convId]: patchCand(f, c.id, (candidate) => ({
                      ...candidate,
                      status: "blocked" as CandStatus,
                      startedAt: null,
                    })),
                  },
                }
              })
              return
            }
            get().handleCandidateEvent(convId, c.id, e)
          },
          { instructionSources: expanded.instructionSources },
        )
      } catch {
        get().handleCandidateEvent(convId, c.id, {
          type: "error",
          message: "falha ao iniciar o candidato",
        })
      }
      get().finishCandidate(convId, c.id)
    })

    // abortada no meio do fan-out (board já limpo) → não gasta com o juiz.
    if (!get().byConv[convId]) return
    await get().runJudgePhase(convId)
  },

  // Stop: cancela cada candidato em voo, zera o spinner e descarta o board. O
  // juiz one-shot não é cancelável; o guard do launch impede que comece.
  abort: (convId) => {
    const f = get().byConv[convId]
    if (!f || (f.phase !== "running" && f.phase !== "judging")) return
    for (const c of f.candidates) {
      if (isRunning(c.status)) void cancelAgent(c.runId)
    }
    useChat.getState().finish(convId)
    get().discard(convId)
  },

  // T2.4/T2.5, juiz dupla-passada + pré-seleção CONDICIONAL (concordou + neutro).
  runJudgePhase: async (convId) => {
    const f = get().byConv[convId]
    if (!f) return
    patchConv(convId, (cur) => ({
      phase: "judging",
      judge: { ...cur.judge, status: "running" },
    }))
    const cwd = f.candidates[0]?.cwd ?? ""
    const cands = get().byConv[convId]?.candidates ?? []
    const { judge, cost } = await runJudge(f.prompt, f.judgeModel, cwd, cands)
    // Custo único da disputa: candidatos e juiz.
    const candCost = cands.reduce((s, c) => s + (c.costUsd ?? 0), 0)
    patchConv(convId, (cur) => ({
      phase: "deciding",
      judge,
      chosenId: decideChosen(judge, cur.candidates, cur.judgeModel),
      costTotal: candCost + cost,
    }))
    // Caso 2: persiste a disputa pendente (sobrevive ao restart até você decidir).
    const pending = get().byConv[convId]
    if (pending && pending.phase === "deciding") {
      // Disputa concluída espera a SUA decisão, não um processo: zera o running.
      useChat.getState().finish(convId)
      void saveFusionRun(pending.id, convId, pending, true)
      void useChat.getState().persist(convId) // garante o prompt do usuário no DB
    }
  },

  // T2.8, confirma o vencedor → promove pra conversa + arquiva + limpa.
  confirm: async (convId, candId) => {
    const f = get().byConv[convId]
    if (!f) return
    const winner = f.candidates.find((c) => c.id === candId)
    if (!winner) return
    // rastro da disputa no Linear: quem ganhou e o que o juiz havia sugerido.
    const suggested = f.candidates.find((c) => c.id === f.judge.suggestedId)
    const notice =
      suggested && suggested.id === winner.id
        ? `Vencedor da disputa · ${winner.label} (sugerido pelo juiz)`
        : suggested
          ? `Vencedor da disputa · ${winner.label} (juiz sugeriu ${suggested.label})`
          : `Vencedor da disputa · ${winner.label}`
    patchConv(convId, { chosenId: candId, phase: "promoting" })
    await useChat.getState().promoteFusion(convId, winner, notice)
    // arquiva (pending=0): sai da fila de restauração, fica só pra "ver disputa".
    void saveFusionRun(f.id, convId, { ...f, chosenId: candId, phase: "done" }, false)
    get().clear(convId)
  },

  restorePending: async (convId) => {
    if (get().byConv[convId]) return
    const run = await loadPendingFusion(convId)
    if (run && run.phase === "deciding") {
      set((s) =>
        s.byConv[convId] ? {} : { byConv: { ...s.byConv, [convId]: run } },
      )
    }
  },

  discard: (convId) => {
    get().clear(convId)
    void clearPendingFusion(convId)
  },
  }
})
