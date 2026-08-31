import type { AgentEvent } from "@/lib/agent"
import { withObservedNativeToolCount, type EffectiveRunManifest } from "@/lib/tooling"

/** Reduz apenas o snapshot efetivo do run, fora do store monolítico. */
export function reduceRunManifest(
  current: EffectiveRunManifest | undefined,
  event: AgentEvent,
): { runManifest?: EffectiveRunManifest } {
  if (event.type === "run_manifest") return { runManifest: event.manifest }
  if (event.type === "session" && current) {
    return {
      runManifest: withObservedNativeToolCount(current, event.tools),
    }
  }
  return {}
}
