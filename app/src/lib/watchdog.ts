// Vigia de TURNO MUDO (P2 do pacote de confiabilidade): um turno "running" que
// fica minutos sem produzir NENHUM item novo costuma ser CLI travada (socket
// pendurado, prompt engolido, processo zumbi) — e nada avisava. Este vigia
// observa o useChat FORA do hot path (subscribe coalescido + tick lento),
// compara a ASSINATURA leve dos itens (padrão itemsSignature do
// lib/fleet/derive) e, passado o limiar (settings.stalledAfterMin; 0 =
// desligado), avisa UMA vez por episódio: notificação nativa
// (notifyTurnStalled) + toast acionável ("Ver conversa" / "Cancelar turno") +
// flag transient stalledSince na conversa (lib/fleet/derive e snapshot do
// Companion leem). Atividade nova
// fecha o episódio — mudo DE NOVO por outro período completo ⇒ novo aviso.
//
// S2.2 generaliza o vigia pro BOARD: checkStalledCards varre cards em
// review/blocked (esperando HUMANO) parados além do MESMO limiar (sinal =
// updated_at do card), no MESMO ticker + subscribe (um listener a mais no
// useCards, nunca um segundo setInterval). Card `working` com conversa muda
// já é coberto por checkStalledTurns — aqui fica de fora (dedupe de aviso).
//
// checkStalledMissions (MH1.2) é outra passada do MESMO ticker: a missão NÃO
// seta `running` na conversa (o pipeline vive no useMission), então uma fase
// travada era invisível pros vigias. A passada varre as missões running com
// fase corrente rodando (gate/recovery pendente = esperando VOCÊ, não mudo),
// observa a assinatura dos itens da fase (onProgress espelha o stream) e avisa
// UMA vez por episódio, com "Parar missão" no toast (abort real, não teatro).
//
// checkUnattendedInteractions é a TERCEIRA passada do MESMO ticker e trata o
// caso simétrico: não é o agent que está mudo, é VOCÊ — um pedido bloqueante
// (permissão/pergunta) de um run DESASSISTIDO (automação; ver
// lib/unattendedRuns) que ninguém responde congelaria o turno pra sempre,
// porque o backend espera sem timeout. Passado o limiar, o app responde
// fail-closed, o turno termina e o desfecho fica visível (notice no fio + sino).
// Aqui NÃO há setTimeout por pedido: o ticker É o timer e a memória é podada
// contra a fila viva, então run que acaba antes do prazo não deixa nada.

import { toast } from "sonner"
import { agentLabel, cancelAgent } from "@/lib/agent"
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

/** Tolerância de drift store×banco (F1, defesa em profundidade): mutações
 *  NOVAS usam um relógio só (o store passa o MESMO `now` pro db), mas linhas
 *  gravadas por versões antigas ainda podem recarregar com updated_at alguns
 *  ms diferente do que o store viu. Avanço dentro da tolerância NÃO é
 *  atividade: o episódio segue o mesmo, sem re-aviso do MESMO silêncio. */
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
/** Memória de episódio por cardId (mesmo padrão do `marks`). Toda mutação
 *  REAL de card bumpa updated_at (patchCard e db carimbam o mesmo relógio),
 *  então "updated_at avançou além da tolerância" É o sinal de atividade que
 *  fecha o episódio; o campo `state` na marca é defensivo, não a semântica
 *  dominante (mover card = bump de updated_at de qualquer jeito). */
const cardMarks = new Map<string, CardMark>()

type MissionMark = {
  sig: string
  at: number
  /** Já avisado NESTE episódio (1 aviso por episódio, padrão cardMarks). */
  notified: boolean
}
/** Memória de episódio de FASE DE MISSÃO muda, por convId (MH1.2). */
const missionMarks = new Map<string, MissionMark>()

/** Memória do prazo de cada pedido bloqueante pendente (id do pedido → marca).
 *  O carimbo `since` é a 1ª VISTA do vigia, não o instante exato da chegada: o
 *  subscribe coalescido (5s) e o tick (30s) tornam a diferença irrelevante
 *  diante de um limiar em MINUTOS, e assim não precisamos carregar timestamp
 *  na fila do store (que espelha o payload do backend). */

/** (testes) zera a memória do vigia. */
export function _resetWatchdogState(): void {
  marks.clear()
  cardMarks.clear()
  _resetPendingMarks()
  missionMarks.clear()
}

