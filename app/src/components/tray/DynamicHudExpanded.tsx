import { motion } from "motion/react"
import { AlertCircle, CheckCircle2, Circle, Coffee, ExternalLink, LoaderCircle, Pause, Plus, Settings, Square } from "lucide-react"
import { FrotaMark } from "@/components/brand/FrotaMark"
import { Button } from "@/components/ui/button"
import type { HudRuntimeView } from "@/lib/hud"
import {
  elapsedLabel,
  elapsedMetric,
  externalStatusLabel,
  relativeLabel,
  type HudPresentation,
} from "@/lib/hudPresentation"
import { decisionSubtitle, runTrayAction, type TrayActivity, type TraySnapshot } from "@/lib/tray"
import { fraseDoTurno } from "@/lib/turnReceipt"
import { cn } from "@/lib/utils"

type StatusKind = "loading" | "unavailable" | "decision" | "flight" | "idle"

function StatusDot({ kind }: { kind: StatusKind }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        kind === "decision" ? "bg-st-warning" : kind === "flight" ? "bg-st-running" : "bg-st-idle",
      )}
    />
  )
}

function HudHeader({
  runtime,
  statusKind,
  statusText,
}: {
  runtime: HudRuntimeView
  statusKind: StatusKind
  statusText: string
}) {
  const notch = runtime.effectivePosition === "notch"
  const brand = (
    <span className="flex min-w-0 items-center gap-2 font-semibold">
      <FrotaMark className="size-3.5 shrink-0 stroke-current" />
      <span className="truncate">Frota</span>
    </span>
  )
  const state = (
    <span className="flex min-w-0 items-center justify-end gap-2">
      <StatusDot kind={statusKind} />
      <span className="truncate font-mono text-[11px] text-muted-foreground">{statusText}</span>
      <Button size="chip" variant="outline" onClick={() => void runTrayAction("open")}>
        <ExternalLink className="size-3" /> Abrir
      </Button>
    </span>
  )

  if (notch) {
    return (
      <header
        className="grid h-11 shrink-0 items-center border-b border-border/40 px-3"
        style={{ gridTemplateColumns: `1fr ${runtime.screen?.notchWidth ?? 0}px 1fr` }}
      >
        {brand}
        <span aria-hidden />
        {state}
      </header>
    )
  }
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border/40 px-3.5">
      {brand}
      <span className="ml-auto">{state}</span>
    </header>
  )
}

function SystemLine({ snapshot }: { snapshot: TraySnapshot }) {
  const schedule = snapshot.nextSchedule
    ? `${snapshot.nextSchedule.name} · ${snapshot.nextSchedule.relative}`
    : snapshot.enabledSchedules > 0
      ? `${snapshot.enabledSchedules} ${snapshot.enabledSchedules === 1 ? "automação ativa" : "automações ativas"}`
      : "Sem automações"
  const observed = snapshot.external[0]
  const external = observed
    ? `${observed.agent} observado, ${externalStatusLabel(observed.status)}`
    : "Terminal não observado"

  return (
    <p className="hud-system-line flex min-w-0 items-center justify-center gap-1 text-[11px] text-muted-foreground">
      <button
        type="button"
        className="max-w-[48%] truncate font-medium text-foreground/75 focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => void runTrayAction("open-schedules")}
      >
        {schedule}
      </button>
      <span aria-hidden>·</span>
      <span className="max-w-[48%] truncate">{external}</span>
      {snapshot.acordado && (
        <>
          <span aria-hidden>·</span>
          <span className="flex shrink-0 items-center gap-1">
            <Coffee className="size-3" aria-hidden />
            acordado
          </span>
        </>
      )}
    </p>
  )
}

function SettingsAction() {
  return (
    <Button
      size="icone-compacto"
      variant="ghost"
      className="absolute right-3"
      aria-label="Abrir configurações"
      title="Configurações"
      onClick={() => void runTrayAction("open-settings")}
    >
      <Settings className="size-3.5" />
    </Button>
  )
}

