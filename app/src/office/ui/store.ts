// Store zustand LOCAL do Agent Office (ui/) — estado de UI do modo, criado
// FORA do componente e testável sem DOM. Alimentado por transições DISCRETAS:
// SimEvent da engine + snapshots do bridge/derive. NUNCA por frame (§7).
// A ui/ não toca stores do app diretamente — leituras/efeitos passam pelo
// bridge/ (dockLeaveCtx, cancelDictation), mocáveis nos testes.
import { create } from "zustand"
import type { CameraMode, OfficeSnapshot, SimEvent } from "../engine/types"
import { dockLeaveCtx } from "../bridge/hooks"
import { cancelDictation } from "../bridge/voice"

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
  dictationPartial: null,
  cameraMode: "follow",
  snapshot: null,
  fps: null,
  bossSay: null,
  missionTableConvId: null,

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

  // Parar de gravar limpa a legenda parcial junto (nunca fica órfã).
  setRecording: (v) =>
    set(v ? { recording: true } : { recording: false, dictationPartial: null }),

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
