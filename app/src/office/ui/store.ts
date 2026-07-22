// Store zustand LOCAL do Agent Office (ui/) — estado de UI do modo, criado
// FORA do componente e testável sem DOM. Alimentado por transições DISCRETAS:
// SimEvent da engine + snapshots do bridge/derive. NUNCA por frame (§7).
// A ui/ não toca stores do app diretamente — leituras/efeitos passam pelo
// bridge/ (dockLeaveCtx, cancelDictation), mocáveis nos testes.
import { create } from "zustand"
import type { CameraMode, OfficeSnapshot, SimEvent } from "../engine/types"
import { dockLeaveCtx } from "../bridge/hooks"
import { cancelDictation } from "../bridge/voice"
import {
  onBossDeskDrop,
  onGateVisitChange,
  type GateVisit,
} from "../scene/behaviors/mission"

/** Contexto da decisão fechar-vs-minimizar (§5.4), lido do useChat pelo
 *  chamador (a ui/ não toca stores do app — isso é papel do bridge/hooks). */
export type DockLeaveCtx = { hasDraft: boolean; turnActive: boolean }

/** §5.4 — sair do raio / fechar o dock: com draft ou turno ativo ⇒ minimiza
 *  para o chip do HUD (nunca descartar draft em silêncio); senão fecha. */
export function decideDockLeave(ctx: DockLeaveCtx): "minimize" | "close" {
  return ctx.hasDraft || ctx.turnActive ? "minimize" : "close"
}

export type EscOutcome =
  | "cancel-dictation"
  | "minimize-dock"
  | "close-dock"
  | "none"

/** Esc — coordenador ÚNICO do §5, em ordem de prioridade:
 *  gravando ⇒ cancela ditado · dock aberto ⇒ fecha/minimiza (§5.4) · senão
 *  nada (sair do office é pelo ModeSwitcher/⌘K, nunca pelo Esc). */
export function decideEsc(
  s: { recording: boolean; dockOpen: boolean } & DockLeaveCtx,
): EscOutcome {
  if (s.recording) return "cancel-dictation"
  if (s.dockOpen)
    return decideDockLeave(s) === "minimize" ? "minimize-dock" : "close-dock"
  return "none"
}

/** Esc — executor ÚNICO do §5, usado pelo onEscape do engine/input E pelo
 *  keydown do composer do dock: decide (decideEsc) e EXECUTA. Cancelar o
 *  ditado NÃO seta recording aqui — o espelho do store solta exclusivamente
 *  via onDictationEnded (bridge/voice), num lugar só. Retorna o outcome
 *  (testes/telemetria). */
export function officeEscape(): EscOutcome {
  const s = useOfficeUi.getState()
  const out = decideEsc({
    recording: s.recording,
    dockOpen: s.dockDeskId !== null && !s.dockMinimized,
    ...dockLeaveCtx(s.dockConvId),
  })
  switch (out) {
    case "cancel-dictation":
      void cancelDictation()
      break
    case "minimize-dock":
      s.minimizeDock()
      break
    case "close-dock":
      s.closeDock()
      break
    case "none":
      break // sair do office é pelo ModeSwitcher/⌘K, nunca pelo Esc
  }
  return out
}

/** Largura padrão do painel direito (dock da mesa/mesa de reunião). Mora aqui
 *  (módulo puro, sem DOM) pra lógica e testes não importarem componentes. */
export const DOCK_W = 380
/** Painel ALARGADO (~560px) enquanto o card de decisão (gate) está visível —
 *  a cena permanece visível ao lado (decisão de design: sem modal). */
export const DOCK_W_WIDE = 560

/** Largura ativa do dock (o OfficeMode usa no screenOffset). */
export function activeDockWidth(wide: boolean): number {
  return wide ? DOCK_W_WIDE : DOCK_W
}