function FlightScene({
  snapshot,
  primary,
  secondary,
  now,
  onRequestStop,
}: {
  snapshot: TraySnapshot
  primary: TrayActivity
  secondary: TrayActivity[]
  now: number
  onRequestStop: (activity: TrayActivity) => void
}) {
  const metric = elapsedMetric(primary.startedAt, now)
  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_12px_24px_auto] px-7 pt-3 pb-12">
      <div className="grid min-h-0 grid-cols-[116px_1fr] items-center">
        <div className="border-r border-border/40 pr-4">
          <p className="flex items-baseline font-mono tabular-nums leading-none tracking-[-0.04em]">
            <strong className="text-[30px] font-semibold">{metric.value}</strong>
            {metric.unit && (
              <span className="ml-0.5 text-[13px] font-semibold text-muted-foreground">{metric.unit}</span>
            )}
            {metric.secondaryValue && (
              <>
                <strong className="ml-1.5 text-[30px] font-semibold">{metric.secondaryValue}</strong>
                <span className="ml-0.5 text-[13px] font-semibold text-muted-foreground">{metric.secondaryUnit}</span>
              </>
            )}
          </p>
          <span className="mt-1.5 block font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {metric.label}
          </span>
        </div>
        <div className="min-w-0 pl-5">
          <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-st-running">
            Em voo agora
          </p>
          <h2 className="truncate text-[14px] font-semibold">{primary.title}</h2>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">
            {primary.projectName} · {primary.detail}
          </p>
        </div>
      </div>
      <div className="hud-live-rail ml-[136px]" aria-label="Tarefa em execução">
        <span />
      </div>
      <SystemLine snapshot={snapshot} />
      {secondary.length > 0 && (
        <div className="hud-secondary-activities flex min-w-0 items-center justify-center gap-3 border-t border-border/40 pt-2">
          {secondary.map((activity) => (
            <button
              type="button"
              key={`${activity.projectId}-${activity.convId}`}
              className="flex min-w-0 max-w-[46%] items-center gap-1.5 text-[11px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => void runTrayAction("open-activity", activity.convId, activity.projectId)}
            >
              <Circle className="size-1.5 shrink-0 fill-st-running text-st-running" />
              <span className="truncate text-foreground/80">{activity.title}</span>
              <span className="shrink-0 font-mono">{elapsedLabel(activity.startedAt, now)}</span>
            </button>
          ))}
        </div>
      )}
      <footer className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 border-t border-border/40 bg-card/30 px-3">
        <Button size="compacto" variant="ghost" onClick={() => onRequestStop(primary)}>
          <Square className="size-3 fill-current" /> Parar tarefa
        </Button>
        <Button size="compacto" onClick={() => void runTrayAction("new-task")}>
          <Plus className="size-3.5" /> Nova tarefa
        </Button>
        {snapshot.enabledSchedules > 0 && (
          <Button
            size="icone-compacto"
            variant="ghost"
            className="absolute left-3"
            aria-label="Pausar automações"
            title="Pausar automações"
            onClick={() => void runTrayAction("pause-schedules")}
          >
            <Pause className="size-3.5" />
          </Button>
        )}
        <SettingsAction />
      </footer>
    </div>
  )
}

function DecisionScene({ snapshot }: { snapshot: TraySnapshot }) {
  const title = snapshot.decisions === 1 ? "1 decisão aguardando você" : `${snapshot.decisions} decisões aguardando você`
  return (
    <div className="grid h-full place-items-center px-12 pb-12 text-center">
      <div>
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-st-warning">
          Sua decisão vem primeiro
        </p>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="mx-auto mt-1.5 max-w-[390px] text-[12px] text-muted-foreground">
          {decisionSubtitle(snapshot.decisions, snapshot.blocking)}. Abra a conversa para ver a pergunta e as opções reais.
        </p>
        <span className="mx-auto mt-4 block h-0.5 w-10 bg-st-warning" aria-hidden />
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 border-t border-border/40 bg-card/30 px-3">
        <Button
          size="compacto"
          onClick={() => void runTrayAction("review-decision", snapshot.decisionConvId, snapshot.decisionProjectId)}
        >
          Revisar no Frota
        </Button>
        <Button size="compacto" variant="ghost" onClick={() => void runTrayAction("new-task")}>
          <Plus className="size-3.5" /> Nova tarefa
        </Button>
        <SettingsAction />
      </footer>
    </div>
  )
}

function StopScene({
  presentation,
  onCancel,
  onConfirm,
  onRetry,
}: {
  presentation: Extract<HudPresentation, { kind: "stop" }>
  onCancel: () => void
  onConfirm: () => void
  onRetry: () => void
}) {
  const { activity, intent } = presentation
  const pending = intent.phase === "sending" || intent.phase === "waiting"
  const unresolved = intent.phase === "unconfirmed" || intent.phase === "failed"
  const title =
    intent.phase === "confirm"
      ? `Parar ${activity.title}?`
      : intent.phase === "unconfirmed"
        ? "Interrupção ainda não confirmada"
        : intent.phase === "failed"
          ? "Não foi possível solicitar a interrupção"
          : "Interrupção solicitada"
  const description =
    intent.phase === "confirm"
      ? "A tarefa continua em voo até você confirmar. O histórico permanece preservado."
      : intent.phase === "failed"
        ? "Não foi possível entregar o pedido pelo instrumento. Tente novamente ou abra a Frota."
        : intent.phase === "unconfirmed"
          ? "A tarefa ainda aparece em voo no estado real. Você pode tentar novamente ou abrir a Frota."
          : "O pedido foi enviado. A tarefa só sairá daqui quando a Frota confirmar o novo estado."

  return (
    <div className="grid h-full place-items-center px-12 pb-12 text-center">
      <div>
        <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-st-error">
          {intent.phase === "confirm" ? "Decisão antes de agir" : "Pedido de interrupção"}
        </p>
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="mx-auto mt-1.5 max-w-[400px] text-[12px] text-muted-foreground">{description}</p>
        <span className="mx-auto mt-4 block h-0.5 w-10 bg-st-error" aria-hidden />
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 border-t border-border/40 bg-card/30 px-3">
        {intent.phase === "confirm" ? (
          <>
            <Button size="compacto" variant="ghost" onClick={onCancel}>Manter em voo</Button>
            <Button size="compacto" variant="destructive" onClick={onConfirm}>
              <Square className="size-3 fill-current" /> Parar agora
            </Button>
          </>
        ) : unresolved ? (
          <>
            <Button size="compacto" variant="ghost" onClick={() => void runTrayAction("open")}>Abrir Frota</Button>
            <Button size="compacto" variant="destructive" onClick={onRetry}>Tentar de novo</Button>
          </>
        ) : (
          <Button size="compacto" variant="ghost" disabled={pending}>
            {intent.phase === "sending" ? "Enviando pedido" : "Aguardando confirmação"}
          </Button>
        )}
      </footer>
    </div>
  )
}

