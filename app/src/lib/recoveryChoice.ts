// Normalização PURA da escolha de recuperação de missão — fonte única dos DOIS
// cards de recovery (office/ui/MissionDock e components/mission/MissionTimeline).
// Morava em office/ui/recovery.ts; subiu pra lib/ porque a direção de import da
// casa é office → components/lib, nunca o contrário (o office re-exporta).
import type { RecoveryChoice } from "@/lib/missionTypes"

/** Monta a escolha de recuperação a partir do que o usuário selecionou no card.
 *  "default" (1ª opção dos seletores do registry) vira null = deixa o agent
 *  decidir — mesma semântica do reqModel/effort do resto do app. */
export function buildRecoveryChoice(
  agent: string,
  model: string | null,
  effort: string | null = null,
): RecoveryChoice {
  return {
    agent,
    model: model && model !== "default" ? model : null,
    effort: effort && effort !== "default" ? effort : null,
  }
}
