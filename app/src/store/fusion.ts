// v0.3 Fusion, store IRMÃO do useChat (não estende ConvState). Um Fusion por
// conversa. A lane de cada candidato reusa SÓ o reducer de conteúdo (reduceItems);
// o `status` da lane é fonte ÚNICA (não derivada do controle do Linear).

import { create } from "zustand"
import { runAgent, cancelAgent, type AgentEvent, type CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { buildDoctrineBlock, readDoctrine } from "@/lib/doctrine"
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
import { expandDraftForAgent } from "@/lib/slashCommands"

export type CandStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled"
  | "killed"

/** Candidato ainda em voo (na fila ou rodando). */
export function isRunning(s: CandStatus): boolean {
  return s === "running" || s === "queued"
}
/** Candidato que terminou mal (erro / cancelado / morto por orçamento). */
export function isFailed(s: CandStatus): boolean {
  return s === "error" || s === "cancelled" || s === "killed"
}

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

/** Liga default do botão "Disputar": o agent EFETIVO + o complementar
 *  DERIVADO do registry (G1.3 do capability-registry-plan): o primeiro OUTRO
 *  motor disponível com capacidade de disputa (`disputes`) — nunca um par fixo
 *  de fornecedores. Com os dois disputantes de hoje instalados o resultado é o
 *  de sempre (claude↔codex); um motor novo com a capability entra sozinho.
 *  Read-only, juiz sonnet. Política de orquestração, fica ao lado de `launch`
 *  p/ todo caller herdar a mesma default. */
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
    // sem dupla contagem). REPLACE por runId colapsa parciais no total final.
    if (e.type === "result" && e.cost_usd != null) {
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
        status: isFailed(c.status) ? c.status : "done",
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
    // UMA disputa por vez: relançar por cima de uma "deciding" criava zumbi
    // (pending=1 órfão no DB que o restorePending ressuscitava do nada). Em
    // voo → ignora o pedido; esperando decisão → descarta a antiga (marca
    // resolvida no disco) antes de abrir a nova.
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
      const block = buildDoctrineBlock((await readDoctrine(projectPath)).content)
      if (block) doctrinePrefix = `${block}\n\n`
    }
    // G2.1 — `/comando` no campo da disputa expande POR CANDIDATO: cada lane
    // pode rodar num motor diferente, e o inventário/semântica de expansão é
    // do agent EFETIVO da lane (registry decide quem tem native_slash). Com
    // preâmbulo/doutrina o pedido vai EMBUTIDO no prompt — aí nem o comando
    // nativo pode viajar cru. Fail-open: sem match, o texto segue.
    const embedded = preamblePrefix !== "" || doctrinePrefix !== ""
    const promptFor = async (agent: string): Promise<string> => {
      const sendText = await expandDraftForAgent(prompt, projectPath, agent, {
        embedded,
      })
      return `${doctrinePrefix}${preamblePrefix}${sendText}`
    }
    const perm = cfg.scope === "read-only" ? "fusion-ro" : permission

    await runWithConcurrency(run.candidates, 3, async (c) => {
      set((s) => {
        const f = s.byConv[convId]
        if (!f) return {}
        return {
          byConv: {
            ...s.byConv,
            [convId]: patchCand(f, c.id, (x) => ({
              ...x,
              status: "running" as CandStatus,
              startedAt: Date.now(),
            })),
          },
        }
      })
      try {
        await runAgent(
          c.runId,
          convId,
          c.agent,
          c.reqModel,
          c.effort,
          await promptFor(c.agent),
          c.cwd,
          null, // resume=null: candidato é sessão fresca
          perm,
          attachments,
          (e) => get().handleCandidateEvent(convId, c.id, e),
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

  // Stop de verdade no Fusion (achado 3 do aval): cancela cada candidato em voo
  // via cancel_agent, zera o spinner da conversa e descarta o board. O juiz
  // one-shot não é cancelável; o guard do launch impede que ele sequer comece.
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
    // custo ÚNICO da disputa: candidatos + juiz (antes eram dois totais parciais,
    // liveCostOf só lanes e costTotal só juiz, e nenhum era o gasto real).
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
      // disputa concluída → some o spinner/Stop da conversa (agora espera SUA decisão,
      // não um processo). beginFusion marcou running=true; aqui zera.
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
