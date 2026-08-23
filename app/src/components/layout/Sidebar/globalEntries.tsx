// As 3 entradas GLOBAIS do topo da sidebar (Agendamentos, Planos de voo,
// Frota) — extraído de Sidebar.tsx (arquivo no teto) pelo mesmo motivo de
// store/chat/clone.ts e DiffPanel/comments.tsx: um recorte de responsabilidade
// fechado ("view global cross-projeto, com badge próprio"), não um pedaço
// partido só pra caber no limite. Cada uma abre sua view no lugar do conteúdo
// principal via um `useApp.*Open` PRÓPRIO (não é um viewMode) — abrir uma
// fecha as outras (ver store/app.ts).

import { useEffect, useState } from "react"
import { Clock, Rocket, Route } from "lucide-react"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useSchedules } from "@/store/schedules"

/** F7 — seção GLOBAL "Agendado" no topo da sidebar (acima de PROJETOS,
 *  discreta): coleção cross-projeto das automações do F6. Clique abre a view
 *  no lugar do conteúdo principal (useApp.scheduledOpen — estado próprio, não
 *  mexe no switcher). Badge = próxima execução ("2h"), refrescada a cada 60s. */
export function ScheduledEntry() {
  // selector devolve PRIMITIVO (number|null) — estável entre snapshots.
  const nextAt = useSchedules(
    (s) => nextScheduled(s.schedules)?.nextRun ?? null,
  )
  const active = useApp((s) => s.scheduledOpen)
  const setScheduledOpen = useApp((s) => s.setScheduledOpen)
  // re-render de minuto SÓ quando há badge (o rótulo relativo não pode mofar).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (nextAt == null) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [nextAt])
  return (
    <div>
      <button
        onClick={() => setScheduledOpen(true)}
        aria-label="Abrir Agendamentos"
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-md py-2 pr-2 pl-3 text-left transition-colors",
          // Mesma receita única de "selecionado" das linhas da árvore (§2).
          active ? "bg-sel" : "hover:bg-sel-hover",
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          {/* Ícone ativo NÃO é brass: brass é gesto, e "selecionado" perdeu o
              canal cromático inteiro (ADR-043). */}
          <Clock
            className={cn(
              "size-4",
              active ? "text-foreground" : "text-muted-foreground/70",
            )}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            // S3.6 — ativo em foreground (brass 13px sobre a superfície de
            // seleção reprova AA no claro)
            active
              ? "font-medium text-foreground"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          Agendamentos
        </span>
        {nextAt != null && (
          // "Quando?" tem UM idioma nesta árvore, e ele é neutro: a Fase 1 pôs
          // o tempo relativo da conversa em mono cinza no slot direito, e a
          // próxima execução responde a mesma pergunta na mesma coluna.
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
            {fmtUntilShort(nextAt - Date.now())}
          </span>
        )}
      </button>
    </div>
  )
}

export function FlightPlansEntry() {
  const active = useApp((s) => s.flightPlansOpen)
  const setFlightPlansOpen = useApp((s) => s.setFlightPlansOpen)
  const count = useApp((s) => s.settings.missionPresets.length)
  return (
    <button
      onClick={() => setFlightPlansOpen(true)}
      aria-label="Abrir Planos de voo"
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-md py-2 pr-2 pl-3 text-left transition-colors",
        active ? "bg-sel" : "hover:bg-sel-hover",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Route
          className={cn(
            "size-4",
            active ? "text-foreground" : "text-muted-foreground/70",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        Planos de voo
      </span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">
        {count}
      </span>
    </button>
  )
}

/** Rollup "Frota" (F-cross-sessão): tudo que está rodando agora, em qualquer
 *  projeto. Badge = contagem de conversas rodando (0 = sem badge, some
 *  sozinho). Contagem é primitivo direto — `running` não pisca a cada delta
 *  de streaming, então não precisa da chave-string estável dos outros hooks. */
export function FleetEntry() {
  const active = useApp((s) => s.fleetOpen)
  const setFleetOpen = useApp((s) => s.setFleetOpen)
  const runningCount = useChat(
    (s) => Object.values(s.byId).filter((c) => c.running).length,
  )
  return (
    <button
      onClick={() => setFleetOpen(true)}
      aria-label="Abrir Frota"
      className={cn(
        "group relative flex w-full items-center gap-2.5 rounded-md py-2 pr-2 pl-3 text-left transition-colors",
        active ? "bg-sel" : "hover:bg-sel-hover",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Rocket
          className={cn(
            "size-4",
            active ? "text-foreground" : "text-muted-foreground/70",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        Frota
      </span>
      {runningCount > 0 && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/65">
          {runningCount}
        </span>
      )}
    </button>
  )
}
