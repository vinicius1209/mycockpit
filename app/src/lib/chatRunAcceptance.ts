import { toast } from "sonner"
import type { AgentEvent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { markLessonsUsed } from "@/lib/learning"
import type { McpPreflightGate } from "@/lib/tooling"
import { useChat } from "@/store/chat"

export function createRunAcceptance({
  onAccept,
  onEvent,
  onBlocked,
}: {
  onAccept: () => void
  onEvent: (event: AgentEvent) => void
  onBlocked: (gate: McpPreflightGate) => void
}) {
  let accepted = false
  const buffered: AgentEvent[] = []
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
        onEvent(event)
        for (const pending of buffered) onEvent(pending)
        buffered.length = 0
        return
      }
      if (accepted) onEvent(event)
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
  modelChangeNotice,
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
  modelChangeNotice?: string | null
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
  if (wheelSwitch) {
    chat.beginTransplant(convId, runId, agent, {
      model,
      effort,
      user: { text, attachments },
    })
  } else {
    chat.start(convId, text, runId, agent, model, effort, attachments)
  }
  if (modelChangeNotice) {
    chat.handleEvent(convId, { type: "notice", message: modelChangeNotice })
  }
  if (broughtAdvice) chat.takePendingAdvice(convId)
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
