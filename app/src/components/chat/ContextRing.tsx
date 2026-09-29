import { useEffect, useRef, useState } from "react"
import { useActiveConv, useChat, type ConvState } from "@/store/chat"
import { useApp } from "@/store/app"
import { contextMeter, type ContextCeiling, type ContextMeter } from "@/lib/contextMeter"
import { compactActionHint, offersCompactAction } from "@/lib/compact"
import { contextCeilingProbe } from "@/lib/agentContext"
import { agentDef } from "@/lib/agents"
import {
  ceilingFrom,
  entryFor,
  refreshEngineContext,
  useEngineContext,
  type EngineContextEntry,
} from "@/lib/engineContext"
import { METER_TEXT, meterTone } from "@/lib/meter"
import { cn } from "@/lib/utils"

/** Circunferência do raio 4: com traço 8, o círculo vira fatia de pizza. */
const C_FATIA = 2 * Math.PI * 4
/** A partir daqui o medidor da linha fica âmbar (ADR-282). */
export const LIMIAR_DO_AVISO = 80

/** O tom do medidor da linha: cinza fraco, âmbar a partir do limiar, nunca
 *  vermelho. Sem percentual confiável, cinza. Puro. */
export function tomDoMedidor(pct100: number | null): "text-faint" | "text-st-warning" {
  return pct100 != null && pct100 >= LIMIAR_DO_AVISO ? "text-st-warning" : "text-faint"
}
const exactTokens = (value: number) => value.toLocaleString("pt-BR")

/** Medidor da última chamada ao modelo. Percentual só existe quando tokens e
 *  janela são compatíveis; legado e falhas de fonte nunca viram 100% fictício. */
export function ContextRing() {
  const conv = useActiveConv()
  const convId = useChat((s) => s.activeId)
  const projectPath = useApp(
    (s) => s.projects.find((p) => p.id === conv.projectId)?.path ?? null,
  )
  const cwd = conv.worktreePath ?? projectPath
  const entry = entryFor(
    conv,
    useEngineContext((s) => (convId ? s.byConv[convId] : undefined)),
  )
  // Aquecimento (ADR-196): anel com medida e sem leitura do limiar para esta
  // sessão e modelo. Falha também grava entrada, então não há laço de retry.
  const warm =
    !!convId &&
    !!cwd &&
    !!conv.sessionId &&
    conv.contextBasis === "last_call" &&
    !!contextCeilingProbe(conv.agent) &&
    !entry &&
    !conv.running &&
    !conv.finalizing
  useEffect(() => {
    if (warm && convId && cwd) void refreshEngineContext(convId, cwd)
  }, [warm, convId, cwd])
  return (
    <ContextRingView
      conv={conv}
      engine={entry}
      onOpen={() => {
        if (convId && cwd) void refreshEngineContext(convId, cwd)
      }}
    />
  )
}