type QuietPresentation = Extract<
  HudPresentation,
  { kind: "loading" | "unavailable" | "settled" | "ready" }
>

function QuietScene({ presentation, now }: { presentation: QuietPresentation; now: number }) {
  const settled = presentation.kind === "settled" ? presentation.snapshot.lastTurn : null
  const unavailable = presentation.kind === "unavailable"
  const loading = presentation.kind === "loading"
  const title = loading
    ? "Lendo o estado da frota"
    : unavailable
      ? "Estado da frota indisponível"
      : settled
        ? settled.title
        : "Frota pronta"
  const copy = loading
    ? "A Frota está verificando as tarefas em andamento."
    : unavailable
      ? "Abra a Frota para verificar a conexão com o instrumento."
      : settled
        ? `${fraseDoTurno(settled.receipt, settled.ok)} · ${relativeLabel(settled.at, now)}`
        : "Nenhuma tarefa pede atenção agora."
  const Glyph = loading
    ? LoaderCircle
    : settled
      ? settled.ok
        ? CheckCircle2
        : AlertCircle
      : unavailable
        ? AlertCircle
        : Circle

  return (
    <div className="grid h-full place-items-center px-10 pb-12 text-center">
      <div>
        <Glyph className="mx-auto mb-3 size-5 text-muted-foreground" />
        <h2 className="text-[14px] font-semibold">{title}</h2>
        <p className="mt-1.5 text-[12px] text-muted-foreground">{copy}</p>
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 border-t border-border/40 bg-card/30 px-3">
        {!loading && (
          <Button size="compacto" onClick={() => void runTrayAction(unavailable ? "open" : "new-task")}>
            {unavailable ? <ExternalLink className="size-3" /> : <Plus className="size-3.5" />}
            {unavailable ? "Abrir Frota" : "Nova tarefa"}
          </Button>
        )}
        <SettingsAction />
      </footer>
    </div>
  )
}

export function DynamicHudExpanded({
  runtime,
  presentation,
  statusKind,
  statusText,
  now,
  closing,
  onRequestStop,
  onCancelStop,
  onConfirmStop,
  onRetryStop,
}: {
  runtime: HudRuntimeView
  presentation: HudPresentation
  statusKind: StatusKind
  statusText: string
  now: number
  closing: boolean
  onRequestStop: (activity: TrayActivity) => void
  onCancelStop: () => void
  onConfirmStop: () => void
  onRetryStop: () => void
}) {
  const sceneKey = presentation.kind === "stop" ? `${presentation.kind}-${presentation.intent.phase}` : presentation.kind
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={closing ? { opacity: 0, y: -4 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex h-full min-h-0 flex-col origin-top"
    >
      <HudHeader runtime={runtime} statusKind={statusKind} statusText={statusText} />
      <div className="relative min-h-0 flex-1 overflow-hidden" aria-live="polite">
        <motion.section
          key={sceneKey}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="absolute inset-0 pb-12"
        >
          {presentation.kind === "flight" ? (
            <FlightScene
              snapshot={presentation.snapshot}
              primary={presentation.primary}
              secondary={presentation.secondary}
              now={now}
              onRequestStop={onRequestStop}
            />
          ) : presentation.kind === "decision" ? (
            <DecisionScene snapshot={presentation.snapshot} />
          ) : presentation.kind === "stop" ? (
            <StopScene presentation={presentation} onCancel={onCancelStop} onConfirm={onConfirmStop} onRetry={onRetryStop} />
          ) : (
            <QuietScene presentation={presentation} now={now} />
          )}
        </motion.section>
      </div>
    </motion.div>
  )
}