/** Assinatura leve do andamento (padrão itemsSignature do derive): muda quando
 *  chega delta/tool/result — é o "sinal de vida" que o vigia observa.
 *  DECISÃO (P2): uma tool RODANDO há muito sem result (build/suíte longa) NÃO
 *  muda a assinatura — conta como "mudo" e o aviso dispara. Intencional: o
 *  aviso é informativo ("o turno segue em execução"), não cancela nada, e uma
 *  tool acima do limiar é exatamente o que o usuário quer conferir. Streaming
 *  de texto lento ≠ mudo: cada delta muda text.length ⇒ re-arma o cronômetro. */
function itemsSignature(items: ChatItem[]): string {
  const last = items[items.length - 1]
  if (!last) return "0"
  const extra =
    last.kind === "text"
      ? String(last.text.length)
      : last.kind === "tool"
        ? `${last.name}:${last.result ? 1 : 0}`
        : ""
  // Trabalho DIFERIDO vivo (deferred-work-plan D2A.3): o `task_progress`
  // atualiza o nó IN PLACE — e ele raramente é o último item, então sem este
  // componente uma pesquisa em background de 15 min viraria falso "turno mudo".
  // Progresso de diferido É sinal de vida: muda a assinatura, re-arma o
  // cronômetro. Além do summary, os TOKENS entram na assinatura: uma fase
  // longa mantém a MESMA description por vários ticks, mas o usage avança —
  // sem ele, fase de 15+ min virava falso aviso. Diferido vivo mas SEM
  // progresso novo (nem summary nem tokens) segue contando como mudo (mesma
  // DECISÃO da tool longa acima: aviso informativo, nada é cancelado).
  let deferred = ""
  for (const it of items) {
    if (it.kind === "tool" && it.deferred?.status === "running")
      deferred += `|${it.deferred.id}:${it.deferred.summary ?? ""}:${it.deferred.tokens ?? ""}`
  }
  return `${items.length}:${last.id}:${last.kind}:${extra}${deferred}`
}

/** F-D (follow-up S2): há episódio de TURNO MUDO aberto e JÁ AVISADO pra esta
 *  conversa? É a consulta que o vigia de CARDS usa pra não cutucar o humano
 *  duas vezes pelo MESMO ciclo de silêncio (o aviso de turno mudo já saiu).
 *  Episódio aberto = turno rodando + marca viva no `marks` + flag transient
 *  `stalledSince` na conversa (o "já avisado" do checkStalledTurns). */
export function stalledTurnEpisodeOpen(convId: string): boolean {
  const c = useChat.getState().byId[convId]
  return c != null && c.running && c.stalledSince != null && marks.has(convId)
}

/** Cancela o turno mudo (ação do toast): mata o auto-resume agendado e o run
 *  corrente — o mesmo par do "stop-activity" da tray (App.tsx). */
