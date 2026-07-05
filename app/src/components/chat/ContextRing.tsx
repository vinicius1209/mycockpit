import { useActiveConv } from "@/store/chat"
import { contextWindowFor } from "@/lib/agents"
import { fmtTokens } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Anel minimalista de uso do contexto (padrão Cursor): preenche conforme o
 *  footprint da última chamada vs a janela do modelo. Some quando não há dado
 *  ou a janela é desconhecida (nunca inventa porcentagem). */
export function ContextRing() {
  const conv = useActiveConv()
  const tokens = conv.contextTokens ?? 0
  let win = contextWindowFor(conv.model)
  // observado excede a janela base → a sessão roda na janela de 1M.
  if (win && tokens > win) win = 1_000_000
  if (!tokens || !win) return null

  const pct = Math.min(1, tokens / win)
  const C = 2 * Math.PI * 8
  const color =
    pct > 0.9 ? "text-st-error" : pct > 0.7 ? "text-st-warning" : "text-brass"
  return (
    <span
      title={`contexto: ~${fmtTokens(tokens)} de ${fmtTokens(win)} (${Math.round(pct * 100)}%)`}
      className="grid size-6 place-items-center"
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
    </span>
  )
}
