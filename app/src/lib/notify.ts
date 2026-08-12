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
/** Por onde a notificação saiu — o botão de teste das Configurações mostra isto.
 *  "nativo" = plugin do SO (nome/ícone do Frota); "osascript" = fallback (chega
 *  como Script Editor); "falhou" = nenhum dos dois passou. */
export type NotifyPath = "nativo" | "osascript" | "falhou" | "fora-do-app"

export async function nativeNotify(
  title: string,
  body: string,
): Promise<NotifyPath> {
  if (!isTauri()) return "fora-do-app"
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === "granted"
    if (granted) {
      sendNotification({ title, body })
      return "nativo"
    }
    return await fallbackNotify(title, body, "sem autorização do sistema")
  } catch (e) {
    return await fallbackNotify(
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
async function fallbackNotify(
  title: string,
  body: string,
  why: string,
): Promise<NotifyPath> {
  try {
    await invoke("notify_via_osascript", { title, body })
    if (!nativeBlockedWarned) {
      nativeBlockedWarned = true
      console.warn(
        `[notify] plugin nativo indisponível (${why}); usando osascript (a notificação aparece como "Script Editor")`,
      )
    }
    return "osascript"
  } catch (e) {
    warnNativeBlocked(`${why}; osascript também falhou: ${String(e)}`)
    return "falhou"
  }
}

/** Deixa rastro da indisponibilidade UMA vez: console (pro log) + toast (pra
 *  você). Sem isto o sintoma é "o app não me avisa" e a causa fica invisível. */
function warnNativeBlocked(reason: string) {
  if (nativeBlockedWarned) return
  nativeBlockedWarned = true
  console.warn(`[notify] nenhuma notificação de SO disponível: ${reason}`)
  toast("Avisos do sistema indisponíveis; use o sino e o ícone da bandeja.", {
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
 *  modo (Painel/Trabalho/Features) e com o app em background. Sem spam: o store só
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

/** Desfecho de UMA missão (MH2.3): fim ok, fim com ressalva do revisor (MH1.1),
 *  falha e teto estourado. Recovery pendente é notifyMissionRecovery (a missão
 *  NÃO terminou — está esperando você). */
export type MissionOutcome = "concluida" | "ressalva" | "falha" | "teto"

/** Dedupe por missão: UM aviso de desfecho por missionId. O launch só alcança
 *  um terminal por execução, mas a memória de módulo é a garantia explícita
 *  (padrão "1 aviso por episódio via Map de módulo" do watchdog). */
const missionEndNotified = new Set<string>()

/** (testes) zera o dedupe de desfecho de missão. */
export function _resetMissionEndNotified(): void {
  missionEndNotified.clear()
}

/** Chamado no DESFECHO de uma missão (MH2.3, canais do ADR-013): feed do sino
 *  SEMPRE + nativa SEMPRE — missão é trabalho longo que roda com o app em
 *  background; diferente do turno de chat, não há "você estava olhando" barato
 *  de detectar e o desfecho é raro (1 por missão, dedupado aqui). Abort do
 *  usuário NÃO notifica (gesto seu; o chamador não chama). Copy alinhada com
 *  os marcos do fio (notifyGate/recordError): mesma língua, outro canal. */
export function notifyMissionEnd(o: {
  missionId: string
  convId: string
  outcome: MissionOutcome
  costUsd: number
  /** Motivo humano (falha/teto) ou "preset X" (fim). */
  detail?: string
}) {
  if (missionEndNotified.has(o.missionId)) return
  missionEndNotified.add(o.missionId)

  const chat = useChat.getState()
  const c = chat.byId[o.convId]
  const meta = c
    ? (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
        (cv) => cv.id === o.convId,
      )
    : undefined
  const title = meta?.title ?? "Missão"
  const proj = c
    ? useApp.getState().projects.find((p) => p.id === c.projectId)
    : undefined
  const cost = `US$ ${o.costUsd.toFixed(2)}`
  const sufixoProj = proj ? ` · ${proj.name}` : ""

  const feed: Record<MissionOutcome, { kind: "run_done" | "run_error"; sub: string }> = {
    concluida: {
      kind: "run_done",
      sub: `Missão concluída · ${cost}${sufixoProj}`,
    },
    ressalva: {
      kind: "run_done",
      sub: `Missão concluída SEM aprovação do revisor · ${cost}${sufixoProj}`,
    },
    falha: {
      kind: "run_error",
      sub: `Missão falhou · ${o.detail ?? "falha na fase"} · ${cost}${sufixoProj}`,
    },
    teto: {
      kind: "run_error",
      sub: `Missão parou no teto de custo · ${o.detail ?? "orçamento esgotado"}${sufixoProj}`,
    },
  }
  useNotifs.getState().push({
    kind: feed[o.outcome].kind,
    title,
    subtitle: feed[o.outcome].sub,
    projectId: c?.projectId ?? "",
    convId: o.convId,
  })

  const nativo: Record<MissionOutcome, { titulo: string; corpo: string }> = {
    concluida: {
      titulo: "Frota · missão concluída",
      corpo: `${clipTitle(title)}: todas as fases terminaram (${cost}).`,
    },
    ressalva: {
      titulo: "Frota · missão concluída com ressalva",
      corpo: `${clipTitle(title)}: o revisor NÃO aprovou a entrega. Revise o parecer antes de confiar (${cost}).`,
    },
    falha: {
      titulo: "Frota · missão falhou",
      corpo: `${clipTitle(title)}: ${o.detail ?? "falha na fase"} (${cost}).`,
    },
    teto: {
      titulo: "Frota · missão parou no teto de custo",
      corpo: `${clipTitle(title)}: ${o.detail ?? "orçamento esgotado"}. O trabalho feito até aqui está no worktree.`,
    },
  }
  void nativeNotify(nativo[o.outcome].titulo, nativo[o.outcome].corpo)
}

/** Chamado UMA vez quando a missão PAUSA em RECOVERY (fase falhou por limite e
 *  espera você trocar de agent ou abortar). Irmão do notifyGate: a missão
 *  inteira está parada esperando VOCÊ, então feed + nativa SEMPRE. Sem spam:
 *  o store só chama no ponto único que abre o recovery (1 por episódio por
 *  construção — um re-run que re-falha é episódio novo, como no gate). */
export function notifyMissionRecovery(
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
    subtitle: `Recuperação pendente · ${phaseLabel}${projectName ? ` · ${projectName}` : ""}`,
    projectId: c?.projectId ?? "",
    convId,
  })

  void nativeNotify(
    "Frota · missão precisa de você",
    `${clipTitle(title)}: a fase ${phaseLabel} parou por limite; a missão está pausada. Escolha outro agent para retomar, ou aborte.`,
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
    `${clipTitle(o.convTitle)} (${o.projectName}): o turno parou pedindo ${o.toolName} · ${o.headline}`,
  )
}

/** Permissão vinda de HOOK (H2 do hooks-plan): sessão EXTERNA no terminal
 *  pediu permissão e a pendência é respondível no app/Companion por até 30s.
 *  Não tem conversa dona (não somos donos da sessão) — o feed aponta pro
 *  projeto quando o cwd é de projeto conhecido ("" = desconhecido, o clique
 *  não navega). A nativa avisa sempre: o pedido nasceu FORA do app, então
 *  nunca há card "na sua frente" garantido. */
export function notifyHookPermission(o: {
  /** Rótulo do motor ("Claude", "Codex", "agy"). */
  engine: string
  /** Projeto conhecido ou basename do cwd. */
  place: string
  projectId: string | null
  toolName: string
  /** Resumo de uma linha (summarizeApproval().headline). */
  headline: string
}) {
  useNotifs.getState().push({
    kind: "approval",
    title: `${o.engine} no terminal`,
    subtitle: `Permissão pendente · ${o.headline}${o.place ? ` · ${o.place}` : ""}`,
    projectId: o.projectId ?? "",
  })
  void nativeNotify(
    "Frota · permissão no terminal",
    `${o.engine} (${o.place}) pediu ${o.toolName}: ${o.headline}. Responda no app em até 30s ou decida no terminal.`,
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
    `${clipTitle(o.convTitle)} (${o.projectName}): o turno parou esperando sua resposta · ${o.headline}${extra}`,
  )
}

/** Chamado quando um pedido bloqueante de um run DESASSISTIDO (automação)
 *  estoura o limiar e o app responde fail-closed no seu lugar (lib/watchdog).
 *
 *  DECISÃO (2 superfícies, nenhuma nativa): o rastro que fica pra sempre é o
 *  `notice` NO FIO da conversa (o watchdog injeta) — é lá que você vai olhar
 *  quando abrir a conversa da automação amanhã, e ele é persistido junto com o
 *  turno. O feed do sino entra porque a conversa da automação nasce em
 *  background: sem ele o desfecho só existiria numa tela que você não abriu.
 *  Nativa NÃO: ela já saiu na CHEGADA do pedido (notifyApproval/notifyQuestion);
 *  repetir na expiração seria cutucar de novo justamente quem não estava lá. */
export function notifyUnattendedTimeout(o: {
  projectId: string
  convId?: string
  projectName: string
  convTitle: string
  kind: "approval" | "question"
  /** Resumo de uma linha do que foi pedido. */
  headline: string
  minutes: number
}) {
  const acao =
    o.kind === "approval"
      ? "Permissão negada automaticamente"
      : "Pergunta devolvida sem resposta"
  useNotifs.getState().push({
    // run_error: pro sino isto É um desfecho ruim da automação (o turno seguiu
    // sem o que pediu), no mesmo idioma do "Automação falhou" do scheduleEngine.
    kind: "run_error",
    title: o.convTitle,
    subtitle: `${acao} · ninguém respondeu em ${o.minutes} min · ${o.headline}${o.projectName ? ` · ${o.projectName}` : ""}`,
    projectId: o.projectId,
    convId: o.convId,
  })
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

/** Chamado UMA vez por episódio quando uma FASE DE MISSÃO running fica MUDA
 *  (sem nenhum item novo) além do limiar (settings.stalledAfterMin, o mesmo
 *  knob dos turnos). A missão não seta `running` na conversa, então o vigia de
 *  turno não a enxerga — este é o espelho pro pipeline (MH1.2). Aqui é só o
 *  aviso de SO; o toast acionável fica com o watchdog. Sem spam: 1x/episódio. */
export function notifyMissionStalled(
  convId: string,
  agent: string,
  phaseLabel: string,
  minutes: number,
) {
  const chat = useChat.getState()
  const c = chat.byId[convId]
  const meta = c
    ? (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
        (cv) => cv.id === convId,
      )
    : undefined
  const title = meta?.title ?? "Missão"
  void nativeNotify(
    "Frota · fase de missão muda",
    `${clipTitle(title)}: a fase "${phaseLabel}" (${agentLabel(agent)}) está há ${minutes} min sem produzir nada novo. A fase pode ter travado.`,
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
