import { contextWindowFor } from "@/lib/contextWindow"
import type { ContextBasis } from "@/lib/contextSnapshot"

export type ContextWindowSource = "runtime" | "catalog"

/** Teto que o PRÓPRIO motor aplica (ADR-196). `autocompact`: ponto em que ele
 *  resume a conversa sozinho. `sem-autocompact`: a compactação automática está
 *  desligada, então o teto é a janela e encher significa o turno falhar. */
export type ContextCeilingOrigin = "engine-report" | "engine-config" | "engine-record"

export type ContextCeiling =
  | {
      kind: "autocompact"
      tokens: number
      origin?: ContextCeilingOrigin
      /** Contagem PRÓPRIA do motor comparada ao limiar, quando ele não usa o
       *  uso da API (agy: estimativa da última geração). Com ela, o
       *  percentual é o do motor, e o "Última chamada" segue o da API. */
      engineCount?: number
    }
  | { kind: "sem-autocompact"; tokens: number; origin?: ContextCeilingOrigin }

export type ContextMeter =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "absolute"; tokens: number }
  | {
      kind: "incompatible"
      tokens: number
      window: number
      windowSource: ContextWindowSource
    }
  | {
      kind: "ratio"
      tokens: number
      window: number
      free: number
      /** Fração do teto efetivo: o limiar do motor quando conhecido, senão
       *  a janela. Passa de 1 quando o próximo turno já compacta. */
      pct: number
      windowSource: ContextWindowSource
      ceiling?: ContextCeiling
    }

/** Converte o snapshot persistido numa apresentação honesta. A função não
 *  clampa contradições para 100% e nunca deduz uma janela pelo consumo. */
export function contextMeter(input: {
  basis?: ContextBasis
  tokens?: number
  runtimeWindow?: number
  model: string | null
  /** Leitura do motor; ausente = a janela é o teto e nada se afirma. */
  ceiling?: ContextCeiling | null
}): ContextMeter {
  if (input.basis == null) return { kind: "hidden" }
  if (input.basis === "unavailable") return { kind: "unavailable" }
  if (!Number.isFinite(input.tokens) || (input.tokens ?? 0) <= 0) {
    return { kind: "unavailable" }
  }
  const tokens = input.tokens!
  const runtimeWindow =
    Number.isFinite(input.runtimeWindow) && (input.runtimeWindow ?? 0) > 0
      ? input.runtimeWindow!
      : null
  const catalogWindow = runtimeWindow == null ? contextWindowFor(input.model) : null
  const window = runtimeWindow ?? catalogWindow
  if (window == null) return { kind: "absolute", tokens }
  const windowSource: ContextWindowSource =
    runtimeWindow == null ? "catalog" : "runtime"
  if (tokens > window) {
    return { kind: "incompatible", tokens, window, windowSource }
  }
  const ceiling =
    input.ceiling && input.ceiling.tokens > 0 && input.ceiling.tokens <= window
      ? input.ceiling
      : null
  if (!ceiling) {
    return { kind: "ratio", tokens, window, free: window - tokens, pct: tokens / window, windowSource }
  }
  const measured =
    ceiling.kind === "autocompact" && ceiling.engineCount != null
      ? ceiling.engineCount
      : tokens
  return {
    kind: "ratio",
    tokens,
    window,
    free: Math.max(0, ceiling.tokens - measured),
    pct: measured / ceiling.tokens,
    windowSource,
    ceiling,
  }
}
