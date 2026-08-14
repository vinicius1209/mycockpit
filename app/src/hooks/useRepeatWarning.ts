// A amostragem do worktree para o aviso de repetição (R11). Hook separado do
// componente de propósito: ele liga um efeito com interval, e é o único ponto
// do app que roda git por conta própria — só quando o primeiro fator já
// disparou, e só enquanto a suspeita durar.
//
// Enquanto a primeira amostra não volta, o aviso NÃO aparece: "ainda não sei"
// não é "não mudou".

import { useEffect, useState } from "react"
import {
  repeatCandidate,
  repeatWarning,
  type RepeatWarning,
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
): RepeatWarning | null {
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
