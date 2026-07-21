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
      "Frota",
      `${title} — ${errored ? "turno falhou" : "turno concluído"}`,
    )
  }
}

/** Chamado UMA vez quando um GATE humano abre (a missão pausou aguardando as
 *  suas decisões). Empilha no feed e dispara a nativa SEMPRE — diferente do
 *  notifyTurnEnd, o gate segura a missão inteira, então avisa em qualquer
 *  modo (Escritório/Trabalho) e com o app em background. Sem spam: o store só
 *  chama no momento em que o gate abre (1 por gate). */
export function notifyGate(
  convId: string,
  projectName: string,
  phaseLabel: string,
) {
  const chat = useChat.getState()
  const c = chat.byId[convId]
  const meta = c
    ? (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
        (cv) => cv.id === convId,
      )
    : undefined
  const title = meta?.title ?? "Missão"

  useNotifs.getState().push({
    kind: "gate",
    title,
    subtitle: `Decisão pendente · ${phaseLabel}${projectName ? ` · ${projectName}` : ""}`,
    projectId: c?.projectId ?? "",
    convId,
  })

  void nativeNotify(
    "Frota — decisão pendente",
    `${title} — a fase ${phaseLabel} deixou perguntas; a missão está pausada esperando você.`,
  )
}

/** Chamado UMA vez por episódio quando um turno RUNNING fica MUDO (sem nenhum
 *  item novo) além do limiar (settings.stalledAfterMin). Dispara a nativa
 *  SEMPRE — turno travado é exatamente o caso "ninguém está olhando" (app em
 *  background/tray). O toast acionável in-app fica com o watchdog (chamador);
 *  aqui é só o aviso de SO. Sem spam: o watchdog só chama 1x por episódio. */
export function notifyTurnStalled(
  convId: string,
  agent: string,
  minutes: number,
) {
  const chat = useChat.getState()
  const c = chat.byId[convId]
  const meta = c
    ? (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
        (cv) => cv.id === convId,
      )
    : undefined
  const title = meta?.title ?? "Conversa"
  void nativeNotify(
    "Frota — turno mudo",
    `${title} — ${agentLabel(agent)} está há ${minutes} min sem produzir nada novo. O turno pode ter travado.`,
  )
}
