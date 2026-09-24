import { toast } from "sonner"
import type { AgentEvent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { markLessonsUsed } from "@/lib/learning"
import type { McpPreflightGate } from "@/lib/tooling"
import { useComposerDrafts } from "@/store/composerDrafts"
import { useChat } from "@/store/chat"
import { maybeNotifyDeferredEvent } from "@/lib/notify/deferredWork"

export function createRunAcceptance({
  convId,
  onAccept,
  onEvent,
  onBlocked,
}: {
  convId?: string
  onAccept: () => void
  onEvent: (event: AgentEvent) => void
  onBlocked: (gate: McpPreflightGate) => void
}) {
  let accepted = false
  const buffered: AgentEvent[] = []

  function dispatch(event: AgentEvent) {
    onEvent(event)
    if (convId) {
      maybeNotifyDeferredEvent(convId, event)
    }
  }

  return {
    handler(event: AgentEvent) {
      if (event.type === "preflight_blocked") {
        onBlocked(event.gate)
        return
      }
      if (event.type === "run_manifest") {
        if (!accepted) {
          accepted = true
          onAccept()
        }
        dispatch(event)
        for (const pending of buffered) dispatch(pending)
        buffered.length = 0
        return
      }
      if (accepted) dispatch(event)
      else buffered.push(event)
    },
    accepted: () => accepted,
  }
}

/** Registra falhas posteriores ao aceite sem duplicar o último evento. */
export function recordDispatchError(
  convId: string,
  error: unknown,
  fallback: string,
) {
  const message = typeof error === "string" ? error : fallback
  const conversation = useChat.getState().byId[convId]
  const last = conversation?.items[conversation.items.length - 1]
  if (!last || last.kind !== "error" || last.message !== message) {
    useChat.getState().handleEvent(convId, { type: "error", message })
  }
  toast.error(message)
}

export function acceptChatTurn({
  convId,
  runId,
  agent,
  model,
  effort,
  text,
  attachments,
  wheelSwitch,
  agentChangeNotice,
  modelChangeNotice,
  effortChangeNotice,
  broughtAdvice,
  lessonIds,
  recordLessons,
  doctrineFingerprint,
  personaStamp,
  onAccepted,
}: {
  convId: string
  runId: string
  agent: string
  model: string | null
  effort: string | null
  text: string
  attachments: Attachment[]
  wheelSwitch: boolean
  agentChangeNotice?: string | null
  modelChangeNotice?: string | null
  effortChangeNotice?: string | null
  broughtAdvice?: string | null
  lessonIds: string[]
  recordLessons: (ids: string[]) => void
  doctrineFingerprint?: string | null
  personaStamp?: {
    presetId: string
    digest: string
    name: string
  } | null
  onAccepted?: () => void
}) {
  const chat = useChat.getState()
  // O disparo da retomada automática marca `disparou` e envia na sequência
  // (`lib/autoResumeDisparo`); envio seu cancela a retomada antes de chegar
  // aqui. Então `disparou` agora = este pedido é texto do app (ADR-250).
  const retomada = !!chat.byId[convId]?.autoResume?.disparou
  if (wheelSwitch) {
    chat.beginTransplant(convId, runId, agent, {
      model,
      effort,
      commitNotice: agentChangeNotice,
      user: { text, attachments },
    })
  } else {
    chat.start(convId, text, runId, agent, model, effort, attachments)
  }
  if (retomada) marcarRetomada(convId)
  if (modelChangeNotice) {
    chat.handleEvent(convId, { type: "notice", message: modelChangeNotice })
  }
  if (effortChangeNotice) {
    chat.handleEvent(convId, { type: "notice", message: effortChangeNotice })
  }
  if (broughtAdvice) useComposerDrafts.getState().tirarPareceres(convId)
  recordLessons(lessonIds)
  if (lessonIds.length > 0) void markLessonsUsed(lessonIds)
  if (doctrineFingerprint) {
    chat.recordInjectedFingerprint(convId, "doctrine", doctrineFingerprint)
  }
  if (personaStamp) {
    void chat
      .stampPreset(
        convId,
        personaStamp.presetId,
        personaStamp.digest,
        personaStamp.name,
      )
      .catch(() => toast.error("Não consegui registrar a persona deste turno."))
  }
  onAccepted?.()
}

/** Marca o pedido que acabou de nascer como retomada do app. Fora do store
 *  porque é um dado a mais no item, não uma transição: o persist do fim do
 *  turno grava o item já marcado. */
function marcarRetomada(convId: string) {
  useChat.setState((s) => {
    const conv = s.byId[convId]
    const i = conv ? conv.items.findLastIndex((it) => it.kind === "user") : -1
    const item = conv?.items[i]
    if (!conv || !item || item.kind !== "user") return {}
    const items = conv.items.slice()
    items[i] = { ...item, retomada: true }
    return { byId: { ...s.byId, [convId]: { ...conv, items } } }
  })
}
