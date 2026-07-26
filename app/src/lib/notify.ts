import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { useChat } from "@/store/chat"
import { useApp } from "@/store/app"
import { useNotifs } from "@/store/notifications"
import { agentLabel } from "@/lib/agent"
import { isTauri } from "@/lib/db"

/** Truncamento defensivo de título em notificação nativa (follow-up S2): o
 *  Notification Center corta sem avisar; melhor cortar NÓS com reticências
 *  do que deixar o SO engolir o resto do corpo. */
function clipTitle(title: string, max = 80): string {
  const t = title.trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** Já avisamos que a notificação do SO não está disponível? (1× por sessão — o
 *  aviso é informação, não alarme recorrente.) */
let nativeBlockedWarned = false

/** Notificação NATIVA do SO. Nunca derruba nada: sem autorização, o feed do sino
 *  e a tray continuam sendo o sinal.
 *
 *  ⚠️ Isto FALHA em builds ad-hoc: o macOS só registra um app no Notification
 *  Center quando ele consegue pedir autorização, e app não assinado com
 *  identidade real costuma ser recusado direto — verificado nesta máquina, o
 *  `dev.vinicius.mycockpit` não aparece em `com.apple.ncprefs` nem no db do
 *  usernoted, ou seja NENHUMA nativa foi entregue até hoje. O `catch` vazio
 *  fazia isso parecer "a feature não existe"; agora avisa uma vez e segue. */
export async function nativeNotify(title: string, body: string) {
  if (!isTauri()) return
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === "granted"
    if (granted) {
      sendNotification({ title, body })
      return
    }
    await fallbackNotify(title, body, "sem autorização do sistema")
  } catch (e) {
    await fallbackNotify(
      title,
      body,
      e instanceof Error ? e.message : String(e),
    )
  }
}

/** Plano B: `osascript`, que usa a autorização do Script Editor (concedida) em
 *  vez da nossa (que o macOS recusa por causa da assinatura ad-hoc — ver
 *  src-tauri/src/osnotify.rs). A notificação sai atribuída ao Script Editor, não
 *  ao Frota: feio, mas CHEGA. O texto vai como argv, nunca interpolado no
 *  AppleScript (seria injeção — título de conversa é entrada não confiável).
 *
 *  Só quando os DOIS caminhos falham é que avisamos que não há aviso — senão o
 *  toast apareceria em todo turno concluído. */
async function fallbackNotify(title: string, body: string, why: string) {
  try {
    await invoke("notify_via_osascript", { title, body })
    if (!nativeBlockedWarned) {
      nativeBlockedWarned = true
      console.warn(
        `[notify] plugin nativo indisponível (${why}); usando osascript (a notificação aparece como "Script Editor")`,
      )
    }
  } catch (e) {
    warnNativeBlocked(`${why}; osascript também falhou: ${String(e)}`)
  }
}

/** Deixa rastro da indisponibilidade UMA vez: console (pro log) + toast (pra
 *  você). Sem isto o sintoma é "o app não me avisa" e a causa fica invisível. */
function warnNativeBlocked(reason: string) {
  if (nativeBlockedWarned) return
  nativeBlockedWarned = true
  console.warn(`[notify] nenhuma notificação de SO disponível: ${reason}`)
  toast("Avisos do sistema indisponíveis — use o sino e o ícone da bandeja.", {
    description:
      "Nem o plugin nativo nem o osascript entregaram. O feed no app continua funcionando.",
    duration: 8000,
  })
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
      `${clipTitle(title)} · ${errored ? "turno falhou" : "turno concluído"}`,
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
    "Frota · decisão pendente",
    `${clipTitle(title)}: a fase ${phaseLabel} deixou perguntas; a missão está pausada esperando você.`,
  )
}

