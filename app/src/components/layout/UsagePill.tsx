// <UsagePill> — pill do medidor de janela de uso na faixa inferior, com popover
// de detalhe por provider. Fonte única: useUsage (snapshots com procedência) +
// a política de lib/usageWindow.
//
// A pill fechada é CONTEXTUAL e NOMEADA: mostra o provider do agent da CONVERSA
// ATIVA, e SÓ ele — vizinho não empresta número (ADR do build 201: conversa do
// Antigravity exibindo "Claude 59%"). Sem conversa aberta, o pior global.
//
// Camadas de esconder (regra do Orca), que NÃO podem ser diluídas:
//   1. motor sem capability nem aparece (usageWindowAgents);
//   2. provider não-configurado/não-logado/sem dado: some;
//   3. provider configurado FALHANDO: VISÍVEL com estado honesto ("falhando
//      desde X"), senão a UI tremula entre aparecer e sumir;
//   4. CTA de instalação dispensável, com o dispensado persistido.
//
// Régua de cor: a de lib/meter, a mesma do anel de contexto — cinza até 60,
// âmbar 60 a 80, vermelho 80+. Números em tabular-nums com largura reservada.
//
// NÃO afirme aqui "suporte multi-agent (Claude, Codex, Antigravity)": o `agy`
// tem `usageWindow: null` no registry, logo está fora do `duePollAgents` e a
// pill se esconde nas conversas dele. Quando existir leitura da conta Google AI
// Pro, o que muda é o REGISTRY e o Rust — não este comentário.

import { useEffect, useState } from "react"
import { Gauge, RefreshCw, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { agentDef } from "@/lib/agents"
import { usageWindowAgents } from "@/lib/agentRoster"
import { AgentLogo } from "@/components/common/AgentLogo"
import { fmtTime } from "@/lib/format"
import { METER_FILL, METER_TEXT } from "@/lib/meter"
import {
  failureLabel,
  fmtAge,
  fmtPct,
  fmtResetAbsolute,
  fmtResetIn,
  pillWindow,
  refreshUsageNow,
  snapshotUsable,
  sourceLabel,
  usagePillLabel,
  usageTone,
  type UsageFailure,
  type UsageSnapshot,
} from "@/lib/usageWindow"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useUsage } from "@/store/usage"
import { cn } from "@/lib/utils"

const TONE_BAR = METER_FILL
const TONE_TEXT = METER_TEXT

