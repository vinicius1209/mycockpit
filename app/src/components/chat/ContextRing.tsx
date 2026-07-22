import { useEffect, useRef, useState } from "react"
import { useActiveConv } from "@/store/chat"
import { contextWindowFor } from "@/lib/agents"
import { fmtTokens } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Anel minimalista de uso do contexto (padrão Cursor): preenche conforme o
 *  footprint da última chamada vs a janela do modelo. Clicável → popover com o
 *  detalhamento. Some quando não há dado ou a janela é desconhecida. */
export function ContextRing() {
  const conv = useActiveConv()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // fecha ao clicar fora / Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const tokens = conv.contextTokens ?? 0
  let win = contextWindowFor(conv.model)
  // observado excede a janela base → a sessão roda na janela de 1M.
  if (win && tokens > win) win = 1_000_000
  if (!tokens || !win) return null

  const pct = Math.min(1, tokens / win)
  const C = 2 * Math.PI * 8
  const color =
    pct > 0.9 ? "text-st-error" : pct > 0.7 ? "text-st-warning" : "text-brass"
  const is1m = win >= 1_000_000
  const free = Math.max(0, win - tokens)

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`contexto: ~${fmtTokens(tokens)} de ${fmtTokens(win)} (${Math.round(pct * 100)}%) — clique p/ detalhes`}
        aria-label="Detalhes do contexto"
        className="grid size-6 place-items-center rounded-full hover:bg-accent"
      >
        <svg viewBox="0 0 20 20" className="size-4 -rotate-90">
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="2.5"
            className="stroke-border"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`}
            className={cn("stroke-current transition-all duration-500", color)}
          />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-2 w-64 overflow-hidden rounded-xl border bg-popover p-3 shadow-[var(--shadow-pop)]">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-foreground">
              Contexto
            </span>
            <span className={cn("font-mono text-[13px] tabular-nums", color)}>
              {Math.round(pct * 100)}%
            </span>
          </div>
          {/* barra */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className={cn("h-full rounded-full bg-current transition-all", color)}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <dl className="mt-3 space-y-1.5 text-[12px]">
            <Row k="Modelo" v={conv.model ?? "—"} mono />
            <Row k="Janela" v={`${fmtTokens(win)}${is1m ? " (1M)" : ""}`} />
            <Row k="Em uso" v={`~${fmtTokens(tokens)}`} />
            <Row k="Livre" v={`~${fmtTokens(free)}`} />
          </dl>
          {!is1m && (conv.model ?? "").toLowerCase().includes("opus") && (
            <p className="mt-2 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
              Precisa de mais? Escolha <span className="text-foreground">Opus 4.8</span>{" "}
              (pin com 1M nativo) no seletor de modelo numa conversa nova.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-foreground/90",
          mono && "font-mono text-[11px]",
        )}
        title={v}
      >
        {v}
      </dd>
    </div>
  )
}
