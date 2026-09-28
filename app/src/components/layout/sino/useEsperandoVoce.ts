// Os stores vivos → a derivação pura de `lib/sino/esperando` (ADR-271).

import { useMemo } from "react"
import type {
  ApprovalData,
  InteractionRequest,
  PlanData,
  QuestionData,
  RecursoData,
} from "@/lib/interaction"
import { summarizeApproval } from "@/lib/approvalSummary"
import { engineLabel, projectForCwd, sessionPlace } from "@/lib/externalSessions"
import { textoDoPedido } from "@/lib/pedidosDeRecurso"
import {
  esperandoVoce,
  type EsperandoVoce,
  type FerramentaBloqueada,
  type MissaoParada,
  type PedidoVivo,
  type TipoDePedido,
} from "@/lib/sino/esperando"
import { conversationTitle } from "@/lib/traySnapshot"
import type { Project } from "@/lib/types"
import type { MissionRun } from "@/lib/missionTypes"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFilaDeDecisoes } from "@/store/filaDeDecisoes"
import {
  ownerByRunId,
  questionHeadline,
  useAwaiting,
  useInteractions,
} from "@/store/interactions"
import { useMission } from "@/store/mission"
import { useNotifs, type Notification } from "@/store/notifications"

const TIPO: Record<InteractionRequest["kind"], TipoDePedido> = {
  approval: "permissao",
  question: "pergunta",
  plan: "plano",
  recurso: "recurso",
}

type Chat = ReturnType<typeof useChat.getState>

function tituloDe(chat: Chat, convId: string, projectId: string): string {
  return conversationTitle(chat.conversationsByProject, convId, projectId)?.trim() || "Conversa"
}

function resumoDe(req: InteractionRequest, projectName: string): string {
  if (req.kind === "question") return questionHeadline(req.data as QuestionData | undefined)
  if (req.kind === "recurso") return textoDoPedido(req.data as RecursoData, projectName || null).resumo
  if (req.kind === "plan") {
    const primeira = ((req.data as PlanData | null)?.text ?? "").split("\n").find((l) => l.trim())?.trim()
    return primeira ? (primeira.length > 60 ? `${primeira.slice(0, 60)}…` : primeira) : "o plano proposto"
  }
  return summarizeApproval((req.data ?? {}) as ApprovalData).headline
}

function pedidoVivo(
  req: InteractionRequest,
  chat: Chat,
  missions: ReturnType<typeof useMission.getState>,
  projects: Project[],
): PedidoVivo {
  const alvo = ownerByRunId(req, chat, missions)
  if (alvo) {
    const projectId = chat.byId[alvo.convId]?.projectId ?? ""
    const projectName = projects.find((p) => p.id === projectId)?.name ?? ""
    return {
      id: req.id,
      tipo: TIPO[req.kind],
      convId: alvo.convId,
      projectId,
      convTitle: tituloDe(chat, alvo.convId, projectId),
      projectName,
      resumo: resumoDe(req, projectName),
    }
  }
  // Sessão externa no terminal: sem conversa por desenho, o cartão fica no
  // canto e a linha só diz de onde veio.
  const hook = (req.data as Partial<ApprovalData> | null | undefined)?.hook
  const cwd = hook?.cwd ?? ""
  return {
    id: req.id,
    tipo: TIPO[req.kind],
    convId: null,
    projectId: projectForCwd(cwd, projects)?.id ?? "",
    convTitle: hook ? `${engineLabel(hook.engine)} no terminal` : "Pedido sem conversa aberta",
    projectName: hook ? sessionPlace({ cwd }, projects) : "",
    resumo: resumoDe(req, ""),
  }
}

function missoesParadas(
  byConv: Record<string, MissionRun>,
  chat: Chat,
  projects: Project[],
): MissaoParada[] {
  const out: MissaoParada[] = []
  for (const [convId, run] of Object.entries(byConv)) {
    if (run.status !== "running") continue
    const idx = run.gate?.phase ?? run.recovery?.phase
    if (idx == null) continue
    const projectId = chat.byId[convId]?.projectId ?? ""
    out.push({
      convId,
      projectId,
      convTitle: tituloDe(chat, convId, projectId),
      projectName: projects.find((p) => p.id === projectId)?.name ?? "",
      motivo: run.gate ? "gate" : "recuperacao",
      fase: run.phases[idx]?.def.label ?? String(idx + 1),
    })
  }
  return out
}

/** String estável das missões paradas: só muda quando um gate abre ou fecha. */
function chaveDasParadas(byConv: Record<string, MissionRun>): string {
  return Object.entries(byConv)
    .filter(([, r]) => r.status === "running" && (r.gate || r.recovery))
    .map(([id, r]) => `${id}:${r.gate?.phase ?? ""}:${r.recovery?.phase ?? ""}`)
    .sort()
    .join(",")
}

/** Desde quando a conversa espera: o aviso que o feed guardou quando o pedido
 *  chegou (só o primeiro de cada conversa é avisado, então o mais recente é o
 *  começo da espera atual). Plano não gera aviso, e fica sem idade. */
function desdeNoFeed(feed: readonly Notification[]) {
  return (convId: string, motivo: "pedido" | "missao"): number | null => {
    let ts: number | null = null
    for (const n of feed) {
      if (n.convId !== convId) continue
      const conta = motivo === "missao" ? n.kind === "gate" : n.kind === "approval" || n.kind === "question"
      if (conta && (ts == null || n.ts > ts)) ts = n.ts
    }
    return ts
  }
}

export function useEsperandoVoce(bloqueadas: readonly FerramentaBloqueada[]): EsperandoVoce {
  const queue = useInteractions((s) => s.queue)
  // Muda quando um pedido troca de dono, nunca a cada token do chat.
  const donos = useAwaiting()
  const titulos = useChat((s) => s.conversationsByProject)
  const paradas = useMission((s) => chaveDasParadas(s.byConv))
  const projects = useApp((s) => s.projects)
  const decisoes = useFilaDeDecisoes()
  const feed = useNotifs((s) => s.items)
  const chaveBloqueadas = bloqueadas.map((f) => `${f.agent}|${f.label}`).join(",")

  return useMemo(() => {
    const chat = useChat.getState()
    const missions = useMission.getState()
    const ferramentas = chaveBloqueadas
      ? chaveBloqueadas.split(",").map((par) => {
          const [agent, label] = par.split("|")
          return { agent, label }
        })
      : []
    return esperandoVoce({
      pedidos: queue.map((req) => pedidoVivo(req, chat, missions, projects)),
      missoes: missoesParadas(missions.byConv, chat, projects),
      decisoes,
      ferramentas,
      desdeDe: desdeNoFeed(feed),
    })
    // `donos`, `titulos` e `paradas` são as chaves de quando reler o getState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, donos, titulos, paradas, projects, decisoes, feed, chaveBloqueadas])
}
