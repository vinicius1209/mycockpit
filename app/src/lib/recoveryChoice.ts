// Normalização PURA da escolha de recuperação de missão — fonte única do card
// de recovery (components/mission/MissionTimeline). Nasceu no ex-Escritório
// (removido em R2 do office-removal-plan) e subiu pra lib/ ainda naquela era.
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
