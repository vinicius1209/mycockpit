// O VOCABULÁRIO DE INTERVENÇÃO da missão (R7 do docs/mocks/missao-README.md).
//
// "Pausar" NÃO existe aqui, e a ausência é a decisão: não há pausa real de um
// turno de agent. Dá pra matar o processo, e dá pra não começar o próximo. Um
// botão "Pausar" mentiria sobre o que acontece com o processo. O que existe:
//
//   segurar no fim desta fase  a fase termina normal; a próxima não começa sem
//                              você. Nada é interrompido agora.        REVERSÍVEL
//   interromper esta fase      mata o processo AGORA; o que já foi escrito
//                              continua no worktree; a fase fica incompleta e a
//                              missão segura.                      IRREVERSÍVEL
//   parar missão               mata a corrente e cancela as que faltam.
//                                                                  IRREVERSÍVEL
//
// O PREÇO de interromper difere POR MOTOR e é dito ANTES do clique: quem tem
// `sessionResume` retoma a sessão; quem não tem roda a fase inteira de novo. A
// decisão sai do registry (lib/agents), nunca de `id === "agy"`.
//
// Puro: sem store, sem React.

import { agentDef } from "@/lib/agents"

export type GestureId = "segurar" | "interromper" | "parar"

export interface GestureSpec {
  id: GestureId
  label: string
  /** O que acontece, em uma frase. */
  effect: string
  reversible: boolean
}

export const MISSION_GESTURES: Record<GestureId, GestureSpec> = {
  segurar: {
    id: "segurar",
    label: "Segurar no fim desta fase",
    effect:
      "a fase corrente termina normal, e a próxima não começa sem você. Nada é interrompido agora",
    reversible: true,
  },
  interromper: {
    id: "interromper",
    label: "Interromper esta fase",
    effect:
      "mata o processo agora. O que já foi escrito continua no worktree, a fase fica incompleta e a missão segura",
    reversible: false,
  },
  parar: {
    id: "parar",
    label: "Parar missão",
    effect:
      "mata a fase corrente e cancela as que faltam. O worktree e os handoffs ficam no disco",
    reversible: false,
  },
}

/**
 * O preço de INTERROMPER esta fase, por motor. Sai da capability
 * `sessionResume`, não do nome: motor que retoma sessão perde só o resto do
 * turno; motor que não retoma perde a fase inteira, e quem clica precisa saber
 * disso antes.
 *
 * Motor fora do registry cai no lado pessimista (é o mesmo "na dúvida, false"
 * do registro): prometer retomada que não existe é o erro caro.
 */
export function interruptPrice(agentId: string): string {
  const def = agentDef(agentId)
  const nome = def?.shortLabel ?? agentId
  if (def?.sessionResume) {
    return `o ${nome} retoma a sessão, então re-rodar continua de onde parou`
  }
  return `o ${nome} não retoma sessão: re-rodar significa a fase inteira do zero`
}

/** O preço de PARAR a missão em um grafo. O ledger só materializa a próxima
 * visita depois de resolver a atual, portanto contar "fases restantes" seria
 * uma precisão falsa. */
export function stopPrice(args: { costLabel: string }): string {
  return `a rota restante não será executada, e o gasto até aqui (${args.costLabel}) não volta`
}
