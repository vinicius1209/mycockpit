// <UsagePill> — pill ÚNICA agregada do medidor de janela de uso na barra
// superior (a feature "9% used · 4h 22m" do estudo do Orca), com popover de
// detalhe por provider. Fonte única: useUsage (snapshots com procedência) +
// a política de lib/usageWindow. Camadas de esconder (Orca):
//   1. motor sem capability nem aparece (usageWindowAgents);
//   2. provider não-configurado/não-logado/sem dado: some;
//   3. provider configurado FALHANDO: VISÍVEL com estado honesto ("falhando
//      desde X"), senão a UI tremula entre aparecer e sumir;
//   4. CTA de instalação dispensável, com o dispensado persistido.
// Barra CINZA até 60% (uso normal não pede atenção), âmbar 60 a 80, vermelha
// 80+ (constantes USAGE_WARN_PCT/USAGE_DANGER_PCT). Números em tabular-nums
// com largura reservada; nome trunca antes do número.

import { useEffect, useState } from "react"
import { Gauge, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usageWindowAgents } from "@/lib/agents"
import { fmtTime } from "@/lib/format"
import {
  fmtAge,
  fmtPct,
  fmtResetIn,
  snapshotUsable,
  usageTone,
  worstWindow,
  type UsageFailure,
  type UsageSnapshot,
} from "@/lib/usageWindow"
import { useApp } from "@/store/app"
import { useUsage } from "@/store/usage"
import { cn } from "@/lib/utils"

const TONE_BAR: Record<string, string> = {
  ok: "bg-muted-foreground/45",
  warn: "bg-st-warning",
  danger: "bg-st-error",
}
const TONE_TEXT: Record<string, string> = {
  ok: "text-muted-foreground",
  warn: "text-st-warning",
  danger: "text-st-error",
}

/** Barra fina de percentual (cinza até 60, âmbar 60 a 80, vermelha 80+). */
function UsageBar({ pct, wide = false }: { pct: number; wide?: boolean }) {
  const tone = usageTone(pct)
  return (
    <span
      aria-hidden
      className={cn(
        "relative h-1 shrink-0 overflow-hidden rounded-full bg-secondary",
        wide ? "w-24" : "w-8",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full", TONE_BAR[tone])}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  )
}

/** Rótulo humano da fonte (procedência na cara, sem jargão de RPC). */
function sourceLabel(source: string): string {
  return source === "rpc" ? "leitura local" : "statusline"
}

/** Detalhe de UM provider no popover. */
function ProviderRows({
  label,
  snap,
  failure,
  now,
}: {
  label: string
  snap: UsageSnapshot | undefined
  failure: UsageFailure | undefined
  now: number
}) {
  const usable = snap != null && snapshotUsable(snap, failure, now)
  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-[12px] text-foreground">
          {label}
          {snap?.planType ? (
            <span className="text-muted-foreground"> · plano {snap.planType}</span>
          ) : null}
        </span>
        {snap && (
          <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground/70">
            {sourceLabel(snap.source)} · {fmtAge(snap.fetchedAt, now)}
          </span>
        )}
      </div>
      {usable &&
        snap.windows.map((w) => {
          const reset = fmtResetIn(w.resetsAt, now)
          return (
            <div key={w.id} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-muted-foreground">
                {w.label}
              </span>
              <UsageBar pct={w.usedPercent} wide />
              <span
                className={cn(
                  "min-w-[34px] shrink-0 text-right font-mono text-[11px] tabular-nums",
                  TONE_TEXT[usageTone(w.usedPercent)],
                )}
              >
                {fmtPct(w.usedPercent)}
              </span>
              <span className="min-w-0 truncate text-[10.5px] text-muted-foreground/70">
                {reset ?? ""}
              </span>
            </div>
          )
        })}
      {snap && !usable && (
        <p className="text-[11px] text-muted-foreground">
          Sem dados frescos, última leitura {fmtAge(snap.fetchedAt, now)}.
        </p>
      )}
      {failure && (
        <p className="text-[11px] text-st-error">
          Falhando desde {fmtTime(failure.since)} ({failure.kind}).
        </p>
      )}
    </div>
  )
}

export function UsagePill() {
  const enabled = useApp((s) => s.settings.usageMeterEnabled)
  const ctaDismissed = useApp((s) => s.settings.usageMeterCtaDismissed)
  const setSettings = useApp((s) => s.setSettings)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const byAgent = useUsage((s) => s.byAgent)
  const failures = useUsage((s) => s.failures)

  // idade/staleness passam sem evento de store: relógio local de 30s (mesma
  // granularidade do tick do vigia), só pra re-render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!enabled) return null
  const worst = worstWindow(byAgent, failures, now)
  const failing = Object.keys(failures).length > 0
  // nada medido e nada falhando: a pill SOME (não-configurado se esconde;
  // configurado-com-erro fica visível no ramo abaixo).
  if (!worst && !failing) return null

  const providers = usageWindowAgents()
  const measurable = providers.filter(
    (d) => byAgent[d.id] != null || failures[d.id] != null,
  )
  // CTA: provider de statusline ainda sem NENHUM snapshot (medidor não
  // instalado ou sem turno desde o boot) — só aparece com a pill já viva
  // (snapshots assentados) e some pra sempre se dispensado.
  const ctaAgents = ctaDismissed
    ? []
    : providers.filter(
        (d) => d.usageWindow === "statusline" && byAgent[d.id] == null,
      )

  const tone = worst ? usageTone(worst.window.usedPercent) : "ok"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Janela de uso do plano"
          aria-label="Janela de uso do plano"
          className="pointer-events-auto hidden items-center gap-1.5 rounded-full border bg-secondary/50 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex"
        >
          <Gauge className="size-3.5" aria-hidden />
          {worst ? (
            <>
              <UsageBar pct={worst.window.usedPercent} />
              {/* largura reservada: "100%" não desloca os vizinhos */}
              <span
                className={cn(
                  "min-w-[34px] text-right font-mono tabular-nums",
                  TONE_TEXT[tone],
                )}
              >
                {fmtPct(worst.window.usedPercent)}
              </span>
            </>
          ) : (
            <span className="text-st-error">sem leitura</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <p className="px-2 pt-1 pb-0.5 text-[10.5px] tracking-wide text-muted-foreground/70 uppercase">
          Janela de uso do plano
        </p>
        {measurable.map((d) => (
          <ProviderRows
            key={d.id}
            label={d.label}
            snap={byAgent[d.id]}
            failure={failures[d.id]}
            now={now}
          />
        ))}
        {ctaAgents.map((d) => (
          <div
            key={d.id}
            className="mt-1 flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              Meça a janela do {d.label}: ative o medidor em Configurações
              (CLIs instaladas).
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 rounded bg-brass px-2 py-0.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
            >
              Abrir
            </button>
            <button
              type="button"
              title="Dispensar este aviso"
              aria-label="Dispensar o aviso de instalação do medidor"
              onClick={() => setSettings({ usageMeterCtaDismissed: true })}
              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <p className="px-2 pt-1.5 pb-1 text-[10.5px] leading-snug text-muted-foreground/60">
          Quanto da janela do seu plano já foi usada, por provider. Não é
          custo em US$: medição de carona, nenhuma quota é consumida.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
