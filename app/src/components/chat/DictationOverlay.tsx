// Pill de gravação estilo Wispr Flow: OVERLAY absoluto que paira sobre a UI —
// nunca participa do fluxo (zero reflow na fileira de controles). Agnóstico de
// dono: quem grava (hoje só o MicButton do Trabalho) passa o parcial + o
// início da gravação; o posicionamento vem por className do chamador (o
// wrapper aqui é `absolute` sem âncora própria).
//
// Parcial: truncamento PELO COMEÇO — as últimas palavras ditas ficam sempre
// visíveis (clipPartialStart, pura/testada) — em até 2 linhas ancoradas no pé
// com fade no topo. prefers-reduced-motion: sem animação (dot estático, corte
// na entrada/saída).
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { formatHotkey } from "@/lib/dictationHotkey"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Fases do ditado como a UI as vê (espelho do MicState do MicButton). */
export type DictationPhase = "idle" | "starting" | "rec" | "busy"

/** Regra do pill por fase (pura, testada). Soltar o botão NÃO é o fim: o
 *  sidecar ainda drena o microfone e relê o áudio da sessão inteiro antes de
 *  devolver o texto (D1/D2 do docs/dictation-plan.md). Por isso o pill CONTINUA
 *  visível em "busy", agora dizendo "finalizando" — em vez de sumir e deixar o
 *  usuário achar que acabou enquanto o texto ainda está vindo. */
export function dictationPillView(phase: DictationPhase): {
  visible: boolean
  finalizing: boolean
  placeholder: string
  hint?: string
} {
  if (phase === "rec") {
    return { visible: true, finalizing: false, placeholder: "Ouvindo…" }
  }
  if (phase === "busy") {
    return {
      visible: true,
      finalizing: true,
      placeholder: "Finalizando…",
      hint: "Transcrevendo o áudio, o texto cai no rascunho",
    }
  }
  return { visible: false, finalizing: false, placeholder: "Ouvindo…" }
}

/** Teto de caracteres do parcial exibido (≈2 linhas do pill). */
export const PARTIAL_CLIP_CHARS = 160

/** Alturas do medidor neutro, derivadas somente do nível real recebido. */
export function inputSignalBars(level: number): [number, number, number] {
  const safe = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  return [
    Math.round(3 + safe * 5),
    Math.round(3 + safe * 9),
    Math.round(3 + safe * 7),
  ]
}

export function inputSignalLabel(level: number): string {
  if (!Number.isFinite(level) || level < 0.08) return "Sem sinal do microfone"
  if (level < 0.28) return "Sinal baixo do microfone"
  return "Sinal presente no microfone"
}

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
 *  atalho CONFIGURADO (settings.dictationHotkey; null ⇒ só o Esc).
 *  `finalizing`: o mic já fechou e o texto está a caminho (dot vira spinner,
 *  vermelho sai — não está mais gravando, e a UI não pode fingir que está). */
export function DictationPill({
  partial,
  since,
  hint,
  deviceName,
  level = 0,
  finalizing = false,
  placeholder = "Ouvindo…",
}: {
  partial: string | null
  since: number
  hint?: string
  deviceName?: string | null
  level?: number
  finalizing?: boolean
  placeholder?: string
}) {
  const combo = useApp((s) => s.settings.dictationHotkey)
  const actionHint =
    hint ??
    (combo ? `Esc cancela · ${formatHotkey(combo)} para` : "Esc cancela")
  const resolvedHint = [deviceName?.trim(), actionHint]
    .filter(Boolean)
    .join(" · ")
  const clock = useClock(since)
  const text = partial?.trim() ? clipPartialStart(partial) : ""
  const safeLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
  const bars = inputSignalBars(safeLevel)
  return (
    <div
      className={cn(
        "pointer-events-none flex min-w-0 max-w-full items-center gap-2.5 rounded-xl border bg-card py-1.5 pr-3.5 pl-3 shadow-[var(--shadow-pop)]",
        finalizing ? "border-border" : "border-st-error/40",
      )}
    >
      {finalizing ? (
        <Loader2 className="size-2.5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
      ) : (
        <span className="size-2 shrink-0 rounded-full bg-st-error motion-safe:animate-pulse" />
      )}
      {!finalizing && (
        <span
          role="meter"
          aria-label={inputSignalLabel(level)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(safeLevel * 100)}
          className="flex h-3 w-4 shrink-0 items-end justify-center gap-px"
        >
          {bars.map((height, index) => (
            <span
              // Os índices são posições fixas do medidor, não itens mutáveis.
              key={index}
              className="w-1 rounded-full bg-muted-foreground/70 transition-[height] duration-75 motion-reduce:transition-none"
              style={{ height }}
            />
          ))}
        </span>
      )}
      {/* relógio fora do live region — senão o leitor de tela anuncia a cada
          segundo; o parcial (abaixo) é quem fala. */}
      <span
        aria-hidden="true"
        className={cn(
          "shrink-0 font-mono text-[12px] tabular-nums",
          finalizing ? "text-muted-foreground" : "text-st-error",
        )}
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
            {text || placeholder}
          </p>
        </div>
        <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground/70">
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
  deviceName,
  level,
  finalizing = false,
  placeholder,
  className,
}: {
  active: boolean
  partial: string | null
  since: number
  hint?: string
  deviceName?: string | null
  level?: number
  finalizing?: boolean
  placeholder?: string
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
      <DictationPill
        partial={partial}
        since={since}
        hint={hint}
        deviceName={deviceName}
        level={level}
        finalizing={finalizing}
        placeholder={placeholder}
      />
    </div>
  )
}