/** Janela do histórico do dock (S2 da investigação de perf): quantos itens a
 *  lista renderiza por padrão. A medição (perf.ts, cenário streaming+dock
 *  aberto) condenou a reconciliação da lista INTEIRA a cada text_delta —
 *  conversa longa ⇒ react:commit de dezenas de ms por delta ⇒ FPS 60→20.
 *  Só a cauda renderiza; "ver tudo" expande sob demanda. */
export const DOCK_ITEMS_WINDOW = 40

/** Índice do 1º item renderizado da lista do dock (puro): cauda de
 *  DOCK_ITEMS_WINDOW itens, ou 0 com "ver tudo" ligado. */
export function dockItemsStart(total: number, showAll: boolean): number {
  return showAll ? 0 : Math.max(0, total - DOCK_ITEMS_WINDOW)
}

/** Balão do boss fica ~3s na tela (fala curta ao enviar da mesa, §5.4 v2). */
export const BOSS_SAY_MS = 3000
/** Fala do boss truncada em 60 chars (balão curto, não transcrição). */
export const BOSS_SAY_MAX = 60

export interface OfficeUiState {
  /** Mesa em alcance (histerese REACH_ENTER/REACH_EXIT da sim). */
  nearDeskId: string | null
  /** Mesa do dock (aberto OU minimizado). null = sem dock. */
  dockDeskId: string | null
  /** Dock minimizado para o chip do HUD (§5.4). */
  dockMinimized: boolean
  /** Conversa da mesa aberta (ensureDeskConversation). null = resolvendo. */
  dockConvId: string | null
  /** Ditado do office em andamento (dono único do mic no modo — §5.5). */
  recording: boolean
  /** Início da gravação corrente (timer mm:ss do pill). null = sem gravação. */
  recordingSince: number | null
  /** Parcial do ditado (legenda ao vivo no balão/composer). */
  dictationPartial: string | null
  cameraMode: CameraMode
  /** Último snapshot discreto do bridge (HUD, badges, custo, deliveries). */
  snapshot: OfficeSnapshot | null
  /** FPS medido (rodapé de debug). null = sem medição. */
  fps: number | null
  /** Fala efêmera do BOSS (balão sobre o avatar ao enviar da mesa). */
  bossSay: { text: string; at: number } | null
  /** Conversa da ÚLTIMA missão lançada da mesa de reunião (O-2). O menu-balão
   *  e o MissionDock leem daqui; null = nenhuma missão lançada dali ainda. */
  missionTableConvId: string | null
  /** Intenção "voar até a sala" emitida pela rail (fora do OfficeMode, sem ref
   *  da câmera). O OfficeMode assina, traduz em inspect e LIMPA (set null).
   *  Sentinelas de áreas comuns: "@commons" (Sala comum) e "@boss" (Central).
   *  Qualquer outro valor é um projectId. */
  focusRoomId: string | null
  /** Intenção "enquadrar a sala do agent + abrir o dock" (a coreografia da
   *  Central) emitida pela rail. Consumida e limpa pelo OfficeMode. */
  focusDeskId: string | null
  /** Intenção "abrir a Central do Boss" vinda do posto de comando físico
   *  (menu-balão da mesa executiva / tecla E — BOSS_DESK_ID). O estado
   *  bossCenterOpen vive no OfficeMode; ele consome e limpa. */
  bossCenterRequested: boolean
  /** Papéis deixados na mesa do Boss (courier de bossDelivery) ainda não
   *  vistos — zera quando a Central abre. A pilha VISUAL de papel na mesa é
   *  da cena (frente ambiente); aqui vive só o contador. */
  unseenDeliveries: number
  /** Agent ESPERANDO DECISÃO na mesa do Boss (gate-visit do pack missão da
   *  cena; espelho discreto de onGateVisitChange). waiting=true = já chegou
   *  e está parado lá — o Prompts acende o balão "✋" e o menu da mesa do
   *  Boss vira "Responder". null = sem visita (mão levantada fica na mesa). */
  gateVisit: GateVisit | null
  /** Nº de cards de gate MONTADOS no dock (push no mount, pop no unmount). */
  dockWideCount: number
  /** Painel direito ALARGADO (DOCK_W_WIDE) — derivado de dockWideCount>0;
   *  o DeskDock/MissionDock usam na largura, o OfficeMode no screenOffset. */
  dockWide: boolean