/** Chamado quando chega um pedido de PERMISSÃO. O approval é o único evento que
 *  deixa o turno literalmente parado esperando você — antes ele era o único que
 *  NÃO avisava (gate, turno mudo e card parado avisavam). Empilha no feed
 *  sempre; a nativa só quando você não está com o card na frente (`seen`),
 *  porque com ele visível a notificação seria só barulho.
 *
 *  Sem spam: o chamador (store/interactions) só chama no PRIMEIRO pedido
 *  pendente de cada conversa — uma rajada de 20 idênticos avisa uma vez. */
export function notifyApproval(o: {
  projectId: string
  convId: string
  projectName: string
  convTitle: string
  toolName: string
  /** Resumo de uma linha (summarizeApproval().headline). */
  headline: string
  /** true = o card está visível na tela agora ⇒ não dispara a nativa. */
  seen: boolean
}) {
  useNotifs.getState().push({
    kind: "approval",
    title: o.convTitle,
    subtitle: `Permissão pendente · ${o.headline}${o.projectName ? ` · ${o.projectName}` : ""}`,
    projectId: o.projectId,
    convId: o.convId,
  })

  if (o.seen) return
  void nativeNotify(
    "Frota · permissão pendente",
    `${clipTitle(o.convTitle)} (${o.projectName}): o turno parou pedindo ${o.toolName} — ${o.headline}`,
  )
}

/** Chamado quando chega uma PERGUNTA (`ask_user`). Irmão do notifyApproval: o
 *  turno também fica literalmente parado, mas esperando CONTEÚDO em vez de
 *  autorização — então a cópia é outra ("perguntou", não "pediu permissão").
 *
 *  Este era o último evento bloqueante que NÃO avisava: o `announceArrival` do
 *  store/interactions filtrava só `approval`, então uma pergunta ficava esperando
 *  em silêncio até você olhar a tela por acaso.
 *
 *  Mesmo contrato do approval: feed SEMPRE; nativa só quando você não está com o
 *  card na frente (`seen`). Sem spam — o chamador só chama no PRIMEIRO pendente
 *  de cada conversa. */
export function notifyQuestion(o: {
  projectId: string
  convId: string
  projectName: string
  convTitle: string
  /** Resumo de uma linha: o `header` da 1ª pergunta (ou "uma decisão"). */
  headline: string
  /** Quantas perguntas vieram no pedido (>1 aparece no feed). */
  count: number
  /** true = o card está visível na tela agora ⇒ não dispara a nativa. */
  seen: boolean
}) {
  const extra = o.count > 1 ? ` (+${o.count - 1})` : ""
  useNotifs.getState().push({
    kind: "question",
    title: o.convTitle,
    subtitle: `Pergunta pendente · ${o.headline}${extra}${o.projectName ? ` · ${o.projectName}` : ""}`,
    projectId: o.projectId,
    convId: o.convId,
  })

  if (o.seen) return
  void nativeNotify(
    "Frota · pergunta pendente",
    `${clipTitle(o.convTitle)} (${o.projectName}): o turno parou esperando sua resposta — ${o.headline}${extra}`,
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
    "Frota · turno mudo",
    `${clipTitle(title)}: ${agentLabel(agent)} está há ${minutes} min sem produzir nada novo. O turno pode ter travado.`,
  )
}

/** Chamado UMA vez por episódio quando um CARD do board em review/blocked
 *  (esperando VOCÊ, não um agent) fica parado além do limiar
 *  (settings.stalledAfterMin, o mesmo knob dos turnos). Espelho do
 *  notifyTurnStalled: aqui é só o aviso de SO; o toast acionável fica com o
 *  watchdog. Sem spam: o vigia só chama 1x por episódio. */
export function notifyCardStalled(
  title: string,
  state: "review" | "blocked",
  minutes: number,
) {
  const situacao = state === "blocked" ? "bloqueado" : "em revisão"
  void nativeNotify(
    "Frota · card parado",
    `${clipTitle(title)} está ${situacao} há ${minutes} min, esperando você.`,
  )
}
