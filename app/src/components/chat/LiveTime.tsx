// Os dois números que TICAM no fio, isolados do componente que os hospeda: o
// cronômetro do turno vivo e a idade do último evento do grupo. Ambos mantêm o
// próprio intervalo de 1s, então ficar fora do `MessageList` evita que um
// re-render deles arraste a árvore junto.
import { useEffect, useState } from "react"
import { fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Cronômetro ao vivo enquanto o run pensa (atualiza a cada 1s). */
export function Elapsed({ since, className }: { since: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className={cn("tabular-nums", className)}>{fmtDuration(now - since)}</span>
  )
}

/** Idade do último evento do grupo vivo, na MESMA régua do `fmtDuration` que
 *  aparece ao lado (h/min/s, unidade explícita). Um trabalho em background de
 *  3h escrevia "há 180min" enquanto o vizinho escrevia "3h 00min": duas
 *  gramáticas de tempo em elementos adjacentes.
 *
 *  Acima de um minuto NÃO mostra segundos de propósito, ao contrário do
 *  `fmtDuration`: aqui o número tica sozinho a cada segundo, e um dígito
 *  correndo ao lado de um relógio congelado é ruído, não informação (§6 R1,
 *  cronômetro estável). Abaixo de 60s os segundos são o detector de travamento
 *  e continuam inteiros. */
export function activityAgeLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 5) return "agora"
  if (seconds < 60) return `há ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `há ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h ${String(minutes % 60).padStart(2, "0")}min`
  return `há ${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`
}

export function ActivityAge({ at, stalled }: { at?: number; stalled?: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!at) return null
  const label = activityAgeLabel(now - at)
  return (
    <span className={cn("font-mono text-[11px]", stalled && "text-st-warning")}>
      {stalled ? "sem eventos " : "atividade "}
      {label}
    </span>
  )
}
