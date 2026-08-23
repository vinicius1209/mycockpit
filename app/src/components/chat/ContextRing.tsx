import { useEffect, useRef, useState } from "react"
import { useActiveConv, useChat, type ConvState } from "@/store/chat"
import { contextMeter, type ContextMeter } from "@/lib/contextMeter"
import { compactActionHint, offersCompactAction } from "@/lib/compact"
import { METER_TEXT, meterIsLoud, meterTone } from "@/lib/meter"
import { cn } from "@/lib/utils"

const C = 2 * Math.PI * 8
const exactTokens = (value: number) => value.toLocaleString("pt-BR")

/** Medidor da última chamada ao modelo. Percentual só existe quando tokens e
 *  janela são compatíveis; legado e falhas de fonte nunca viram 100% fictício. */
export function ContextRing() {
  const conv = useActiveConv()
  return <ContextRingView conv={conv} />
}

/** View exportada para validar os estados sem depender do snapshot SSR da store. */
export function ContextRingView({
  conv,
  initiallyOpen = false,
}: {
  conv: ConvState
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const wrapRef = useRef<HTMLDivElement>(null)
  const meter = contextMeter({
    basis: conv.contextBasis,
    tokens: conv.contextTokens,
    runtimeWindow: conv.contextWindow,
    model: conv.model,
  })

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
  const color = ratio ? METER_TEXT[meterTone(pct100!)] : "text-muted-foreground"
  const loud = pct100 != null && meterIsLoud(pct100)
  const title = ratio
    ? `contexto: ${Math.round(pct100!)}% da janela (${exactTokens(ratio.tokens)} de ${exactTokens(ratio.window)} tokens)`
    : meter.kind === "unavailable"
      ? "contexto: medição indisponível · clique para entender"
      : "contexto: sem percentual confiável · clique para entender"

  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      {loud && (
        <span className={cn("font-mono text-[11px] tabular-nums", color)}>
          contexto {Math.round(pct100!)}%
        </span>
      )}
      <button
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-label="Detalhes do contexto"
        aria-expanded={open}
        className="grid size-6 place-items-center rounded-full hover:bg-accent"
      >
        <svg viewBox="0 0 20 20" className="col-start-1 row-start-1 size-4 -rotate-90">
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" className="stroke-border" />
          {ratio && (
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${ratio.pct * C} ${C}`}
              className={cn("stroke-current transition-all duration-500", color)}
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
          <ContextDetails meter={meter} model={conv.model} />
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

function ContextDetails({ meter, model }: { meter: Exclude<ContextMeter, { kind: "hidden" }>; model: string | null }) {
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
            style={{ width: `${ratio.pct * 100}%` }}
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
      <Explanation meter={meter} />
    </>
  )
}

function RatioRows({ meter }: { meter: Extract<ContextMeter, { kind: "ratio" }> }) {
  return (
    <>
      <Row k="Janela" v={windowLabel(meter.window, meter.windowSource)} />
      <Row k="Última chamada" v={exactTokens(meter.tokens)} />
      <Row k="Disponível" v={exactTokens(meter.free)} />
    </>
  )
}

function Explanation({ meter }: { meter: Exclude<ContextMeter, { kind: "hidden" }> }) {
  const copy =
    meter.kind === "unavailable"
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
