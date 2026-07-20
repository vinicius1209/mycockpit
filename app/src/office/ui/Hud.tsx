// HUD do Agent Office — topo no chrome do spike (office-web) com os tokens do
// app: wordmark pequena, fileira de badges por sala (agregado hand/running/
// idle; clique = câmera inspeciona a sala), chip de custo e chip do dock
// minimizado (§5.4). Rodapé = instrument-strip fino. Tudo aqui re-renderiza
// só por transições discretas (snapshot/eventos), nunca por frame.
import {
  MISSION_TABLE_ID,
  type DeskSnapshot,
  type RoomAggregate,
  type RoomSnapshot,
} from "../engine/types"
import { agentLabel, fmtCost } from "../bridge/hooks"
import { useOfficeUi } from "./store"

/** Cor do agregado da sala (linguagem de semáforo do app). */
const AGG_COLOR: Record<RoomAggregate, string> = {
  hand: "var(--st-queued)", // precisa de você (âmbar da fila — não é o brass)
  running: "var(--st-running)",
  idle: "var(--st-idle)",
}

const AGG_LABEL: Record<RoomAggregate, string> = {
  hand: "precisa de você",
  running: "trabalhando",
  idle: "ocioso",
}

/** Glifo do office (estrela do spike, monocromático em currentColor). */
export function OfficeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true" fill="currentColor">
      <path d="M14 2.5 17 11l8.5 3-8.5 3-3 8.5-3-8.5-8.5-3 8.5-3 3-8.5Z" />
    </svg>
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
  onInspectRoom,
}: {
  /** Badge clicado ⇒ setInspect na sala (modo inspeção da câmera). */
  onInspectRoom: (projectId: string) => void
}) {
  const snapshot = useOfficeUi((s) => s.snapshot)
  const dockDeskId = useOfficeUi((s) => s.dockDeskId)
  const dockMinimized = useOfficeUi((s) => s.dockMinimized)
  const restoreDock = useOfficeUi((s) => s.restoreDock)
  const fps = useOfficeUi((s) => s.fps)

  const rooms = snapshot?.rooms ?? []
  const totalUsd = rooms.reduce((acc, r) => acc + r.costUsd, 0)
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

        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {rooms.map((r) => (
            <button
              key={r.projectId}
              type="button"
              onClick={() => onInspectRoom(r.projectId)}
              title={`${r.name} — ${AGG_LABEL[r.agg]} · inspecionar sala`}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[12px] text-foreground/90 transition-colors hover:border-border-strong hover:text-foreground"
            >
              <span
                className="size-2 rounded-full"
                style={{
                  background: AGG_COLOR[r.agg],
                  boxShadow:
                    r.agg === "hand" ? `0 0 6px ${AGG_COLOR.hand}` : undefined,
                }}
              />
              <span className="max-w-[120px] truncate">{r.name}</span>
            </button>
          ))}
        </div>

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

        <span
          title="Custo acumulado (ledger + missões em voo)"
          className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {totalUsd > 0 ? fmtCost(totalUsd) : "US$ 0,00"}
        </span>
      </header>

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
