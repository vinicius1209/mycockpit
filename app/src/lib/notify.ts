import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { useChat } from "@/store/chat"
import { useApp } from "@/store/app"
import { useNotifs } from "@/store/notifications"
import { agentLabel } from "@/lib/agent"
import { isTauri } from "@/lib/db"

/** Notificação NATIVA do SO (silenciosa se sem permissão/fora do app). */
export async function nativeNotify(title: string, body: string) {
  if (!isTauri()) return
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === "granted"
    if (granted) sendNotification({ title, body })
  } catch {
    // sem notificação nativa não é erro fatal — o feed in-app continua.
  }
}

/** Chamado no fim de UM turno (finally do run). Empilha no feed e, se a conversa
 *  não é a ativa (rodou em background), dispara a notificação nativa. */
export function notifyTurnEnd(convId: string, agent: string) {
  const chat = useChat.getState()
  const c = chat.byId[convId]
  if (!c) return
  const last = c.items[c.items.length - 1]
  if (last?.kind === "cancelled") return // cancelamento do usuário não notifica

  // usa o array do projeto DONO (c.projectId) — o turno pode ter rodado em
  // background num projeto não-ativo, que não está no espelho `conversations`.
  const meta = (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
    (cv) => cv.id === convId,
  )
  const title = meta?.title ?? "Conversa"
  const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
  const errored = last?.kind === "error" || last?.kind === "limit"

  useNotifs.getState().push({
    kind: errored ? "run_error" : "run_done",
    title,
    subtitle: `${agentLabel(agent)}${proj ? ` · ${proj.name}` : ""}`,
    projectId: c.projectId,
    convId,
  })

  // só incomoda com a nativa quando você NÃO estava olhando essa conversa.
  if (chat.activeId !== convId) {
    void nativeNotify(
      "MyCockpit",
      `${title} — ${errored ? "turno falhou" : "turno concluído"}`,
    )
  }
}
