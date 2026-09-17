// Quais motores o seletor de identidade mostra (revezamento PRD R2). Conversa
// nova escolhe entre todos. Conversa já iniciada troca de motor por
// revezamento, então o trilho mostra o motor atual e só os destinos elegíveis
// (`eligibleHandoffTargets`, a mesma regra da faixa de continuidade): motor
// ausente, sem login ou com cota esgotada não aparece como opção de revezar.

export function motoresDoTrilho(
  todos: readonly string[],
  contexto: { locked: boolean; ativo: string; elegiveis: readonly string[] },
): string[] {
  if (!contexto.locked) return [...todos]
  const permitidos = new Set([contexto.ativo, ...contexto.elegiveis])
  return todos.filter((id) => permitidos.has(id))
}

export const ROTULO_MESMO_MOTOR = "Mesmo motor · mantém a sessão"
export const ROTULO_OUTRO_MOTOR = "Outro motor · sessão nova com a memória desta"
