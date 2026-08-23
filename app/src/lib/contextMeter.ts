import { contextWindowFor } from "@/lib/contextWindow"
import type { ContextBasis } from "@/lib/contextSnapshot"

export type ContextWindowSource = "runtime" | "catalog"

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
      pct: number
      windowSource: ContextWindowSource
    }

/** Converte o snapshot persistido numa apresentação honesta. A função não
 *  clampa contradições para 100% e nunca deduz uma janela pelo consumo. */
export function contextMeter(input: {
  basis?: ContextBasis
  tokens?: number
  runtimeWindow?: number
  model: string | null
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
  return {
    kind: "ratio",
    tokens,
    window,
    free: window - tokens,
    pct: tokens / window,
    windowSource,
  }
}