  setNearDesk: (id: string | null) => void
  /** Abre o dock da mesa (mesma mesa minimizada ⇒ restaura, preservando a
   *  conversa; mesa diferente ⇒ troca e re-resolve a conversa). */
  openDock: (deskId: string) => void
  minimizeDock: () => void
  restoreDock: () => void
  closeDock: () => void
  /** Aplica §5.4: draft/turno ⇒ minimiza; senão fecha. */
  closeOrMinimizeDock: (ctx: DockLeaveCtx) => void
  setDockConv: (convId: string | null) => void
  /** Registra (ou limpa) a conversa da missão lançada da mesa de reunião. */
  setMissionTableConv: (convId: string | null) => void
  /** Rail pede pra voar até uma sala (projectId | "@commons" | "@boss"). Só
   *  seta o campo; o OfficeMode consome no subscribe e limpa. */
  focusRoom: (id: string | null) => void
  /** Rail pede pra enquadrar a sala do agent + abrir o dock (openDeskFromBoss).
   *  Só seta o campo; o OfficeMode consome no subscribe e limpa. */
  focusDesk: (deskId: string | null) => void
  /** Posto de comando pede pra abrir a Central (deskMenuPrimary do
   *  BOSS_DESK_ID). Só seta a flag; o OfficeMode consome e limpa. */
  requestBossCenter: () => void
  clearBossCenterRequest: () => void
  /** Central aberta ⇒ as entregas na mesa do Boss foram vistas. */
  clearUnseenDeliveries: () => void
  /** Gate card montou no dock ⇒ alarga o painel (contagem: dois cards
   *  simultâneos não estreitam no unmount do primeiro). */
  pushDockWide: () => void
  /** Gate card desmontou ⇒ estreita quando o ÚLTIMO sai. */
  popDockWide: () => void
  setRecording: (v: boolean) => void
  setDictationPartial: (t: string | null) => void
  setSnapshot: (s: OfficeSnapshot) => void
  setFps: (v: number | null) => void
  /** Fala curta do boss (truncada em 60 chars; some sozinha em ~3s). */
  sayAsBoss: (text: string) => void
  /** Roteia um SimEvent discreto da sim. `ctx` só importa no near-desk
   *  (decisão §5.4 ao sair do raio da mesa do dock). */
  handleSimEvent: (e: SimEvent, ctx?: DockLeaveCtx) => void
}

