import { useEffect, useRef, useState } from "react"
import { useActiveConv, useChat } from "@/store/chat"
import { contextWindowFor } from "@/lib/agents"
import { compactActionHint, offersCompactAction } from "@/lib/compact"
import { fmtTokens } from "@/lib/format"
import { METER_TEXT, meterIsLoud, meterTone } from "@/lib/meter"
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
  // Paleta única de medidor (lib/meter, STYLEGUIDE §2): cinza < 60, âmbar
  // 60 a 80, vermelho 80+. Anel saudável NÃO é brass (brass é gesto).
  const color = METER_TEXT[meterTone(pct * 100)]
  const is1m = win >= 1_000_000
  const free = Math.max(0, win - tokens)

  // No vermelho o anel PARA de ser mudo: um arco de 16px passa batido (foi o
  // que aconteceu, o contexto bateu 100% e nada avisou). Aqui o número entra
  // como texto ao lado, junto do que vai acontecer.
  const loud = meterIsLoud(pct * 100)
  return (
    <div ref={wrapRef} className="relative flex items-center gap-1">
      {loud && (
        <span
          className={cn("font-mono text-[10.5px] tabular-nums", color)}
          title="Quando enche, o CLI compacta a conversa sozinho (o detalhe antigo vira resumo)."
        >
          contexto {Math.round(pct * 100)}%
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title={`contexto: ~${fmtTokens(tokens)} de ${fmtTokens(win)} (${Math.round(pct * 100)}%) · clique p/ detalhes`}
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
          {loud && (
            <p className="mt-2 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
              Quando encher, o CLI <span className="text-foreground">compacta a
              conversa</span> sozinho: o histórico antigo vira resumo e o turno
              segue. Você vê o aviso no fio quando acontecer.
            </p>
          )}
          {/* ≥70% (offersCompactAction): a ação de compactar entra no menu.
              Dispara o MESMO fluxo do builtin /compactar (queuePrompt → o
              handleSend intercepta; turno rodando → entra na fila). O tooltip
              diz o que VAI acontecer conforme o motor (nativo vs renovação
              com resumo, lib/compact). */}
          {offersCompactAction(pct) && (
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
          {!is1m && (conv.model ?? "").toLowerCase().includes("opus") && (
            <p className="mt-2 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
              Precisa de mais? Escolha <span className="text-foreground">Opus 5</span>{" "}
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
