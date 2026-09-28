// O vigia: um ticker só (subscribe coalescido + tick lento), fora do hot path,
// com um aviso por episódio. Passadas:
//  - checkStalledTurns: turno "running" sem item novo além do limiar
//    (settings.stalledAfterMin; 0 = desligado) costuma ser CLI travada. Avisa
//    (nativa e toast com "Ver conversa" / "Cancelar turno") e marca
//    stalledSince na conversa. Atividade nova fecha o episódio.
//  - checkStalledCards: cards em review/blocked (esperando você) parados além
//    do mesmo limiar, pelo updated_at. Card `working` com conversa muda é do
//    vigia de turno.
//  - checkStalledMissions: a missão não seta `running` na conversa, então a
//    fase travada tem passada própria, com "Parar missão" no toast.
//  - checkUnattendedInteractions: o caso simétrico, você mudo. Pedido
//    bloqueante de run desassistido (automação) que ninguém responde
//    congelaria o turno (o backend espera sem timeout): passado o limiar, o
//    app responde fail-closed e o desfecho fica visível. O ticker é o timer.

import { avisar } from "@/lib/avisos"
import { agentLabel } from "@/lib/agent"
import { cancelLinearTurn } from "@/lib/cancelLinearTurn"
import {
  notifyCardStalled,
  notifyMissionStalled,
  notifyTurnStalled,
} from "@/lib/notify"
import { checkUsageWindowPoll } from "@/lib/usageWindow"
import {
  _resetPendingMarks,
  checkUnattendedInteractions,
} from "@/lib/unattendedWatch"
// Porta antiga preservada: extração não é motivo pra mexer em call site.
export { checkUnattendedInteractions } from "@/lib/unattendedWatch"
import { useApp } from "@/store/app"
import { openCardConversation, useCards } from "@/store/cards"
import { useChat, type ChatItem } from "@/store/chat"
import { ownerByRunId, useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import type { CardState } from "@/lib/db"

/** Coalescing do subscribe do chat (o vigia nunca roda por delta de stream). */
const COALESCE_MS = 5_000
/** Tick de relógio: silêncio não emite evento de store — alguém precisa olhar. */
const TICK_MS = 30_000

type Mark = { sig: string; at: number }
/** Última assinatura de itens vista por conv running + quando ela MUDOU. */
const marks = new Map<string, Mark>()

/** Tolerância de drift entre store e banco: linhas antigas podem recarregar
 *  com updated_at alguns ms diferente. Avanço dentro dela não é atividade. */
const CARD_DRIFT_TOLERANCE_MS = 1_000

type CardMark = {
  state: CardState
  updatedAt: number
  /** Âncora do silêncio: de onde o cronômetro conta (updated_at na 1ª vista/
   *  atividade; `now` da última passada enquanto a conversa ligada rodava). */
  anchor: number
  /** Já avisado NESTE episódio (1 aviso por episódio). */
  notified: boolean
}
/** Memória de episódio por cardId. Toda mutação real bumpa updated_at, então
 *  "avançou além da tolerância" é o sinal de atividade; `state` é defensivo. */
const cardMarks = new Map<string, CardMark>()

type MissionMark = {
  sig: string
  at: number
  /** Já avisado NESTE episódio (1 aviso por episódio, padrão cardMarks). */
  notified: boolean
}
/** Memória de episódio de FASE DE MISSÃO muda, por convId (MH1.2). */
const missionMarks = new Map<string, MissionMark>()

/** Prazo de cada pedido bloqueante pendente. `since` é a 1ª vista do vigia,
 *  não a chegada: diante de um limiar em minutos a diferença é irrelevante, e
 *  a fila do store não precisa carregar timestamp. */

/** (testes) zera a memória do vigia. */
export function _resetWatchdogState(): void {
  marks.clear()
  cardMarks.clear()
  _resetPendingMarks()
  missionMarks.clear()
}

/** Assinatura leve do andamento: presença não é heartbeat. Só evento ou
 * progresso observável re-arma o relógio. */
function itemsSignature(items: ChatItem[]): string {
  const last = items[items.length - 1]
  if (!last) return "0"
  const extra =
    last.kind === "text"
      ? String(last.text.length)
      : last.kind === "tool"
        ? `${last.name}:${last.result ? 1 : 0}:${last.activityAt ?? ""}`
        : ""
  // Trabalho DIFERIDO vivo (deferred-work-plan D2A.3): o `task_progress`
  // atualiza o nó IN PLACE — e ele raramente é o último item, então sem este
  // componente uma pesquisa em background de 15 min viraria falso "turno mudo".
  let work = ""
  for (const it of items) {
    if (it.kind !== "tool") continue
    if (it.deferred?.status === "running")
      work += `|d:${it.deferred.id}:${it.deferred.summary ?? ""}:${it.deferred.tokens ?? ""}:${it.deferred.updatedAt}`
    if (it.managedProcess && ["running", "stopping"].includes(it.managedProcess.status))
      work += `|p:${it.managedProcess.id}:${it.managedProcess.status}:${it.managedProcess.updatedAt}:${it.managedProcess.output.length}`
  }
  return `${items.length}:${last.id}:${last.kind}:${extra}${work}`
}

/** Há episódio de turno mudo aberto e já avisado para esta conversa? O vigia
 *  de cards consulta para não avisar duas vezes pelo mesmo silêncio. */
export function stalledTurnEpisodeOpen(convId: string): boolean {
  const c = useChat.getState().byId[convId]
  return c != null && c.running && c.stalledSince != null && marks.has(convId)
}

/** Cancela o turno mudo (ação do toast): mata o auto-resume agendado e o run
 *  corrente — o mesmo par do "stop-activity" da tray (App.tsx). */
export async function cancelStalledTurn(convId: string): Promise<void> {
  await cancelLinearTurn(convId, "parada")
}

/** Navega até a conversa muda (padrão openConversation da tray). */
async function openStalledConv(convId: string): Promise<void> {
  const chat = useChat.getState()
  const projectId = chat.byId[convId]?.projectId
  if (!projectId) return
  useApp.getState().setActiveProject(projectId)
  await chat.openProject(projectId)
  await chat.switchConversation(convId)
  useApp.getState().setViewMode("linear")
}

function showStalledToast(
  convId: string,
  agent: string,
  minutes: number,
): void {
  avisar.evento(`Sem atualizações de ${agentLabel(agent)} há ${minutes} min`, {
    origem: { conversa: convId },
    detalhe: "O turno ainda aparece em execução, mas a ponte não publicou progresso novo.",
    duracao: 15_000,
    acao: {
      rotulo: "Ver conversa",
      fazer: () => void openStalledConv(convId),
    },
    secundaria: {
      rotulo: "Cancelar turno",
      fazer: () => void cancelStalledTurn(convId),
    },
  })
}

/** A conversa tem pedido pendente (permissão/pergunta) esperando resposta? Se
 *  tem, o turno não está mudo — está bloqueado, com causa conhecida e card na
 *  tela. Exportada p/ teste. */
export function esperandoVoce(convId: string): boolean {
  const chat = useChat.getState()
  const missions = useMission.getState()
  return useInteractions
    .getState()
    .queue.some((r) => ownerByRunId(r, chat, missions)?.convId === convId)
}

/** UMA passada do vigia (determinística dado stores + memória; `now` injetável
 *  p/ teste): marca atividade, detecta silêncio > limiar, fecha episódios. */
export function checkStalledTurns(now: number = Date.now()): void {
  const afterMin = useApp.getState().settings.stalledAfterMin
  const chat = useChat.getState()
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (!c.running) {
      // turno acabou: esquece a marca e fecha o episódio (se aberto).
      marks.delete(convId)
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    const sig = itemsSignature(c.items)
    const prev = marks.get(convId)
    if (!prev || prev.sig !== sig) {
      // atividade (ou 1ª vista): re-arma o cronômetro e fecha o episódio.
      marks.set(convId, { sig, at: now })
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    if (afterMin <= 0) {
      // 0 = desligado: segue medindo (religar já tem baseline), sem avisar.
      if (c.stalledSince != null) chat.clearStalled(convId)
      continue
    }
    if (c.stalledSince != null) continue // já avisado NESTE episódio
    // Turno esperando VOCÊ não é turno mudo: a causa já foi avisada na chegada
    // do pedido e o card está na tela. Sem isto, uma automação bloqueada
    // disparava três avisos quase juntos.
    if (esperandoVoce(convId)) continue
    const silentMs = now - prev.at
    if (silentMs < afterMin * 60_000) continue
    const minutes = Math.max(afterMin, Math.round(silentMs / 60_000))
    chat.markStalled(convId, prev.at)
    notifyTurnStalled(convId, c.agent, minutes)
    showStalledToast(convId, c.agent, minutes)
  }
  // conversa removida não deixa marca órfã
  for (const id of [...marks.keys()]) {
    if (!chat.byId[id]) marks.delete(id)
  }
}

function showStalledMissionToast(
  convId: string,
  phaseLabel: string,
  agent: string,
  minutes: number,
): void {
  avisar.evento(`Missão: a fase "${phaseLabel}" está muda há ${minutes} min`, {
    origem: { conversa: convId },
    detalhe: `${agentLabel(agent)} segue em execução, mas sem produzir nada novo.`,
    duracao: 15_000,
    acao: {
      rotulo: "Ver conversa",
      fazer: () => void openStalledConv(convId),
    },
    secundaria: {
      // Stop REAL da missão (cancela o run da fase e marca aborted) — o mesmo
      // gesto do "Parar" da timeline, nunca um dismiss disfarçado de ação.
      rotulo: "Parar missão",
      fazer: () => useMission.getState().abort(convId),
    },
  })
}

/** Uma passada do vigia de fase de missão muda (`now` injetável): fase
 *  corrente rodando sem item novo além do limiar avisa uma vez por episódio.
 *  Gate, recovery e pedidos na fila são "esperando você", nunca mudo. */
export function checkStalledMissions(now: number = Date.now()): void {
  const afterMin = useApp.getState().settings.stalledAfterMin
  const missions = useMission.getState().byConv
  for (const [convId, m] of Object.entries(missions)) {
    const cur = m.phases[m.current]
    const phaseRunning =
      m.status === "running" &&
      !m.gate &&
      !m.recovery &&
      cur?.status === "running"
    if (!phaseRunning) {
      // fase acabou/pausou (gate, recovery, fim): fecha o episódio.
      missionMarks.delete(convId)
      continue
    }
    // assinatura inclui a fase e a tentativa: trocar de fase (ou re-rodar
    // após recovery) é atividade — o cronômetro re-arma.
    const sig = `${m.current}:${cur.attempt}:${itemsSignature(cur.items ?? [])}`
    const prev = missionMarks.get(convId)
    if (!prev || prev.sig !== sig) {
      missionMarks.set(convId, { sig, at: now, notified: false })
      continue
    }
    // Pedido pendente desta conversa é causa conhecida e conta como atividade
    // (re-ancora): respondido, o agent ganha a janela inteira.
    if (esperandoVoce(convId)) {
      missionMarks.set(convId, { sig, at: now, notified: false })
      continue
    }
    if (afterMin <= 0) continue // 0 = desligado: segue medindo, sem avisar
    if (prev.notified) continue // já avisado NESTE episódio
    const silentMs = now - prev.at
    if (silentMs < afterMin * 60_000) continue
    const minutes = Math.max(afterMin, Math.round(silentMs / 60_000))
    prev.notified = true
    notifyMissionStalled(convId, cur.def.agent, cur.def.label, minutes)
    showStalledMissionToast(convId, cur.def.label, cur.def.agent, minutes)
  }
  // missão removida (clear) não deixa marca órfã
  for (const id of [...missionMarks.keys()]) {
    if (!missions[id]) missionMarks.delete(id)
  }
}

/** A primária do toast é "Abrir card" (contexto antes do gesto): fechar às
 *  cegas é forte demais, e done/cancelled é gate humano do board. A
 *  secundária só dispensa; a nativa e "Precisam de você" seguem cobrando. */
function showStalledCardToast(
  cardId: string,
  title: string,
  state: "review" | "blocked",
  minutes: number,
): void {
  avisar.evento(`"${title}" está parado há ${minutes} min`, {
    detalhe:
      state === "blocked"
        ? "O card segue bloqueado, esperando um gesto seu."
        : "O card segue em revisão, esperando um gesto seu.",
    duracao: 15_000,
    acao: {
      // com conversa ligada abre a conversa; sem conversa não há tela do card
      // (o Board saiu do Painel, ADR-040), então o destino é a fila da faixa,
      // que é onde ele existe como decisão pendente.
      rotulo: "Abrir card",
      fazer: () =>
        void openCardConversation(cardId).then((ok) => {
          if (!ok) useApp.getState().setDecisionsOpen(true)
        }),
    },
    secundaria: {
      rotulo: "Dispensar",
      fazer: () => {}, // só fecha o toast; o episódio continua marcado
    },
  })
}

/** Uma passada do vigia de cards (`now` injetável): só review/blocked. Sinal
 *  de vida = updated_at; um aviso por episódio via cardMarks. */
export function checkStalledCards(now: number = Date.now()): void {
  const afterMin = useApp.getState().settings.stalledAfterMin
  const cards = useCards.getState()
  const chat = useChat.getState()
  if (afterMin <= 0) {
    // 0 = desligado (mesmo contrato dos turnos): sem aviso, sem flag. Limpa
    // TAMBÉM a memória de episódio (F4, simetria com os turnos): religar o
    // knob re-avalia do zero — card ainda parado além do limiar re-avisa.
    cardMarks.clear()
    for (const c of cards.all) {
      if (c.stalledSince != null) cards.clearCardStalled(c.id)
    }
    return
  }
  for (const c of cards.all) {
    if (c.state !== "review" && c.state !== "blocked") {
      // fora da sala de espera: fecha o episódio (se aberto) e some da memória.
      cardMarks.delete(c.id)
      if (c.stalledSince != null) cards.clearCardStalled(c.id)
      continue
    }
    // Conversa ligada rodando: o agent trabalha, ninguém espera você. Conta
    // como atividade (re-ancora), então o cronômetro começa no fim do turno.
    const convRunning =
      c.conversationId != null && chat.byId[c.conversationId]?.running === true
    if (convRunning) {
      cardMarks.set(c.id, {
        state: c.state,
        updatedAt: c.updatedAt,
        anchor: now,
        notified: false,
      })
      if (c.stalledSince != null) cards.clearCardStalled(c.id)
      continue
    }
    let mark = cardMarks.get(c.id)
    const activity =
      mark != null &&
      (mark.state !== c.state ||
        c.updatedAt > mark.updatedAt + CARD_DRIFT_TOLERANCE_MS)
    if (mark == null || activity) {
      // 1ª vista ou mutação real: episódio novo ancorado no updated_at, então
      // card já parado antes do boot avisa na primeira passada.
      mark = {
        state: c.state,
        updatedAt: c.updatedAt,
        anchor: c.updatedAt,
        notified: false,
      }
      cardMarks.set(c.id, mark)
      if (c.stalledSince != null) cards.clearCardStalled(c.id)
    }
    if (mark.notified) {
      // já avisado NESTE episódio: sem re-aviso; só re-afirma a flag se um
      // reload do store derrubou o transient (o badge acompanha o episódio).
      if (c.stalledSince == null) cards.markCardStalled(c.id, mark.anchor)
      continue
    }
    const silentMs = now - mark.anchor
    if (silentMs < afterMin * 60_000) continue
    // Se o turno mudo da mesma conversa já foi avisado, segura o card (sem
    // marcar notified): fechado o episódio do turno, o card ainda parado avisa
    // na passada seguinte. Garantia explícita, independente da guarda acima.
    if (c.conversationId && stalledTurnEpisodeOpen(c.conversationId)) continue
    const minutes = Math.max(afterMin, Math.round(silentMs / 60_000))
    mark.notified = true
    cards.markCardStalled(c.id, mark.anchor) // transient; nunca vai pro banco
    notifyCardStalled(c.title, c.state, minutes)
    showStalledCardToast(c.id, c.title, c.state, minutes)
  }
  // card removido do board não deixa marca órfã
  const alive = new Set(cards.all.map((c) => c.id))
  for (const id of [...cardMarks.keys()]) {
    if (!alive.has(id)) cardMarks.delete(id)
  }
}

/** Liga o vigia: subscribe de useChat, useCards, useMission e useInteractions
 *  (coalescidos ≥5s) e um tick de 30s, porque silêncio não gera evento.
 *  Retorna o stop. */
export function startTurnWatchdog(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = () => {
    const now = Date.now()
    checkStalledTurns(now)
    checkStalledMissions(now)
    checkStalledCards(now)
    checkUnattendedInteractions(now)
    // Poll do medidor de uso no mesmo ticker: 30s é o piso da política.
    checkUsageWindowPoll(now)
  }
  const schedule = () => {
    if (timer) return // já agendado neste burst → coalesce
    timer = setTimeout(() => {
      timer = null
      check()
    }, COALESCE_MS)
  }
  const unsubChat = useChat.subscribe(schedule)
  const unsubCards = useCards.subscribe(schedule)
  // o stream das fases de missão vive no useMission (onProgress): sem este
  // subscribe a baseline da fase só chegaria no tick lento (até 30s depois).
  const unsubMissions = useMission.subscribe(schedule)
  // pedido novo na fila só é carimbado quando o vigia OLHA: sem este subscribe
  // o prazo começaria a contar até 30s depois da chegada (o tick lento).
  const unsubInteractions = useInteractions.subscribe(schedule)
  const ticker = setInterval(check, TICK_MS)
  check() // baseline imediato
  return () => {
    unsubChat()
    unsubCards()
    unsubMissions()
    unsubInteractions()
    clearInterval(ticker)
    if (timer) clearTimeout(timer)
  }
}
