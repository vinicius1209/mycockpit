// <UsagePill> — pill do medidor de janela de uso na barra superior (a feature
// "9% used · 4h 22m" do estudo do Orca), com popover de detalhe por provider.
// Fonte única: useUsage (snapshots com procedência) + a política de
// lib/usageWindow. A pill fechada é CONTEXTUAL e NOMEADA: mostra o provider do
// agent da CONVERSA ATIVA quando ele tem janela medida; sem medição do ativo,
// cai pro pior global — e sempre com o nome do provider na frente do número
// (um "30%" nu do Codex numa conversa Claude lia como se fosse o Claude).
// Camadas de esconder (Orca):
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
import { agentDef } from "@/lib/agents"
import { usageWindowAgents } from "@/lib/agentRoster"
import { fmtTime } from "@/lib/format"
import { METER_FILL, METER_TEXT } from "@/lib/meter"
import {
  failureLabel,
  fmtAge,
  fmtPct,
  fmtResetIn,
  pillWindow,
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

// Tabelas do medidor único do app (lib/meter): a pill e o anel de contexto
// falam a mesma língua, não duas paletas parecidas.
const TONE_BAR = METER_FILL
const TONE_TEXT = METER_TEXT

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
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
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
              <span className="min-w-0 truncate text-[11px] text-muted-foreground/70">
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
          Falhando desde {fmtTime(failure.since)} ({failureLabel(failure.kind)}
          ).
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
  // agent da conversa ativa (o mesmo que o composer mostra como identidade):
  // é ele que decide QUAL provider a pill fechada prioriza.
  const activeAgent = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.agent ?? null) : null,
  )

  // idade/staleness passam sem evento de store: relógio local de 30s (mesma
  // granularidade do tick do vigia), só pra re-render.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  if (!enabled) return null
  const sel = pillWindow(activeAgent, byAgent, failures, now)
  const failing = Object.keys(failures).length > 0
  // nada medido e nada falhando: a pill SOME (não-configurado se esconde;
  // configurado-com-erro fica visível no ramo abaixo).
  if (!sel && !failing) return null

  const providers = usageWindowAgents()
  const measurable = providers.filter(
    (d) => byAgent[d.id] != null || failures[d.id] != null,
  )
  // CTA: provider de statusline ainda sem NENHUM snapshot (medidor não
  // instalado ou sem turno desde o boot) — só aparece com a pill já viva
  // (snapshots assentados) e some pra sempre se dispensado. Provider que está
  // FALHANDO fica de fora: quem tem falha registrada já aparece com o motivo
  // ("reautentique o CLI"), e mandar instalar statusline em cima disso seria
  // apontar pro lugar errado (camada 3 do Orca vence a 4).
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
            // `compact` = dentro da faixa de 24px: sem cápsula, sem fundo, sem
            // borda. Ali a pill é telemetria de fundo (11px mono, cinza), não
            // um controle que pede clique — o detalhe continua a um clique.
            compact
              ? "-mx-1 h-5 rounded px-1 font-mono text-[11px] hover:bg-accent/50"
              : "rounded-full border bg-secondary/50 px-2.5 py-1 text-[12px]",
          )}
        >
          <Gauge className={compact ? "size-3" : "size-3.5"} aria-hidden />
          {sel ? (
            <>
              {/* o DONO do número, sempre: percentual nu induzia a ler o
                  número como sendo do agent da conversa. Trunca ANTES do
                  número (largura do percentual é reservada). */}
              <span className="max-w-20 truncate">{usagePillLabel(sel.agent)}</span>
              <UsageBar pct={sel.window.usedPercent} />
              {/* largura reservada: "100%" não desloca os vizinhos */}
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
      {/* sideOffset + z-[120]: o header da TitleBar é z-[110] (acima do
          overlay de drag do decorum, ver TitleBar.tsx) — no z-50 padrão dos
          dropdowns a borda de cima do popover sumia ATRÁS da faixa de
          título. Acima do header + folga do trigger, nada é cortado.
          Na faixa inferior o popover abre pra CIMA e alinhado à esquerda:
          ancorado no canto de baixo, ele é a única direção com espaço. */}
      <DropdownMenuContent
        side={compact ? "top" : "bottom"}
        align={compact ? "start" : "end"}
        sideOffset={8}
        className="z-[120] w-80 p-1.5"
      >
        <p className="px-2 pt-1 pb-0.5 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
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
              (Uso e custo).
            </span>
            <button
              type="button"
              // deep link: cai direto na seção do medidor, não na primeira.
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
        <p className="px-2 pt-1.5 pb-1 text-[11px] leading-snug text-muted-foreground/60">
          Quanto da janela do seu plano já foi usada, por provider. Não é
          custo em US$ nem o contexto da conversa (esse é o anel do composer):
          medição de carona, nenhuma quota é consumida.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
