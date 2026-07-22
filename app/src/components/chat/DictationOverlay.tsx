// Pill de gravação estilo Wispr Flow: OVERLAY absoluto que paira sobre a UI —
// nunca participa do fluxo (zero reflow na fileira de controles). Agnóstico de
// dono: o MicButton (Trabalho) e os docks do office (bridge/voice) passam o
// parcial + o início da gravação; o posicionamento vem por className do
// chamador (o wrapper aqui é `absolute` sem âncora própria).
//
// Parcial: truncamento PELO COMEÇO — as últimas palavras ditas ficam sempre
// visíveis (clipPartialStart, pura/testada) — em até 2 linhas ancoradas no pé
// com fade no topo. prefers-reduced-motion: sem animação (dot estático, corte
// na entrada/saída).
import { useEffect, useState } from "react"
import { formatHotkey } from "@/lib/dictationHotkey"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Teto de caracteres do parcial exibido (≈2 linhas do pill). */
export const PARTIAL_CLIP_CHARS = 160

/** Trunca PELO COMEÇO: mantém a cauda (últimas palavras) e prefixa "…".
 *  Tenta cortar em fronteira de palavra sem perder mais que ~20 chars. */
export function clipPartialStart(
  text: string,
  max: number = PARTIAL_CLIP_CHARS,
): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  const cut = t.length - max
  let tail = t.slice(cut)
  if (t[cut - 1] !== " ") {
    // o corte caiu no MEIO de uma palavra: descarta o pedaço órfão, se a
    // fronteira estiver perto (não vale perder uma "palavra" gigante inteira).
    const sp = tail.indexOf(" ")
    if (sp >= 0 && sp <= 20) tail = tail.slice(sp + 1)
  }
  return `…${tail.trimStart()}`
}

/** mm:ss decorrido desde `since`, com tick de 1s. */
function useClock(since: number): string {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const s = Math.max(0, Math.floor((now - since) / 1000))
  const mm = String(Math.floor(s / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

/** O pill em si (dot pulsante + mm:ss + parcial + dica). Sem posicionamento —
 *  quem posiciona é o DictationOverlay/chamador. A dica default reflete o
 *  atalho CONFIGURADO (settings.dictationHotkey; null ⇒ só o Esc). */
export function DictationPill({
  partial,
  since,
  hint,
}: {
  partial: string | null
  since: number
  hint?: string
}) {
  const combo = useApp((s) => s.settings.dictationHotkey)
  const resolvedHint =
    hint ?? (combo ? `Esc cancela · ${formatHotkey(combo)} para` : "Esc cancela")
  const clock = useClock(since)
  const text = partial?.trim() ? clipPartialStart(partial) : ""
  return (
    <div className="pointer-events-none flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border border-st-error/40 bg-card py-1.5 pr-3.5 pl-3 shadow-[var(--shadow-pop)]">
      <span className="size-2 shrink-0 rounded-full bg-st-error motion-safe:animate-pulse" />
      {/* relógio fora do live region — senão o leitor de tela anuncia a cada
          segundo; o parcial (abaixo) é quem fala. */}
      <span
        aria-hidden="true"
        className="shrink-0 font-mono text-[11.5px] tabular-nums text-st-error"
      >
        {clock}
      </span>
      <div className="min-w-0 flex-1">
        {/* 2 linhas ancoradas no PÉ (últimas palavras sempre visíveis) com
            fade no topo — o excesso some por cima, nunca o fim da fala. */}
        <div className="flex max-h-[34px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_0,black_45%)]">
          <p
            aria-live="polite"
            className={cn(
              "text-[12px] leading-[17px] break-words",
              text ? "text-foreground/85" : "text-muted-foreground",
            )}
          >
            {text || "Ouvindo…"}
          </p>
        </div>
        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground/70">
          {resolvedHint}
        </p>
      </div>
    </div>
  )
}

/** Wrapper flutuante: entrada/saída fade+slide 140ms (reduced-motion ⇒ corte)
 *  e desmonte adiado pra saída animar. `className` posiciona (ex.:
 *  "absolute inset-x-0 bottom-full mb-2") — o wrapper não ancora sozinho. */
export function DictationOverlay({
  active,
  partial,
  since,
  hint,
  className,
}: {
  active: boolean
  partial: string | null
  since: number
  hint?: string
  className?: string
}) {
  const [shown, setShown] = useState(active)
  useEffect(() => {
    if (active) {
      setShown(true)
      return
    }
    const t = setTimeout(() => setShown(false), 140)
    return () => clearTimeout(t)
  }, [active])
  if (!shown && !active) return null
  const exiting = !active
  return (
    <div
      className={cn(
        "pointer-events-none z-40 flex justify-center",
        exiting
          ? "motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-bottom-1 motion-safe:duration-[140ms] motion-safe:fill-mode-forwards"
          : "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-[140ms]",
        className,
      )}
    >
      <DictationPill partial={partial} since={since} hint={hint} />
    </div>
  )
}