export const useOfficeUi = create<OfficeUiState>((set, get) => ({
  nearDeskId: null,
  dockDeskId: null,
  dockMinimized: false,
  dockConvId: null,
  recording: false,
  recordingSince: null,
  dictationPartial: null,
  cameraMode: "follow",
  snapshot: null,
  fps: null,
  bossSay: null,
  missionTableConvId: null,
  focusRoomId: null,
  focusDeskId: null,
  bossCenterRequested: false,
  unseenDeliveries: 0,
  gateVisit: null,
  dockWideCount: 0,
  dockWide: false,

  setNearDesk: (id) => set({ nearDeskId: id }),

  openDock: (deskId) =>
    set((s) =>
      s.dockDeskId === deskId
        ? { dockMinimized: false }
        : { dockDeskId: deskId, dockMinimized: false, dockConvId: null },
    ),

  minimizeDock: () =>
    set((s) => (s.dockDeskId ? { dockMinimized: true } : {})),

  restoreDock: () =>
    set((s) => (s.dockDeskId ? { dockMinimized: false } : {})),

  closeDock: () =>
    set({ dockDeskId: null, dockMinimized: false, dockConvId: null }),

  closeOrMinimizeDock: (ctx) => {
    if (decideDockLeave(ctx) === "minimize") get().minimizeDock()
    else get().closeDock()
  },

  setDockConv: (convId) => set({ dockConvId: convId }),

  setMissionTableConv: (convId) => set({ missionTableConvId: convId }),

  focusRoom: (id) => set({ focusRoomId: id }),

  focusDesk: (deskId) => set({ focusDeskId: deskId }),

  requestBossCenter: () => set({ bossCenterRequested: true }),

  clearBossCenterRequest: () => set({ bossCenterRequested: false }),

  clearUnseenDeliveries: () => set({ unseenDeliveries: 0 }),

  pushDockWide: () =>
    set((s) => ({ dockWideCount: s.dockWideCount + 1, dockWide: true })),

  popDockWide: () =>
    set((s) => {
      const n = Math.max(0, s.dockWideCount - 1)
      return { dockWideCount: n, dockWide: n > 0 }
    }),

  // Parar de gravar limpa a legenda parcial junto (nunca fica órfã).
  setRecording: (v) =>
    set(
      v
        ? { recording: true, recordingSince: Date.now() }
        : { recording: false, recordingSince: null, dictationPartial: null },
    ),

  setDictationPartial: (t) => set({ dictationPartial: t }),

  setSnapshot: (snap) => set({ snapshot: snap }),

  setFps: (v) => set({ fps: v }),

  sayAsBoss: (text) => {
    const t = text.replace(/\s+/g, " ").trim()
    if (!t) return
    const entry = {
      text: t.length > BOSS_SAY_MAX ? `${t.slice(0, BOSS_SAY_MAX)}…` : t,
      at: Date.now(),
    }
    set({ bossSay: entry })
    // TTL aqui no store (fora do render): fala nova supersede — só limpa se a
    // ENTRADA corrente ainda for esta (identidade, não relógio).
    setTimeout(() => {
      if (get().bossSay === entry) set({ bossSay: null })
    }, BOSS_SAY_MS)
  },

  handleSimEvent: (e, ctx = { hasDraft: false, turnActive: false }) => {
    const s = get()
    switch (e.kind) {
      case "near-desk":
      case "arrived-at-desk": {
        // v2 "conversa como cena" (§5.2/§5.3): entrar em alcance OU chegar por
        // clique abre o MENU-BALÃO (derivado de nearDeskId no Prompts) — o dock
        // só abre pela ação primária do menu (clique no botão ou tecla E).
        set({ nearDeskId: e.deskId })
        // Saiu do raio da mesa do dock (ou o alvo trocou de mesa) com o dock
        // ABERTO ⇒ §5.4. Minimizado não mexe: o chip fica até o clique.
        if (s.dockDeskId && !s.dockMinimized && e.deskId !== s.dockDeskId)
          s.closeOrMinimizeDock(ctx)
        break
      }
      case "camera-mode":
        set({ cameraMode: e.mode })
        break
      default: {
        // NUNCA dropar evento desconhecido: se o contrato ganhar um kind novo,
        // o typecheck quebra AQUI (never) e em runtime fica o rastro no console.
        const desconhecido: never = e
        console.warn("[office/ui] SimEvent desconhecido:", desconhecido)
      }
    }
  },
}))

// Courier de missão deixou um papel na mesa do Boss (pack mission da cena):
// contador de não-vistos sobe aqui — ui→scene é a direção de import permitida,
// então a cena só EMITE (onBossDeskDrop) e o store se inscreve uma vez.
onBossDeskDrop(() =>
  useOfficeUi.setState((s) => ({ unseenDeliveries: s.unseenDeliveries + 1 })),
)

// Gate-visit (o agent veio até a mesa do Boss esperar a decisão): espelho
// discreto pro menu "Responder" + balão "✋" do Prompts — mesma direção
// ui→scene do onBossDeskDrop (a cena EMITE; o store se inscreve uma vez).
onGateVisitChange((v) => useOfficeUi.setState({ gateVisit: v }))
