// HUD do Agent Office — topo no chrome do spike office-web (arquivado em
// docs/archive/office-web-spike.zip) com os tokens do
// app: wordmark pequena, botão Central (👑 — briefing + missão), pílula de
// custo TOTAL e chip do dock minimizado (§5.4). A NAVEGAÇÃO de sala vive 100%
// na rail (Sidebar), incl. áreas comuns — o topo não repete badges. Rodapé =
// instrument-strip fino. Tudo aqui re-renderiza só por transições discretas
// (snapshot/eventos), nunca por frame.
import {
  MISSION_TABLE_ID,
  type DeskSnapshot,
  type RoomSnapshot,
} from "@/lib/fleet/types"
import { Crown, Volume2, VolumeX } from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { agentLabel, fmtCost } from "../bridge/hooks"
import { getPerfReport, perfEnabled, type PerfReport } from "@/lib/fleet/perf"
import { BOSS_CENTER_ID, BOSS_CENTER_TRIGGER_ID } from "./BossCenter"
import { setSoundEnabled, soundEnabled } from "./sound"
import { useOfficeUi } from "./store"

/** Glifo do office (estrela do spike, monocromático em currentColor). */
export function OfficeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" fill="currentColor">
      <path d="M14 2.5 17 11l8.5 3-8.5 3-3 8.5-3-8.5-8.5-3 8.5-3 3-8.5Z" />
    </svg>
  )
}

/** Overlay de telemetria (só monta com mc.office.perf/?perf=1): fps, pior
 *  frame da janela de 5s, hitches no ring e top-3 spans acumulados — refresh
 *  1Hz via getPerfReport (nunca por frame). Botão copia o relatório inteiro
 *  (ring + p50/p95/max por segundo + totais) como JSON. */
