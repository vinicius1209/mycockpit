// Os EVENTOS de notificação do produto: turno terminou, gate abriu, missão
// travou. O transporte até o SO (permissão, plugin, fallback por osascript)
// mora em lib/notify/native.ts desde que este arquivo passou do teto.

import { useChat } from "@/store/chat"
import { useApp } from "@/store/app"
import { useNotifs } from "@/store/notifications"
import { agentLabel } from "@/lib/agent"
import { receiptBody, turnReceipt } from "@/lib/turnReceipt"
import { clipTitle, nativeNotify } from "@/lib/notify/native"
import { playTaskDoneChime } from "@/lib/userProfile"
import { helperDoProjeto } from "@/lib/helperDoProjeto"
import { nomearConversa } from "@/store/chat/titulo"
// A porta de entrada continua sendo `@/lib/notify`: quem já importava
// `nativeNotify` daqui (App, onboarding, companion) não precisa saber que o
// transporte mudou de arquivo. Extração não é motivo pra mexer em call site.
export { nativeNotify } from "@/lib/notify/native"

/**
 * Fim de UM turno: empilha no feed e, se a conversa não é a ativa, dispara a
 * nativa. Turno em background ganha recibo (uma frase do que o agente fez); o
 * feed espera o recibo (≤3s) para o sino e a nativa não divergirem. No
 * primeiro plano não há recibo nem espera.
 */
export async function notifyTurnEnd(convId: string, agent: string) {
  const chat = useChat.getState()
  const c = chat.byId[convId]
  if (!c) return
  const last = c.items[c.items.length - 1]
  if (last?.kind === "cancelled") return // cancelamento do usuário não notifica

  // Fim de turno é onde a conversa ganha nome, e este é o funil único dos cinco
  // caminhos de fim de turno. Não espera: HUD e bandeja resolvem o nome pelo
  // convId quando ele chega (ADR-142).
  void nomearConversa(convId)

  // usa o array do projeto DONO (c.projectId) — o turno pode ter rodado em
  // background num projeto não-ativo, que não está no espelho `conversations`.
  const meta = (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
    (cv) => cv.id === convId,
  )
  const title = meta?.title ?? "Conversa"
  const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
  const errored = last?.kind === "error" || last?.kind === "limit"

  // Background = você não estava olhando. É o único caso que merece recibo (no
  // primeiro plano o fio já te contou) e o único que paga a chamada extra.
  const background = chat.activeId !== convId
  const recibo = background
    ? await turnReceipt({
        helperModel: helperDoProjeto(c.projectId),
        cwd: c.worktreePath ?? proj?.path ?? "",
        items: c.items,
      })
    : null

  useNotifs.getState().push({
    kind: errored ? "run_error" : "run_done",
    title,
    subtitle: `${agentLabel(agent)}${proj ? ` · ${proj.name}` : ""}`,
    body: recibo ?? undefined,
    projectId: c.projectId,
    convId,
    origem: "turno",
  })

  // só incomoda com a nativa quando você NÃO estava olhando essa conversa.
  if (background) {
    void nativeNotify("Frota", receiptBody(clipTitle(title), errored, recibo))
  }

  if (useApp.getState().settings.userPreferences?.soundAlertsEnabled && !errored) {
    void playTaskDoneChime()
  }
}

/** Gate humano abriu (a missão pausou esperando você): feed e nativa sempre,
 *  porque o gate segura a missão inteira. O store chama uma vez por gate. */
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

/** Desfecho de missão: feed e nativa sempre (trabalho longo, com o app em
 *  background, e raro). Abort seu não notifica. Copy alinhada aos marcos do
 *  fio. */
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
    origem: "missao",
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

/** A missão pausou em recovery esperando você trocar de agent: feed e nativa
 *  sempre. Uma vez por episódio, por construção do store. */
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

/** Pedido de permissão: o turno parado esperando você. Feed sempre; a nativa
 *  só quando o card não está na sua frente (`seen`). O chamador só chama no
 *  primeiro pendente de cada conversa. */
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

/** Permissão vinda de HOOK: sessão externa no terminal, respondível no app ou
 *  no Companion por até 30s. Sem conversa dona; o feed aponta o projeto quando
 *  o cwd é conhecido. A nativa avisa sempre: o pedido nasceu fora do app. */
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

/** Pergunta (`ask_user`): o turno parado esperando conteúdo. Mesmo contrato da
 *  permissão (feed sempre, nativa se não `seen`, só o primeiro pendente), com
 *  a cópia "perguntou". */
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

/** Pedido de run desassistido estourou o limiar e o app respondeu
 *  fail-closed (lib/watchdog). Feed sim (a conversa da automação nasce em
 *  background); nativa não, porque já saiu na chegada do pedido. O rastro
 *  permanente é o notice no fio, que o watchdog injeta. */
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

/** Turno running sem item novo além do limiar: a nativa sempre (é o caso de
 *  ninguém olhando). O toast acionável fica com o watchdog, que chama uma vez
 *  por episódio. */
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
    "Frota · turno sem atualizações",
    `${clipTitle(title)}: a ponte de ${agentLabel(agent)} não publica progresso novo há ${minutes} min. O turno pode ter travado.`,
  )
}

/** Fase de missão muda além do limiar (a missão não seta `running`, então
 *  o vigia de turno não a vê). Só o aviso de SO; uma vez por episódio. */
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

/** Card em review/blocked parado além do limiar, esperando você. Só o aviso de
 *  SO; uma vez por episódio. */
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

/**
 * Chamado quando um trabalho em background (DeferredWork) atinge estado terminal
 * (completed ou interrupted). Deduplicado pelo chamador por tentativa e desfecho (SPEC F4).
 */
export function notifyDeferredEnd(o: {
  convId: string
  name: string | null
  status: "completed" | "interrupted"
  summary?: string | null
}) {
  const chat = useChat.getState()
  const c = chat.byId[o.convId]
  if (!c) return

  const meta = (chat.conversationsByProject[c.projectId] ?? chat.conversations).find(
    (cv) => cv.id === o.convId,
  )
  const convTitle = meta?.title ?? "Conversa"
  const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
  const workName = o.name || "Trabalho em background"
  const isOk = o.status === "completed"

  const title = isOk
    ? "Trabalho em background concluído"
    : "Trabalho em background parou"
  const body = isOk
    ? `${workName} concluído · ${convTitle}`
    : `${workName} parou antes de concluir · ${convTitle}`

  useNotifs.getState().push({
    kind: isOk ? "run_done" : "run_error",
    title,
    subtitle: proj?.name ?? agentLabel(c.agent),
    body: o.summary ?? undefined,
    projectId: c.projectId,
    convId: o.convId,
    origem: "trabalho",
  })

  if (chat.activeId !== o.convId) {
    void nativeNotify("Frota", body)
  }
}

