// Menu-balão de proximidade (§5.2 v2 — "conversa como cena"): balão DOM
// ancorado na mesa (ponteiro pra ela), conteúdo por ESTADO da mesa. Substitui
// o prompt seco "E — falar". A POSIÇÃO é do Prompts (mesmo mecanismo de
// anchors, translate3d no rAF); aqui só estrutura + ações. Aparece quando a
// mesa entra em alcance (nearDeskId) e some ao sair do raio ou abrir o dock.
//
// Ações: TODAS as primárias abrem o dock (Conversar/Abrir/Responder/
// Acompanhar) — a tecla E do OfficeMode chama deskMenuPrimary. "Parar" é a
// única secundária com efeito próprio (cancelDeskTurn).
import { useEffect, useRef, useState } from "react"
import { Hand, MessageCircle, Rocket, Square } from "lucide-react"
import type {
  DeskPlacement,
  DeskSnapshot,
  DeskVisualState,
} from "../engine/types"
import {
  agentCssColor,
  agentLabel,
  fmtCost,
  useDeskContinueTitle,
  useDeskMissionCost,
  useDeskMissionRecovery,
  useDeskMissionRunning,
  useDeskTurnStartedAt,
} from "../bridge/hooks"
import { cancelDeskTurn, DESK_TITLE_PREFIX } from "../bridge/send"
import { useMissionTableSig } from "../bridge/mission"
import { MISSION_TABLE_ID, missionTableMenu, parseMissionSig } from "./missionTable"
import { useOfficeUi } from "./store"

// --- lógica pura (testável sem DOM) ----------------------------------------

export type DeskMenuKind = "off" | "idle" | "running" | "hand" | "mission"

/** Que menu a mesa pede? hand vence (gate/approval mostram "Responder" mesmo
 *  dentro de missão); typing/thinking numa conversa de missão ⇒ "mission".
 *  `recoveryPending` (uma fase parou num limite recuperável e o motor aguarda a
 *  troca de agent) sobe pra "hand" mesmo que o derive ainda pinte a mesa como
 *  trabalhando — mesmo tratamento do gate ("Precisa de você"). */
export function deskMenuKind(
  state: DeskVisualState | undefined,
  missionRunning: boolean,
  recoveryPending = false,
): DeskMenuKind {
  if (recoveryPending) return "hand"
  switch (state) {
    case "off":
      return "off"
    case "hand":
      return "hand"
    case "typing":
    case "thinking":
      return missionRunning ? "mission" : "running"
    default:
      return "idle"
  }
}

/** AÇÃO PRIMÁRIA do menu (tecla E do OfficeMode e botão principal): abre o
 *  dock da mesa — pro estado hand, o card do gate/approval já está no fio. */
export function deskMenuPrimary(deskId: string): void {
  useOfficeUi.getState().openDock(deskId)
}

// --- pedaços ----------------------------------------------------------------

