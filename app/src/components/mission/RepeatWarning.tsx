// O aviso de REPETIÇÃO da fase viva (R11). Mora colado na fase, não num painel
// próprio, e só existe quando os DOIS fatores estão de pé (lib/missionRepeat).
//
// A amostragem do worktree é ligada AQUI e só aqui: o efeito só roda quando o
// primeiro fator já disparou, então em missão saudável nenhum git é executado.
// Enquanto a primeira amostra não volta, o aviso não aparece — "ainda não sei"
// não é "não mudou".
//
// O app nunca aborta sozinho: o gesto oferecido é o de sempre, e o preço dele
// é dito antes do clique (lib/missionGestures).

import { useEffect, useState } from "react"
import {
  repeatCandidate,
  repeatWarning,
  type RepeatWarning as RepeatWarningData,
} from "@/lib/missionRepeat"
import {
  PULSE_INTERVAL_MS,
  sampleWorktreeChangedAt,
} from "@/lib/missionWorktreePulse"
import type { MissionPhaseRun } from "@/lib/missionTypes"

/**
 * Calcula o aviso da fase, ligando a amostragem do worktree só quando vale.
 * Devolve null quando não há suspeita OU quando o worktree não pôde ser lido.
 */
export function useRepeatWarning(
  phase: MissionPhaseRun,
  cwd: string,
  now: number,
): RepeatWarningData | null {
  const candidate = repeatCandidate(phase.items)
  const suspeita = candidate != null
  const [changedAt, setChangedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!suspeita || !cwd) {
      setChangedAt(null)
      return
    }
    let vivo = true
    const amostra = () => {
      void sampleWorktreeChangedAt(cwd).then((at) => {
        if (vivo) setChangedAt(at)
      })
    }
    amostra()
    const id = setInterval(amostra, PULSE_INTERVAL_MS)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [suspeita, cwd])

  return repeatWarning(candidate, changedAt, now)
}

export function RepeatWarningCard({
  warning,
  onInterrupt,
  interruptPrice,
}: {
  warning: RepeatWarningData
  onInterrupt?: () => void
  /** O preço do gesto, por motor, dito ANTES do clique. */
  interruptPrice?: string
}) {
  return (
    <div className="mt-2.5 rounded-[9px] border border-st-warning/45 bg-st-warning/[0.07] px-3 py-2.5">
      <div className="label-mono text-st-warning">{warning.headline}</div>
      <p className="mt-1 text-[13px] leading-snug">
        {warning.observed}
      </p>
      <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
        {warning.command}
      </p>
      {/* quem conclui "travou" é você: a tela relata o observado e oferece o
          gesto, com o preço na frente */}
      {onInterrupt && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onInterrupt}
            className="rounded-md border border-border-strong px-2.5 py-1 text-[12px] transition-colors hover:bg-accent"
          >
            Interromper esta fase
          </button>
          {interruptPrice && (
            <span className="text-[11px] text-faint">{interruptPrice}</span>
          )}
        </div>
      )}
    </div>
  )
}
