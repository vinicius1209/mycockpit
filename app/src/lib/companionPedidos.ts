// Os pedidos da fila de interações como cartões de atenção do celular. Saiu
// de `lib/companion.ts` pela catraca de tamanho (ADR-261), quando o pedido de
// RECURSO (navegador, computador) entrou na fila.

import { projectForCwd, sessionPlace } from "@/lib/externalSessions"
import type { ApprovalData, InteractionRequest, QuestionData, RecursoData } from "@/lib/interaction"
import { nomeDoProjeto, textoDoPedido } from "@/lib/pedidosDeRecurso"
import type { CompanionAttention, CompanionQuestion } from "@/lib/companionTypes"
import { ownerByRunId } from "@/store/interactions"

type Chat = Parameters<typeof ownerByRunId>[1] & { byId: Record<string, { runId: string | null; agent?: string }> }
type Missions = Parameters<typeof ownerByRunId>[2] & {
  byConv: Record<string, { phases: readonly { def: { agent: string; label: string } }[] }>
}

export function atencaoDaFila(
  queue: InteractionRequest[],
  ctx: {
    chat: Chat
    missions: Missions
    projects: { id: string; name: string; path: string }[]
    projectOf: (convId: string) => string | null
    nameOf: (pid: string | null) => string | null
  },
): CompanionAttention[] {
  const { chat, missions, projectOf, nameOf } = ctx
  const app = { projects: ctx.projects }
  const attention: CompanionAttention[] = []
  for (const req of queue) {
    // `ownerByRunId` (qualquer kind), não `convIdForInteraction` (approval-only):
    // o alvo é resolvido UMA vez e usado nos DOIS ramos, então a régua restrita
    // deixava toda PERGUNTA chegar no celular sem conversa, sem projeto e sem
    // agent — justo o que você precisa pra decidir se vale voltar pro computador.
    const target = ownerByRunId(req, chat, missions)
    const convId = target?.convId ?? null
    const pid = convId ? projectOf(convId) : null
    // Pedido de RECURSO (ADR-261) é uma autorização: no celular, o mesmo cartão
    // de aprovação, com o que foi pedido no lugar do comando.
    if (req.kind === "recurso") {
      const d = req.data as RecursoData
      const texto = textoDoPedido(d, nomeDoProjeto(d.projectPath))
      attention.push({
        id: req.id,
        kind: "approval",
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        agent: convId ? (chat.byId[convId]?.agent ?? "") : "",
        phase: null,
        phaseLabel: null,
        command: texto.resumo,
        toolName: texto.oQue,
      })
      continue
    }
    if (req.kind === "approval") {
      const d = req.data as Partial<ApprovalData> | null | undefined
      const phase =
        target?.kind === "mission" && target.phase != null ? target.phase : null
      const phaseRun =
        convId && phase != null
          ? missions.byConv[convId]?.phases[phase]
          : undefined
      // Permissão de HOOK (H2): sessão EXTERNA do terminal — sem conversa
      // dona por desenho. O celular ainda precisa saber DE ONDE veio: motor
      // e projeto/pasta saem da origem do hook (nunca inventa conversa).
      const hook = d?.hook
      const hookPlace = hook
        ? sessionPlace({ cwd: hook.cwd ?? "" }, app.projects)
        : null
      attention.push({
        id: req.id,
        kind: "approval",
        convId,
        projectId:
          pid ??
          (hook
            ? (projectForCwd(hook.cwd ?? "", app.projects)?.id ?? null)
            : null),
        projectName:
          nameOf(pid) ?? (hookPlace ? `${hookPlace} (terminal)` : null),
        agent:
          phaseRun?.def.agent ??
          (convId
            ? (chat.byId[convId]?.agent ?? "")
            : (hook?.engine ?? "")),
        phase,
        phaseLabel: phaseRun?.def.label ?? null,
        command: typeof d?.command === "string" ? d.command : "",
        toolName: typeof d?.tool_name === "string" ? d.tool_name : "",
      })
    } else {
      const d = req.data as Partial<QuestionData> | null | undefined
      const rawQs = d?.questions ?? []
      // C2 — opções estruturadas viajam quando existem: a ESCOLHA vira
      // botões no celular e a resposta entra pelo mesmo answer_interaction.
      const choices: CompanionQuestion[] = rawQs.map((q) => ({
        header: typeof q.header === "string" ? q.header : "",
        question: typeof q.question === "string" ? q.question : "",
        multiSelect: !!q.multiSelect,
        options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
          label: typeof o.label === "string" ? o.label : "",
          description: typeof o.description === "string" ? o.description : "",
        })),
      }))
      attention.push({
        id: req.id,
        kind: "question",
        convId,
        projectId: pid,
        projectName: nameOf(pid),
        agent: convId ? (chat.byId[convId]?.agent ?? "") : "",
        phase: null,
        phaseLabel: null,
        questions: rawQs.map((q) => q.question),
        ...(choices.some((q) => q.options.length > 0) ? { choices } : {}),
      })
    }
  }
  return attention
}
