// As entradas GLOBAIS do topo da sidebar (Painel, Frota, Agendamentos, Planos
// de voo), desde a ADR-245 como LADRILHOS numa faixa de quatro — extraído de Sidebar.tsx (arquivo no teto) pelo mesmo motivo de
// store/chat/clone.ts e DiffPanel/comments.tsx: um recorte de responsabilidade
// fechado ("view global cross-projeto, com badge próprio"), não um pedaço
// partido só pra caber no limite. Cada uma abre sua view no lugar do conteúdo
// principal via um `useApp.*Open` PRÓPRIO (não é um viewMode) — abrir uma
// fecha as outras (ver store/app.ts).

import { useEffect, useState } from "react"
import { Clock, Gauge, Rocket, Route } from "lucide-react"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
import { Ladrilho } from "@/components/ui/ladrilho"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useSchedules } from "@/store/schedules"

/** F7 — Agendamentos: coleção cross-projeto das automações do F6. Clique abre
 *  a view no lugar do conteúdo principal (useApp.scheduledOpen, estado próprio,
 *  não mexe no switcher). Contador = próxima execução ("2h"), refrescada a
 *  cada 60s. */
export function ScheduledEntry() {
  // selector devolve PRIMITIVO (number|null) — estável entre snapshots.
  const nextAt = useSchedules(
    (s) => nextScheduled(s.schedules)?.nextRun ?? null,
  )
  const active = useApp((s) => s.scheduledOpen)
  const setScheduledOpen = useApp((s) => s.setScheduledOpen)
  // re-render de minuto SÓ quando há contador (o rótulo relativo não pode mofar).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (nextAt == null) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [nextAt])
  return (
    <Ladrilho
      icone={<Clock />}
      rotulo="Agenda"
      titulo={nextAt != null ? `Abrir Agendamentos · próxima em ${fmtUntilShort(nextAt - Date.now())}` : "Abrir Agendamentos"}
      ativo={active}
      contador={nextAt != null ? fmtUntilShort(nextAt - Date.now()) : null}
      onClick={() => setScheduledOpen(true)}
    />
  )
}

export function FlightPlansEntry() {
  const active = useApp((s) => s.flightPlansOpen)
  const setFlightPlansOpen = useApp((s) => s.setFlightPlansOpen)
  const count = useApp((s) => s.settings.missionPresets.length)
  return (
    <Ladrilho
      icone={<Route />}
      rotulo="Planos"
      titulo="Abrir Planos de voo"
      ativo={active}
      contador={count}
      onClick={() => setFlightPlansOpen(true)}
    />
  )
}

/** Rollup "Frota" (F-cross-sessão): tudo que está rodando agora, em qualquer
 *  projeto. Contador = conversas rodando (0 some sozinho). Contagem é
 *  primitivo direto: `running` não pisca a cada delta de streaming. */
export function FleetEntry() {
  const active = useApp((s) => s.fleetOpen)
  const setFleetOpen = useApp((s) => s.setFleetOpen)
  const runningCount = useChat(
    (s) => Object.values(s.byId).filter((c) => c.running).length,
  )
  return (
    <Ladrilho
      icone={<Rocket />}
      rotulo="Frota"
      titulo="Abrir Frota"
      ativo={active}
      contador={runningCount}
      onClick={() => setFleetOpen(true)}
    />
  )
}

/** Painel pertence à navegação global; Trabalho é o destino de projeto/conversa. */
export function PanelEntry() {
  const active = useApp((s) => s.viewMode === "painel" && !s.scheduledOpen && !s.flightPlansOpen && !s.fleetOpen)
  return (
    <Ladrilho
      icone={<Gauge />}
      rotulo="Painel"
      titulo="Abrir Painel"
      ativo={active}
      onClick={() => useApp.getState().setViewMode("painel")}
    />
  )
}
