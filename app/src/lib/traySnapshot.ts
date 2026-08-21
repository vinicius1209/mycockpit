// Monta e ENVIA o snapshot da tray.
//
// Extraído do App.tsx (acima do teto da catraca), e o recorte é fechado: tudo
// aqui lê `getState()` das stores — não depende de props, de hooks nem da
// árvore de render. O App fica com o EFEITO (as dependências e o relógio de um
// minuto); o "o que a bandeja mostra" mora aqui.

import { agentLabel } from "@/lib/agent"
import { ultimoTurno } from "@/lib/lastTurn"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
import { trayExternalSessions } from "@/lib/traySessions"
import { updateTray, type TrayActivity } from "@/lib/tray"
import { useApp } from "@/store/app"
import { pendingDeferred, useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { currentOriginAnyKind, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { useNotifs } from "@/store/notifications"
import { useSchedules } from "@/store/schedules"

/** Lê as stores e empurra pra bandeja. O `updateTray` dedupa por conteúdo, então
 *  chamar de mais não custa invoke. */
export function enviarSnapshotDaTray(
  decisionsPending: number,
  pendingInteractions: number,
) {
  const app = useApp.getState()
  const chat = useChat.getState()
  const missions = useMission.getState()
  const fusions = useFusion.getState()
  const scheduleState = useSchedules.getState()
  const projectName = new Map(app.projects.map((p) => [p.id, p.name]))
  const titleOf = (convId: string, projectId: string) =>
    chat.conversationsByProject[projectId]?.find((c) => c.id === convId)
      ?.title ?? "Conversa"
  const activities = new Map<string, TrayActivity>()
  const linearDetail = (convId: string): string => {
    const c = chat.byId[convId]
    const last = c?.items[c.items.length - 1]
    if (last?.kind === "tool") {
      const known: Record<string, string> = {
        Bash: "Executando comando…",
        Read: "Lendo arquivo…",
        Edit: "Editando arquivos…",
        Write: "Escrevendo arquivo…",
        Glob: "Mapeando o projeto…",
        Grep: "Buscando no projeto…",
        WebSearch: "Pesquisando na web…",
      }
      return known[last.name] ?? `Usando ${last.name}…`
    }
    if (c?.streamingTextId || last?.kind === "text") return "Redigindo resposta…"
    return "Analisando a tarefa…"
  }
  const push = (
    convId: string,
    kind: TrayActivity["kind"],
    title?: string | null,
    startedAt?: number | null,
    agent = "",
    model: string | null = null,
    detail = "Em operação…",
  ) => {
    // Conversa deletada com missão/disputa ainda viva: NÃO some do
    // snapshot — sumir subcontaria `running` e o "Sair" mataria o trabalho
    // sem confirmação. Sem projectId a navegação vira no-op, mas a
    // atividade continua visível, contada e parável.
    const projectId = chat.byId[convId]?.projectId ?? ""
    activities.set(convId, {
      convId,
      projectId,
      title: title || titleOf(convId, projectId),
      projectName: projectName.get(projectId) ?? "Projeto",
      kind,
      startedAt: startedAt ?? null,
      agent,
      model,
      detail,
    })
  }
  for (const [id, c] of Object.entries(chat.byId))
    if (c.running)
      push(
        id,
        "turno",
        null,
        c.startedAt,
        agentLabel(c.agent),
        c.model ?? c.reqModel,
        linearDetail(id),
      )
  for (const [id, m] of Object.entries(missions.byConv)) {
    if (m.status !== "running") continue
    const phase = m.phases[m.current]
    push(
      id,
      "missão",
      m.task,
      phase?.startedAt ?? m.startedAt,
      phase ? agentLabel(phase.def.agent) : "Mission",
      phase?.def.model ?? null,
      phase ? `${phase.def.label}…` : "Preparando próxima etapa…",
    )
  }
  for (const [id, f] of Object.entries(fusions.byConv)) {
    if (!["running", "judging", "promoting"].includes(f.phase)) continue
    const live = f.candidates.filter((c) =>
      ["queued", "running", "finalizing"].includes(c.status),
    )
    const detail =
      f.phase === "judging"
        ? "Juiz avaliando os candidatos…"
        : f.phase === "promoting"
          ? "Promovendo a resposta escolhida…"
          : `${live.length} ${live.length === 1 ? "agent trabalhando" : "agents trabalhando"}…`
    push(
      id,
      "disputa",
      f.prompt,
      Math.min(...live.map((c) => c.startedAt ?? f.createdAt), f.createdAt),
      live.length === 1 ? agentLabel(live[0].agent) : `${live.length} agents`,
      live.length === 1 ? (live[0].model ?? live[0].reqModel) : null,
      detail,
    )
  }

  const decision = Object.entries(fusions.byConv).find(
    ([, f]) => f.phase === "deciding",
  )
  // Interação pendente (permissão/pergunta) TAMBÉM é decisão esperando você.
  // Sem isto a tray ficava cega justo no caso em que o app está em
  // background — e a notificação nativa não pode ser o único sinal: ela
  // depende de autorização do SO que builds ad-hoc não conseguem (ver
  // nativeNotify em lib/notify.ts). A tray sempre funciona.
  const pending = useInteractions.getState().queue
  const decisionConvId =
    decision?.[0] ??
    (pending.length > 0
      ? (currentOriginAnyKind(pending[0])?.convId ?? null)
      : null)
  const decisionProjectId = decisionConvId
    ? (chat.byId[decisionConvId]?.projectId ?? null)
    : null
  const next = nextScheduled(scheduleState.schedules)
  const last = [...scheduleState.schedules]
    .filter((s) => s.lastRunAt != null)
    .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))[0]

  // Trabalho diferido do provider vivo em QUALQUER conversa carregada:
  // conta pro aviso honesto do quit (D1.4). Derivado de items.
  const deferredCount = Object.values(chat.byId).reduce(
    (acc, c) => acc + pendingDeferred(c.items).length,
    0,
  )

  const external = trayExternalSessions(app.projects)

  updateTray({
    running: activities.size,
    decisions: decisionsPending + pendingInteractions,
    blocking: pendingInteractions,
    deferred: deferredCount,
    external,
    activities: [...activities.values()].slice(0, 3),
    decisionConvId,
    decisionProjectId,
    nextSchedule:
      next?.nextRun != null
        ? {
            name: next.name,
            at: next.nextRun,
            relative: fmtUntilShort(next.nextRun - Date.now()),
          }
        : null,
    lastRun:
      last?.lastRunAt != null && last.lastRunStatus
        ? {
            name: last.name,
            status: last.lastRunStatus,
            at: last.lastRunAt,
          }
        : null,
    // O último turno de CONVERSA vem do FEED do sino, que já guarda o
    // recibo como `body` — sem evento novo nem tabela. Não confundir com
    // `lastRun` acima, que é a última AUTOMAÇÃO.
    lastTurn: ultimoTurno(useNotifs.getState().items),
    enabledSchedules: scheduleState.schedules.filter((s) => s.enabled)
      .length,
  })
}