export async function cancelStalledTurn(convId: string): Promise<void> {
  const chat = useChat.getState()
  chat.cancelAutoResume(convId)
  const runId = chat.byId[convId]?.runId
  if (runId) await cancelAgent(runId)
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
  toast(`${agentLabel(agent)} está mudo há ${minutes} min`, {
    description: "O turno segue em execução, mas sem produzir nada novo.",
    duration: 15_000,
    action: {
      label: "Ver conversa",
      onClick: () => void openStalledConv(convId),
    },
    cancel: {
      label: "Cancelar turno",
      onClick: () => void cancelStalledTurn(convId),
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
    // Turno PARADO ESPERANDO VOCÊ não é turno mudo. O silêncio aqui tem causa
    // conhecida e já avisada na chegada do pedido (notifyApproval/notifyQuestion),
    // e o card está na tela. Sem esta guarda, uma automação bloqueada em
    // aprovação disparava TRÊS avisos quase juntos (os dois limiares têm o mesmo
    // default de 10 min): "turno mudo" + o notice/sino do timeout desassistido.
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
  toast(`Missão: a fase "${phaseLabel}" está muda há ${minutes} min`, {
    description: `${agentLabel(agent)} segue em execução, mas sem produzir nada novo.`,
    duration: 15_000,
    action: {
      label: "Ver conversa",
      onClick: () => void openStalledConv(convId),
    },
    cancel: {
      // Stop REAL da missão (cancela o run da fase e marca aborted) — o mesmo
      // gesto do "Parar" da timeline, nunca um dismiss disfarçado de ação.
      label: "Parar missão",
      onClick: () => useMission.getState().abort(convId),
    },
  })
}

/** UMA passada do vigia de FASE DE MISSÃO muda (MH1.2; determinística dado
 *  stores + memória; `now` injetável p/ teste). A missão não seta `running`
 *  na conversa, então checkStalledTurns não a cobre — este é o espelho:
 *  fase corrente RUNNING sem nenhum item novo além do limiar
 *  (settings.stalledAfterMin) avisa UMA vez por episódio. Gate/recovery
 *  pendentes e pedidos de permissão/pergunta na fila são "esperando você"
 *  (causa conhecida, já avisada) — nunca contam como mudo. */
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
    // pedido de permissão/pergunta pendente DESTA conversa = bloqueada com
    // causa conhecida (o card na tela + o vigia desassistido cobrem o prazo).
    // Conta como ATIVIDADE (re-ancora, padrão F2 dos cards): respondido o
    // pedido, o agent ganha a janela COMPLETA antes de contar como mudo.
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

/** DECISÃO (S2.2): a primária do toast é "Abrir card" (contexto antes de
 *  gesto), não "Concluir" — fechar às cegas de um toast é gesto forte demais
 *  pra um clique sem olhar o card, e done/cancelled é gate humano do BOARD
 *  (closeCard, com o card na frente). A secundária só dispensa o toast; a
 *  nativa + a fila "Precisam de você" continuam cobrando. */
function showStalledCardToast(
  cardId: string,
  title: string,
  state: "review" | "blocked",
  minutes: number,
): void {
  toast(`"${title}" está parado há ${minutes} min`, {
    description:
      state === "blocked"
        ? "O card segue bloqueado, esperando um gesto seu."
        : "O card segue em revisão, esperando um gesto seu.",
    duration: 15_000,
    action: {
      // com conversa ligada abre a conversa; sem conversa não há tela do card
      // (o Board saiu do Painel, ADR-040), então o destino é a fila da faixa,
      // que é onde ele existe como decisão pendente.
      label: "Abrir card",
      onClick: () =>
        void openCardConversation(cardId).then((ok) => {
          if (!ok) useApp.getState().setDecisionsOpen(true)
        }),
    },
    cancel: {
      label: "Dispensar",
      onClick: () => {}, // só fecha o toast; o episódio continua marcado
    },
  })
}

/** UMA passada do vigia de CARDS (determinística dado stores + memória; `now`
 *  injetável p/ teste): varre SÓ review/blocked (esperando humano) — working
 *  com conversa muda é papel do checkStalledTurns (dedupe), backlog é fila e
 *  terminais são história. Sinal de vida = updated_at (toda mutação real
 *  bumpa); 1 aviso por episódio via cardMarks. */
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
    // F2: conversa ligada RODANDO = o agent está trabalhando, ninguém espera
    // o humano — não é estagnação (turno mudo ali é papel do
    // checkStalledTurns). Conta como ATIVIDADE: re-ancora a cada passada,
    // então o cronômetro só começa do fim do turno (última passada running) —
    // updated_at do card não muda quando o turno acaba, a âncora cobre isso.
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
      // 1ª vista ou mutação real: episódio novo ancorado no updated_at (o
      // sinal PERSISTIDO de última atividade — card já parado há horas antes
      // do boot avisa na primeira passada, sem esperar outro limiar).
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
    // F-D — dedupe com o vigia de TURNO: se o turno mudo da MESMA conversa já
    // foi avisado (episódio aberto), o humano já foi cutucado por este
    // silêncio — SEGURA o card (sem marcar notified: fechado o episódio do
    // turno, o card ainda parado avisa na passada seguinte). Hoje a guarda F2
    // acima (conversa running re-ancora) já cobre o caso; esta é a garantia
    // EXPLÍCITA, imune a mudanças na semântica do F2.
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

/** Liga o vigia: subscribe do useChat, useCards, useMission E useInteractions
 *  (coalescidos ≥5s no MESMO schedule, trailing edge) + UM tick de 30s
 *  (silêncio não gera evento de store) varrendo turnos, fases de missão,
 *  cards e pedidos pendentes de run desassistido. Retorna o stop. */
export function startTurnWatchdog(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const check = () => {
    const now = Date.now()
    checkStalledTurns(now)
    checkStalledMissions(now)
    checkStalledCards(now)
    checkUnattendedInteractions(now)
    // Poll do medidor de janela de uso (lib/usageWindow): MESMO ticker — o
    // tick de 30s é exatamente o piso da política de poll (POLL_FLOOR_MS).
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