/** Relógio decorrido "12s"/"1m05s" (tick de 1s local ao componente). */
export function ElapsedSince({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <span className="tabular-nums">
      {s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`}
    </span>
  )
}

function PrimaryButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brass px-2.5 py-1.5 text-[12px] font-medium text-brass-foreground transition-opacity hover:opacity-90"
    >
      <kbd className="rounded-sm border border-brass-foreground/30 px-1 font-mono text-[10px] font-semibold">
        E
      </kbd>
      {children}
    </button>
  )
}

// --- menu da MESA DE REUNIÃO (O-2 — lançar missão da sala comum) ------------

/** Balão da mesa de reunião: sem missão rodando lançada dali ⇒ "Lançar
 *  missão"; com missão ⇒ andamento (fase X/N) + "Acompanhar". As duas ações
 *  primárias abrem o MissionDock (deskMenuPrimary — mesma tecla E). */
export function MissionTableMenu() {
  const missionConvId = useOfficeUi((s) => s.missionTableConvId)
  const menu = missionTableMenu(parseMissionSig(useMissionTableSig(missionConvId)))
  const open = () => deskMenuPrimary(MISSION_TABLE_ID)

  return (
    <div className="pointer-events-auto relative w-max max-w-[250px] rounded-lg border border-border bg-card px-3 pt-2 pb-2.5 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-safe:ease-out">
      <div className="mb-1.5 flex items-center gap-1.5">
        <Rocket className="size-3 text-brass" />
        <span className="text-[12px] font-semibold text-foreground">
          Mesa de reunião
        </span>
        {menu.kind === "running" && (
          <span className="text-[11px] text-st-running">· em missão</span>
        )}
      </div>

      {menu.kind === "launch" ? (
        <PrimaryButton onClick={open}>
          <Rocket className="size-3.5" />
          Lançar missão
        </PrimaryButton>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[12px] text-foreground/90">
            <span className="size-1.5 shrink-0 rounded-full bg-st-running motion-safe:animate-pulse" />
            <span className="truncate">
              Missão em andamento · fase {menu.phase}/{menu.total}
            </span>
          </div>
          <PrimaryButton onClick={open}>Acompanhar</PrimaryButton>
        </div>
      )}

      {/* ponteiro do balão → mesa */}
      <span className="absolute -bottom-[6px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-r border-b border-border bg-card" />
    </div>
  )
}

// --- o menu -----------------------------------------------------------------

export function DeskMenu({
  desk,
  snap,
}: {
  desk: DeskPlacement
  /** Snapshot da mesa (estado vivo); ausente = trata como idle. */
  snap?: DeskSnapshot
}) {
  const convId = snap?.convId ?? null
  const missionRunning = useDeskMissionRunning(convId)
  const missionCost = useDeskMissionCost(convId)
  const recoveryPending = useDeskMissionRecovery(convId)
  const startedAt = useDeskTurnStartedAt(convId)
  const continueTitle = useDeskContinueTitle(desk.projectId, desk.agent)
  // Fallback do relógio fora do Tauri (fixture): conta desde que o menu viu o
  // turno — melhor um relógio local que nenhum mini-status vivo.
  const seenAtRef = useRef(Date.now())

  const kind = deskMenuKind(snap?.state, missionRunning, recoveryPending)
  const name = desk.agentName ?? agentLabel(desk.agent)
  const color = agentCssColor(desk.agent)
  const open = () => deskMenuPrimary(desk.id)

  const continueShort = continueTitle
    ? continueTitle.replace(DESK_TITLE_PREFIX, "").slice(0, 24)
    : null

  return (
    <div className="pointer-events-auto relative w-max max-w-[250px] rounded-lg border border-border bg-card px-3 pt-2 pb-2.5 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-safe:ease-out">
      {/* cabeçalho: quem mora nesta mesa */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ background: color }} />
        <span className="text-[12px] font-semibold text-foreground">{name}</span>
        {kind === "running" && (
          <span className="text-[11px] text-st-running">· trabalhando</span>
        )}
        {kind === "mission" && (
          <span className="text-[11px] text-st-running">· em missão</span>
        )}
      </div>

      {kind === "off" && (
        <p className="max-w-[210px] text-[12px] leading-snug text-muted-foreground">
          CLI não detectada — habilite nos Ajustes para acender esta mesa.
        </p>
      )}

      {kind === "idle" && (
        <div className="flex flex-col gap-1.5">
          <PrimaryButton onClick={open}>
            <MessageCircle className="size-3.5" />
            Conversar
          </PrimaryButton>
          {continueShort && (
            <button
              type="button"
              onClick={open}
              className="truncate rounded-md border border-border bg-background px-2.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
            >
              Continuar · {continueShort}
            </button>
          )}
        </div>
      )}

      {(kind === "running" || kind === "mission") && (
        <div className="flex flex-col gap-1.5">
          {/* mini-status vivo: ferramenta/persona + tempo + custo da missão */}
          <div className="flex items-center gap-1.5 text-[12px] text-foreground/90">
            <span className="size-1.5 shrink-0 rounded-full bg-st-running motion-safe:animate-pulse" />
            <span className="truncate">
              {kind === "mission"
                ? (snap?.label ?? "Em missão")
                : (snap?.detail ? `⚙ ${snap.detail}` : (snap?.label ?? "Pensando"))}
            </span>
            <span className="shrink-0 text-muted-foreground">
              · <ElapsedSince since={startedAt ?? seenAtRef.current} />
              {missionCost != null && missionCost > 0 && (
                <> · {fmtCost(missionCost)}</>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <PrimaryButton onClick={open}>
              {kind === "mission" ? "Acompanhar" : "Abrir"}
            </PrimaryButton>
            {kind === "running" && convId && (
              <button
                type="button"
                title="Parar o turno"
                onClick={() => void cancelDeskTurn(convId)}
                className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-st-error transition-colors hover:bg-secondary"
              >
                <Square className="size-3" />
                Parar
              </button>
            )}
          </div>
        </div>
      )}

      {kind === "hand" && (
        <div className="flex flex-col gap-1.5">
          <p className="max-w-[210px] text-[12px] leading-snug text-st-queued">
            {recoveryPending ? (
              <>Precisa de você · a fase parou num limite, escolha quem retoma</>
            ) : (
              <>
                {snap?.label ?? "Precisa de você"}
                {snap?.detail ? ` · ${snap.detail}` : ""}
              </>
            )}
          </p>
          <PrimaryButton onClick={open}>
            <Hand className="size-3.5" />
            {recoveryPending ? "Retomar" : "Responder"}
          </PrimaryButton>
        </div>
      )}

      {/* ponteiro do balão → mesa */}
      <span className="absolute -bottom-[6px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 border-r border-b border-border bg-card" />
    </div>
  )
}