function PerfOverlay({ fps }: { fps: number | null }) {
  const [report, setReport] = useState<PerfReport>(() => getPerfReport())
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const t = setInterval(() => setReport(getPerfReport()), 1000)
    return () => clearInterval(t)
  }, [])
  const worst5s = report.seconds
    .slice(-5)
    .reduce((max, s) => Math.max(max, s.max), 0)
  const top3 = report.totals.slice(0, 3)
  const copy = () => {
    navigator.clipboard
      .writeText(JSON.stringify(getPerfReport(), null, 2))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }
  return (
    <div className="pointer-events-auto absolute right-2 bottom-8 z-30 w-60 rounded-md border border-border bg-background/95 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground shadow-lg select-none">
      <p className="mb-1 font-semibold tracking-[0.08em] text-foreground uppercase">
        perf
      </p>
      <div className="flex justify-between tabular-nums">
        <span>fps</span>
        <span>{fps ?? "—"}</span>
      </div>
      <div className="flex justify-between tabular-nums">
        <span>pior frame (5s)</span>
        <span>{Math.round(worst5s)}ms</span>
      </div>
      <div className="flex justify-between tabular-nums">
        <span>hitches (&gt;50ms)</span>
        <span>{report.hitches.length}</span>
      </div>
      {top3.length > 0 && (
        <div className="mt-1 border-t border-border/60 pt-1">
          {top3.map((t) => (
            <div key={t.name} className="flex justify-between gap-2 tabular-nums">
              <span className="truncate">{t.name}</span>
              <span className="shrink-0">
                {Math.round(t.ms)}ms·{t.count}×
              </span>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={copy}
        className="mt-1.5 w-full rounded border border-border bg-card px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-secondary"
      >
        {copied ? "copiado ✓" : "copiar relatório"}
      </button>
    </div>
  )
}

function findDesk(
  rooms: RoomSnapshot[],
  deskId: string,
): { desk: DeskSnapshot; room: RoomSnapshot } | null {
  for (const room of rooms)
    for (const desk of room.desks) if (desk.id === deskId) return { desk, room }
  return null
}

export function Hud({
  onOpenBossCenter,
  bossCenterOpen,
}: {
  /** Abre o briefing operacional agregado do escritório. */
  onOpenBossCenter: () => void
  bossCenterOpen: boolean
}) {
  const snapshot = useOfficeUi((s) => s.snapshot)
  const dockDeskId = useOfficeUi((s) => s.dockDeskId)
  const dockMinimized = useOfficeUi((s) => s.dockMinimized)
  const restoreDock = useOfficeUi((s) => s.restoreDock)
  const fps = useOfficeUi((s) => s.fps)
  // sons discretos do escritório (opt-in, default OFF — ui/sound.ts é a fonte)
  const [soundOn, setSoundOn] = useState(soundEnabled)

  const rooms = snapshot?.rooms ?? []
  const totalUsd = rooms.reduce((acc, r) => acc + r.costUsd, 0)
  const attentionCount = rooms.reduce(
    (total, room) =>
      total + room.desks.filter((desk) => desk.state === "hand").length,
    0,
  )
  // chip do dock minimizado: mesa de agent OU a mesa de reunião (O-2 — o id
  // não está em rooms[].desks, senão o chip sumiria e o dock ficaria órfão)
  const missionMinimized = dockMinimized && dockDeskId === MISSION_TABLE_ID
  const minimized =
    dockMinimized && dockDeskId && !missionMinimized
      ? findDesk(rooms, dockDeskId)
      : null

  return (
    <>
      <header className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-3 border-b border-border/60 bg-background px-3">
        <div className="flex shrink-0 items-center gap-2 select-none">
          <OfficeMark className="size-4 text-brass" />
          <div className="leading-none">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              Frota
            </p>
            <h1 className="mt-0.5 text-[13px] font-semibold tracking-[-0.01em] text-foreground">
              Agent Office
            </h1>
          </div>
        </div>

        {/* A navegação de sala migrou 100% para a rail (Sidebar); o topo só
            segura o espaço até as ações/leituras à direita. */}
        <div className="min-w-0 flex-1" />

        <button
          id={BOSS_CENTER_TRIGGER_ID}
          type="button"
          onClick={onOpenBossCenter}
          aria-controls={BOSS_CENTER_ID}
          aria-expanded={bossCenterOpen}
          aria-label={`${bossCenterOpen ? "Fechar" : "Abrir"} Central do Boss${
            attentionCount > 0
              ? `, ${attentionCount} ${attentionCount === 1 ? "item requer" : "itens requerem"} sua atenção`
              : ""
          }`}
          className={cn(
            // BOTÃO de verdade: preenchido e com hover próprio, destacado da
            // pílula de custo (passiva, só leitura). Brass = identidade do boss.
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            bossCenterOpen
              ? "border-brass bg-brass text-brass-foreground"
              : "border-brass/40 bg-brass-soft text-brass hover:border-brass/70 hover:bg-brass hover:text-brass-foreground",
          )}
        >
          <Crown className="size-3.5" aria-hidden="true" />
          <span>Central</span>
          {attentionCount > 0 && (
            <span className="min-w-4 rounded-full bg-st-queued px-1 text-center font-mono text-[9px] leading-4 text-white tabular-nums">
              {attentionCount}
            </span>
          )}
        </button>

        {missionMinimized && (
          <button
            type="button"
            onClick={restoreDock}
            title="Restaurar a mesa de reunião (missões)"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-brass/60 bg-brass-soft px-2.5 py-1 text-[12px] font-medium text-brass transition-colors hover:border-brass"
          >
            <span className="size-1.5 rounded-full bg-brass motion-safe:animate-pulse" />
            <span className="max-w-[160px] truncate">Mesa de reunião</span>
          </button>
        )}

        {minimized && (
          <button
            type="button"
            onClick={restoreDock}
            title="Restaurar a conversa da mesa"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-brass/60 bg-brass-soft px-2.5 py-1 text-[12px] font-medium text-brass transition-colors hover:border-brass"
          >
            <span className="size-1.5 rounded-full bg-brass motion-safe:animate-pulse" />
            <span className="max-w-[160px] truncate">
              {agentLabel(minimized.desk.agent)} · {minimized.room.name}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            const next = !soundOn
            setSoundEnabled(next) // persiste + (ligando) sino de confirmação
            setSoundOn(next)
          }}
          aria-pressed={soundOn}
          aria-label={soundOn ? "Desativar sons do escritório" : "Ativar sons do escritório"}
          title={
            soundOn
              ? "Sons do escritório ligados (discretos)"
              : "Sons do escritório desligados"
          }
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            soundOn
              ? "border-brass/50 bg-brass-soft text-brass hover:border-brass/80"
              : "border-border bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {soundOn ? (
            <Volume2 className="size-3.5" aria-hidden="true" />
          ) : (
            <VolumeX className="size-3.5" aria-hidden="true" />
          )}
        </button>

        <span
          title="Custo acumulado (ledger + missões em voo)"
          className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {totalUsd > 0 ? fmtCost(totalUsd) : "US$ 0,00"}
        </span>
      </header>

      {perfEnabled() && <PerfOverlay fps={fps} />}

      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-6 items-center justify-between border-t border-border/60 bg-background px-3 text-[10px] tracking-[0.08em] text-muted-foreground uppercase select-none">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-st-success" />
          Office · local
        </span>
        <span className="flex items-center gap-3 tabular-nums">
          {fps != null && <span>{fps} fps</span>}
          <span>
            {rooms.length} {rooms.length === 1 ? "sala" : "salas"}
          </span>
        </span>
      </footer>
    </>
  )
}