/** View exportada para validar os estados sem depender do snapshot SSR da store. */
export function ContextRingView({
  conv,
  engine = null,
  onOpen,
  initiallyOpen = false,
}: {
  conv: ConvState
  /** Leitura do limiar pelo motor, já validada para esta sessão e modelo. */
  engine?: EngineContextEntry | null
  /** Gesto de abrir o popover: relê o limiar. */
  onOpen?: () => void
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const wrapRef = useRef<HTMLDivElement>(null)
  const meter = contextMeter({
    basis: conv.contextBasis,
    tokens: conv.contextTokens,
    runtimeWindow: conv.contextWindow,
    model: conv.model,
    ceiling: ceilingFrom(engine?.reading),
  })
  const label = agentDef(conv.agent)?.label ?? conv.agent

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (meter.kind === "hidden") return null
  const ratio = meter.kind === "ratio" ? meter : null
  const pct100 = ratio ? ratio.pct * 100 : null
  // Na linha do enviar, sem texto e sem vermelho (ADR-282): cinza fraco, e
  // âmbar a partir de 80%, quando compactar passa a valer a pena. O número e
  // a régua completa ficam no painel do clique.
  const tom = tomDoMedidor(pct100)
  const title = ratio?.ceiling?.kind === "autocompact"
    ? `contexto: ${Math.round(pct100!)}% até a compactação automática (${exactTokens(ratio.tokens)} de ${exactTokens(ratio.ceiling.tokens)} tokens)`
    : ratio
    ? `contexto: ${Math.round(pct100!)}% da janela (${exactTokens(ratio.tokens)} de ${exactTokens(ratio.window)} tokens)`
    : meter.kind === "unavailable"
      ? "contexto: medição indisponível · clique para entender"
      : "contexto: sem percentual confiável · clique para entender"

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      <button
        onClick={() => {
          if (!open) onOpen?.()
          setOpen((value) => !value)
        }}
        title={title}
        aria-label="Detalhes do contexto"
        aria-expanded={open}
        className="grid size-6 place-items-center rounded-full hover:bg-accent"
      >
        {/* Pizza, não arco: um arco parcial cinza lê como "carregando". */}
        <svg viewBox="0 0 20 20" className={cn("col-start-1 row-start-1 size-4 -rotate-90", tom)}>
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="1.5" className="stroke-current opacity-55" />
          {ratio && (
            <circle
              cx="10"
              cy="10"
              r="4"
              fill="none"
              strokeWidth="8"
              strokeDasharray={`${Math.min(ratio.pct, 1) * C_FATIA} ${C_FATIA}`}
              className="stroke-current transition-all duration-500"
            />
          )}
        </svg>
        {!ratio && (
          <span className="col-start-1 row-start-1 text-[11px] font-medium text-muted-foreground">
            ?
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-2 w-72 overflow-hidden rounded-xl border bg-popover p-3 shadow-[var(--shadow-pop)]">
          <ContextDetails meter={meter} model={conv.model} label={label} />
          {engine?.error && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Limiar do motor não lido agora: {engine.error}
            </p>
          )}
          {ratio && offersCompactAction(ratio.pct) && (
            <div className="mt-2 border-t pt-2">
              <button
                onClick={() => {
                  setOpen(false)
                  useChat.getState().queuePrompt("/compactar")
                }}
                title={compactActionHint(conv.agent)}
                className="w-full rounded-lg border px-2 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent"
              >
                Compactar contexto
              </button>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                {compactActionHint(conv.agent)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContextDetails({
  meter,
  model,
  label,
}: {
  meter: Exclude<ContextMeter, { kind: "hidden" }>
  model: string | null
  label: string
}) {
  const ratio = meter.kind === "ratio" ? meter : null
  const color = ratio ? METER_TEXT[meterTone(ratio.pct * 100)] : "text-muted-foreground"
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">Contexto</span>
        <span className={cn("font-mono text-[13px] tabular-nums", color)}>
          {ratio ? `${Math.round(ratio.pct * 100)}%` : "—"}
        </span>
      </div>
      {ratio && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className={cn("h-full rounded-full bg-current transition-all", color)}
            style={{ width: `${Math.min(ratio.pct, 1) * 100}%` }}
          />
        </div>
      )}
      <dl className="mt-3 space-y-1.5 text-[12px]">
        <Row k="Modelo" v={model ?? "—"} mono />
        {meter.kind === "ratio" && <RatioRows meter={meter} />}
        {meter.kind === "absolute" && (
          <>
            <Row k="Última chamada" v={exactTokens(meter.tokens)} />
            <Row k="Janela" v="Não informada" />
          </>
        )}
        {meter.kind === "incompatible" && (
          <>
            <Row k="Última chamada" v={exactTokens(meter.tokens)} />
            <Row k="Janela" v={windowLabel(meter.window, meter.windowSource)} />
          </>
        )}
        {meter.kind === "unavailable" && <Row k="Medição" v="Indisponível" />}
      </dl>
      <Explanation meter={meter} label={label} />
    </>
  )
}

function RatioRows({ meter }: { meter: Extract<ContextMeter, { kind: "ratio" }> }) {
  return (
    <>
      <Row k="Janela" v={windowLabel(meter.window, meter.windowSource)} />
      <Row k="Última chamada" v={exactTokens(meter.tokens)} />
      {meter.ceiling?.kind === "autocompact" ? (
        <>
          <Row k="Compacta sozinho em" v={exactTokens(meter.ceiling.tokens)} />
          {meter.ceiling.engineCount != null && (
            <Row k="Estimativa do motor" v={exactTokens(meter.ceiling.engineCount)} />
          )}
          <Row k="Até compactar" v={exactTokens(meter.free)} />
        </>
      ) : (
        <>
          {meter.ceiling && <Row k="Compactação automática" v="Desligada" />}
          <Row k="Disponível" v={exactTokens(meter.free)} />
        </>
      )}
    </>
  )
}

function Explanation({
  meter,
  label,
}: {
  meter: Exclude<ContextMeter, { kind: "hidden" }>
  label: string
}) {
  const ceiling = meter.kind === "ratio" ? meter.ceiling : undefined
  const copy =
    ceiling?.kind === "autocompact"
      ? autocompactCopy(ceiling, label)
      : ceiling?.kind === "sem-autocompact"
        ? `A compactação automática do ${label} está desligada: quando a janela encher, o turno falha. Compacte antes.`
        : meter.kind === "unavailable"
      ? "O agent não informou uma medição confiável neste turno. O total processado no turno não é usado como contexto."
      : meter.kind === "absolute"
        ? "A última chamada é conhecida, mas a janela não. Por isso o percentual e o disponível foram omitidos."
        : meter.kind === "incompatible"
          ? "A medição e a janela não combinam. O percentual foi ocultado em vez de forçar 100%."
          : meter.windowSource === "runtime"
            ? "Última chamada concluída · janela informada pelo agent."
            : "Última chamada concluída · janela estimada pelo catálogo do modelo."
  return <p className="mt-2 border-t pt-2 text-[11px] leading-snug text-muted-foreground">{copy}</p>
}

/** A confiança muda com a origem, então a frase também (ADR-198). */
function autocompactCopy(
  ceiling: Extract<ContextCeiling, { kind: "autocompact" }>,
  label: string,
) {
  const limite = exactTokens(ceiling.tokens)
  if (ceiling.origin === "engine-record") {
    return `O ${label} resume a conversa sozinho quando a estimativa dele passa de ${limite} tokens, antes de a janela do modelo encher. Lido do registro local da conversa, que não é contrato do motor.`
  }
  if (ceiling.origin === "engine-config") {
    return `O ${label} resume a conversa sozinho ao chegar em ${limite} tokens. Calculado da configuração e do catálogo de modelos do próprio ${label}.`
  }
  return `O ${label} resume a conversa sozinho ao chegar em ${limite} tokens. Limiar lido do próprio motor.`
}

function windowLabel(window: number, source: "runtime" | "catalog") {
  return `${source === "catalog" ? "≈ " : ""}${exactTokens(window)}`
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd
        className={cn("min-w-0 truncate text-right text-foreground/90", mono && "font-mono text-[11px]")}
        title={v}
      >
        {v}
      </dd>
    </div>
  )
}