/** Barra fina de percentual (cinza até 60, âmbar 60 a 80, vermelha 80+). */
function UsageBar({ pct, wide = false }: { pct: number; wide?: boolean }) {
  const tone = usageTone(pct)
  return (
    <span
      aria-hidden
      className={cn(
        "relative h-1.5 shrink-0 overflow-hidden rounded-full bg-secondary/80",
        wide ? "w-24" : "w-8",
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-300", TONE_BAR[tone])}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  )
}

/** Card com detalhe de UM provider no popover. */
function ProviderCard({
  agentId,
  label,
  snap,
  failure,
  now,
}: {
  agentId: string
  label: string
  snap: UsageSnapshot | undefined
  failure: UsageFailure | undefined
  now: number
}) {
  const usable = snap != null && snapshotUsable(snap, failure, now)
  const worstPct =
    usable && snap.windows.length > 0
      ? Math.max(...snap.windows.map((w) => w.usedPercent))
      : 0
  // Régua ÚNICA (lib/meter, via usageTone): cinza <60 · âmbar 60-80 · vermelho
  // 80+. Não se inventa limiar local — dois medidores discordando dentro do
  // mesmo popover foi o que o §2 chamou de "duas réguas para o mesmo fato".
  const tomPior = usable && snap.windows.length > 0 ? usageTone(worstPct) : "ok"

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-secondary/25 p-2.5 transition-colors hover:bg-secondary/35">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="size-4 shrink-0 flex items-center justify-center">
            <AgentLogo agent={agentId} />
          </div>
          <span className="truncate text-[12px] font-medium text-foreground">
            {label}
          </span>
          {snap?.planType ? (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground border border-border/40">
              {snap.planType}
            </span>
          ) : null}
        </div>
        {/* Selo SÓ quando pede atenção. O "Disponível" em verde saiu: era
            estado ambiente permanente em cor de status, que o §9 item 4 condena
            e que foi removido do stepper do SDD no mesmo dia em que entrou
            aqui. Provider dentro do normal não precisa de selo — a barra e o
            percentual já dizem, e o que não é decisão recua.
            Os limiares vêm da RÉGUA ÚNICA do app (lib/meter, via usageTone):
            cinza <60 · âmbar 60-80 · vermelho 80+. O código original inventava
            80/100 próprios, o que criava um segundo medidor discordando do
            primeiro dentro do mesmo popover. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {tomPior === "danger" ? (
            <span className="rounded bg-st-error/15 px-1.5 py-0.5 text-[11px] font-semibold text-st-error">
              No limite
            </span>
          ) : tomPior === "warn" ? (
            <span className="rounded bg-st-warning/15 px-1.5 py-0.5 text-[11px] font-semibold text-st-warning">
              Aquecendo
            </span>
          ) : null}
          {/* PROCEDÊNCIA + idade. O `sourceLabel` tinha sido removido, e ele é
              metade da honestidade do medidor: "de onde veio o número que está
              na tela" (leitura da conta × statusline × leitura local). Sem ele,
              um número de carona do terminal parece leitura oficial da conta. */}
          {snap && (
            <span className="text-[11px] text-muted-foreground/60">
              {sourceLabel(snap.source)} · {fmtAge(snap.fetchedAt, now)}
            </span>
          )}
        </div>
      </div>

      {usable && snap.windows.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-0.5">
          {snap.windows.map((w) => {
            const resetRel = fmtResetIn(w.resetsAt, now)
            const resetAbs = fmtResetAbsolute(w.resetsAt, now)
            return (
              <div key={w.id} className="flex items-center gap-2 text-[11px]">
                {/* O rótulo carrega a janela E, quando o provider tem pools
                    separados, de QUEM ela é ("7 dias · Gemini" × "7 dias ·
                    Claude and GPT" no agy; "7 dias · Fable" no claude). Com
                    64px nenhum desses cabia e os dois pools ficavam
                    indistinguíveis, que é justamente a mentira que o rótulo
                    existe pra evitar. O `title` fica como rede pro caso de
                    ainda truncar. */}
                <span
                  title={w.label}
                  className="w-28 shrink-0 truncate font-medium text-muted-foreground"
                >
                  {w.label}
                </span>
                <UsageBar pct={w.usedPercent} wide />
                <span
                  className={cn(
                    "min-w-[34px] shrink-0 text-right font-mono tabular-nums",
                    TONE_TEXT[usageTone(w.usedPercent)],
                  )}
                >
                  {fmtPct(w.usedPercent)}
                </span>
                <span
                  title={resetRel ? `${resetRel}${resetAbs ? ` (${resetAbs})` : ""}` : undefined}
                  className="ml-auto shrink-0 font-mono text-muted-foreground/75 text-right"
                >
                  {resetRel ? `${resetRel}${resetAbs ? ` (${resetAbs})` : ""}` : ""}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {snap && !usable && (
        <p className="text-[11px] text-muted-foreground">
          Sem dados frescos, última leitura {fmtAge(snap.fetchedAt, now)}.
        </p>
      )}
      {failure && (
        <p className="text-[11px] text-st-error">
          Falhando desde {fmtTime(failure.since)} ({failureLabel(failure.kind)}).
        </p>
      )}
    </div>
  )
}

export function UsagePill({ compact = false }: { compact?: boolean }) {
  const enabled = useApp((s) => s.settings.usageMeterEnabled)
  const ctaDismissed = useApp((s) => s.settings.usageMeterCtaDismissed)
  const setSettings = useApp((s) => s.setSettings)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const byAgent = useUsage((s) => s.byAgent)
  const failures = useUsage((s) => s.failures)
  const activeAgent = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.agent ?? null) : null,
  )

  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await refreshUsageNow()
      setNow(Date.now())
    } finally {
      setTimeout(() => setRefreshing(false), 500)
    }
  }

  if (!enabled) return null
  const sel = pillWindow(activeAgent, byAgent, failures, now)
  const failing = Object.keys(failures).length > 0
  if (!sel && !failing) return null

  const providers = usageWindowAgents()
  const measurable = providers.filter(
    (d) => byAgent[d.id] != null || failures[d.id] != null,
  )

  const ctaAgents = ctaDismissed
    ? []
    : providers.filter(
        (d) =>
          d.usageWindow === "statusline" &&
          byAgent[d.id] == null &&
          failures[d.id] == null,
      )

  const tone = sel ? usageTone(sel.window.usedPercent) : "ok"
  const pillTitle = sel
    ? `Janela de uso do plano · ${agentDef(sel.agent)?.label ?? sel.agent}`
    : "Janela de uso do plano"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={pillTitle}
          aria-label={pillTitle}
          className={cn(
            "pointer-events-auto hidden items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex",
            compact
              ? "-mx-1 h-5 rounded px-1 font-mono text-[11px] hover:bg-accent/50"
              : "rounded-full border bg-secondary/50 px-2.5 py-1 text-[12px]",
          )}
        >
          <Gauge className={compact ? "size-3" : "size-3.5"} aria-hidden />
          {sel ? (
            <>
              <span className="max-w-20 truncate">{usagePillLabel(sel.agent)}</span>
              <UsageBar pct={sel.window.usedPercent} />
              <span
                className={cn(
                  "min-w-[34px] text-right font-mono tabular-nums",
                  TONE_TEXT[tone],
                )}
              >
                {fmtPct(sel.window.usedPercent)}
              </span>
            </>
          ) : (
            <span className="text-st-error">sem leitura</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "top" : "bottom"}
        align={compact ? "start" : "end"}
        sideOffset={8}
        className="z-[120] w-[430px] p-2.5 space-y-2"
      >
        <div className="flex items-center justify-between px-1 pb-1 border-b border-border/40">
          <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
            <Gauge className="size-3.5 text-brass" />
            Janela de Uso do Plano
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-secondary disabled:opacity-50"
            title="Atualizar leituras agora"
          >
            <RefreshCw className={cn("size-3", refreshing && "animate-spin")} />
            <span>{refreshing ? "Atualizando..." : "Atualizar"}</span>
          </button>
        </div>

        <div className="space-y-2">
          {measurable.map((d) => (
            <ProviderCard
              key={d.id}
              agentId={d.id}
              label={d.label}
              snap={byAgent[d.id]}
              failure={failures[d.id]}
              now={now}
            />
          ))}
        </div>

        {ctaAgents.map((d) => (
          <div
            key={d.id}
            className="mt-1 flex items-center gap-2 rounded-md bg-secondary/40 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              Meça a janela do {d.label}: ative o medidor em Configurações (Uso e custo).
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true, "ledger")}
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

        <div className="flex items-center justify-between px-1 pt-1 text-[11px] text-muted-foreground/60 border-t border-border/30">
          <span>Medição de carona & poll (sem custo de quota)</span>
          <span>·</span>
          <span>Atualização auto ~15 min</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
