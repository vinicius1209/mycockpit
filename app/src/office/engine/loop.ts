/** Game loop — Fix Your Timestep (O3): acumulador com clamp de MAX_FRAME_MS,
 *  sim em passos fixos de SIM_DT, render(alpha) com o resto interpolável.
 *  StrictMode-safe: start() idempotente; stop() cancela o rAF; retomada
 *  re-zera `last` (sem delta gigante ao voltar de pausa/oclusão).
 */
import { MAX_FRAME_MS, SIM_DT } from "./types"
import { perfFrame } from "./perf"

export type OfficeLoop = {
  start(): void
  stop(): void
  readonly running: boolean
}

export function createLoop(opts: {
  simulate: (dt: number) => void
  render: (alpha: number) => void
}): OfficeLoop {
  const SIM_DT_MS = SIM_DT * 1000
  let running = false
  let rafId = 0
  let last: number | null = null
  let acc = 0

  const frame = (now: number) => {
    if (!running) return
    if (last === null) last = now
    let delta = now - last
    last = now
    perfFrame(delta) // telemetria de hitch (dt BRUTO; no-op sem mc.office.perf)
    if (delta > MAX_FRAME_MS) delta = MAX_FRAME_MS // anti espiral da morte
    if (delta < 0) delta = 0
    acc += delta
    while (acc >= SIM_DT_MS) {
      opts.simulate(SIM_DT)
      acc -= SIM_DT_MS
    }
    opts.render(acc / SIM_DT_MS)
    rafId = requestAnimationFrame(frame)
  }

  return {
    start() {
      if (running) return // StrictMode monta 2× — idempotente
      running = true
      last = null // retomada re-zera o relógio
      rafId = requestAnimationFrame(frame)
    },
    stop() {
      if (!running) return
      running = false
      cancelAnimationFrame(rafId)
    },
    get running() {
      return running
    },
  }
}
