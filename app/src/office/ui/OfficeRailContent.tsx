// Rail nativa do Escritório — substitui a lista "Projetos" da Sidebar quando
// viewMode === "office" (o shell da coluna, Agendado + footer, fica). Índice
// ESPACIAL da cena (não pastas de arquivo): "Precisa de você" no topo, depois
// as Salas (projetos) com sua Equipe. Clicar num agent abre o dock de conversa
// (openDock — o DeskDock reage), o mesmo "clicar pra falar" do Gather, sem
// precisar andar. Lê só do store limpo (useOfficeUi.snapshot); zero acoplamento
// com o WIP do outro dev (colisão/objetos, BossCenter).
//
// Enhancement combinado com o outro dev (não feito aqui p/ não tocar no
// OfficeMode): clicar numa Sala mover a câmera até ela (inspectRoom vive no
// OfficeMode, via um focusRoomId no store). Por ora, a Sala só expande/recolhe.
import { useState } from "react"
import { ChevronRight, Hand, Building2, Coffee, Crown } from "lucide-react"
import { agentLabel } from "@/lib/agent"
import { fmtCost } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DeskSnapshot, DeskVisualState, RoomSnapshot } from "../engine/types"
import { useOfficeUi } from "./store"

/** Cor do dot por estado da mesa (mesma linguagem de semáforo do HUD/dock). */
function stateColor(state: DeskVisualState): string {
  switch (state) {
    case "typing":
    case "thinking":
      return "var(--st-running)"
    case "hand":
      return "var(--st-queued)"
    case "off":
      return "color-mix(in srgb, var(--st-idle) 40%, transparent)"
    default:
      return "var(--st-idle)"
  }
}

/** Cor do dot agregado da sala (luz da porta). */
function aggColor(agg: RoomSnapshot["agg"]): string {
  if (agg === "hand") return "var(--st-queued)"
  if (agg === "running") return "var(--st-running)"
  return "var(--st-idle)"
}

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", pulse && "animate-pulse")}
      style={{ background: color }}
      aria-hidden="true"
    />
  )
}

/** Linha de agent clicável — ENQUADRA a sala do agent e abre o dock de conversa
 *  (focusDesk → OfficeMode.openDeskFromBoss). Não abre o dock "às cegas": a
 *  câmera acompanha, corrigindo o "falar com quem você não vê". */
function AgentRow({ desk }: { desk: DeskSnapshot }) {
  const focusDesk = useOfficeUi((s) => s.focusDesk)
  const off = desk.state === "off"
  const detail = desk.detail ? `${desk.label} · ${desk.detail}` : desk.label
  return (
    <button
      type="button"
      disabled={off}
      onClick={() => focusDesk(desk.id)}
      title={
        off
          ? `${agentLabel(desk.agent)} · ${detail}`
          : `Falar com ${agentLabel(desk.agent)}`
      }
      aria-label={`${agentLabel(desk.agent)}: ${detail}. Abrir conversa.`}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        off
          ? "cursor-default opacity-45"
          : "hover:bg-accent hover:text-foreground",
      )}
    >
      <StatusDot color={stateColor(desk.state)} pulse={desk.state === "hand"} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-foreground/90">
          {agentLabel(desk.agent)}
        </span>
        {/* Mesa apagada mostra o MOTIVO real do snapshot ("Não detectado",
            "Instalado, sem login", "Em rate limit · volta …") — auth honesta. */}
        <span className="block truncate text-[11px] text-muted-foreground">
          {detail}
        </span>
      </span>
      {desk.state === "hand" && (
        <Hand className="size-3.5 shrink-0 text-st-queued" />
      )}
    </button>
  )
}

/** Seção de uma sala (projeto): cabeçalho + equipe. O chevron RECOLHE/expande;
 *  clicar no NOME VOA a câmera até a sala (focusRoom) — duas ações separadas. */
function RoomSection({ room }: { room: RoomSnapshot }) {
  const [open, setOpen] = useState(true)
  const focusRoom = useOfficeUi((s) => s.focusRoom)
  return (
    <div className="flex flex-col">
      <div className="flex w-full items-center rounded-md pr-2 transition-colors hover:bg-accent/60">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? "Recolher" : "Expandir"} equipe de ${room.name}`}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => focusRoom(room.projectId)}
          title={`Voar até ${room.name}`}
          aria-label={`Ir até a sala ${room.name}`}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
        >
          <StatusDot color={aggColor(room.agg)} pulse={room.agg === "hand"} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
            {room.name}
          </span>
          {room.costUsd > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {fmtCost(room.costUsd)}
            </span>
          )}
        </button>
      </div>
      {open && (
        <div className="ml-3.5 flex flex-col border-l border-border/60 pl-1.5">
          {room.desks.map((d) => (
            <AgentRow key={d.id} desk={d} />
          ))}
        </div>
      )}
    </div>
  )
}

export function OfficeRailContent() {
  const snapshot = useOfficeUi((s) => s.snapshot)
  const focusDesk = useOfficeUi((s) => s.focusDesk)
  const focusRoom = useOfficeUi((s) => s.focusRoom)
  const rooms = snapshot?.rooms ?? []

  // "Precisa de você": mesas com a mão levantada, cross-sala, no topo (a coisa
  // mais urgente do escritório — some quando não há nenhuma).
  const attention = rooms.flatMap((r) =>
    r.desks
      .filter((d) => d.state === "hand")
      .map((d) => ({ desk: d, room: r })),
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Building2 className="size-4 text-muted-foreground" />
        <span className="label-mono">Escritório</span>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {rooms.length} {rooms.length === 1 ? "sala" : "salas"}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {rooms.length === 0 ? (
          <p className="mt-10 px-2 text-center text-[13px] text-muted-foreground">
            Aguardando o escritório…
          </p>
        ) : (
          <>
            {attention.length > 0 && (
              <section className="mb-3">
                <p className="px-2 py-1 text-[11px] font-medium tracking-wide text-st-queued uppercase">
                  Precisa de você
                </p>
                <div className="flex flex-col">
                  {attention.map(({ desk, room }) => (
                    <button
                      key={desk.id}
                      type="button"
                      onClick={() => focusDesk(desk.id)}
                      aria-label={`${agentLabel(desk.agent)} em ${room.name} precisa de você. Responder.`}
                      className="flex w-full items-center gap-2 rounded-md border border-st-queued/30 bg-st-queued/10 px-2 py-1.5 text-left transition-colors hover:bg-st-queued/15"
                    >
                      <Hand className="size-3.5 shrink-0 text-st-queued" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-foreground">
                          {agentLabel(desk.agent)}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {room.name} · {desk.label}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <p className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Salas
            </p>
            <div className="flex flex-col gap-0.5">
              {rooms.map((r) => (
                <RoomSection key={r.projectId} room={r} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Áreas comuns FIXAS na base (fora da rolagem): destinos globais que
          existem sempre — um clique, sem rolar os N projetos das Salas. */}
      <div className="shrink-0 border-t border-border/60 px-2 py-2">
        <p className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Áreas comuns
        </p>
        <button
          type="button"
          onClick={() => focusRoom("@commons")}
          title="Voar até a Sala comum"
          aria-label="Ir até a Sala comum"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-foreground"
        >
          <Coffee className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
            Sala comum
          </span>
        </button>
        <button
          type="button"
          onClick={() => focusRoom("@boss")}
          title="Voar até a Sala do Boss"
          aria-label="Ir até a Sala do Boss"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-foreground"
        >
          <Crown className="size-4 shrink-0 text-brass" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
            Sala do Boss
          </span>
        </button>
      </div>
    </div>
  )
}
