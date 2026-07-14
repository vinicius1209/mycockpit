// "Planejar primeiro" (plan mode por turno): lógica PURA do lado front.
// O motor (Rust) segura os writes quando o run vai com plan_first=true; aqui
// mora só o que a UI decide — o prompt de execução pós-aprovação por agent e a
// captura do texto do plano no fio da conversa.

import type { ChatItem } from "@/store/chat"

/** Tooltip do toggle no composer (fonte única p/ o botão). */
export const PLAN_FIRST_TOOLTIP =
  "Planejar primeiro — o agent propõe um plano e só executa depois da sua aprovação"

/** Agents SEM resume (cada turno é fresh): o prompt de execução precisa
 *  EMBUTIR o texto do plano, senão o agent não sabe o que aprovamos. */
const NO_RESUME_AGENTS = new Set(["agy"])

/** true se o agent não tem resume (o plano vai embutido no prompt de execução). */
export function needsPlanEmbedded(agent: string): boolean {
  return NO_RESUME_AGENTS.has(agent)
}

/** Prompt do turno de EXECUÇÃO pós-aprovação:
 *  - claude/codex: o resume da conversa preserva o contexto do plano → basta
 *    mandar executar (turno seguinte normal).
 *  - agy: sem resume → embute o texto do plano aprovado. */
export function buildExecutionPrompt(agent: string, planText: string): string {
  if (needsPlanEmbedded(agent)) {
    return `Plano aprovado — execute-o agora:\n\n${planText}`
  }
  return "Plano aprovado. Execute todas as etapas agora."
}

/** Texto do PLANO no turno recém-encerrado: o último item de texto do
 *  assistente (sem cruzar pro turno anterior — para no último "user").
 *  Fallback: o texto do result (alguns CLIs só reportam o final ali).
 *  null = turno sem texto (nada pra aprovar). */
export function extractPlanText(items: ChatItem[]): string | null {
  let resultText: string | null = null
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "user") break
    if (it.kind === "text" && it.text.trim()) return it.text.trim()
    if (it.kind === "result" && resultText === null && it.text?.trim()) {
      resultText = it.text.trim()
    }
  }
  return resultText
}

/** O turno corrente terminou BEM (último item é um result ok)? Só então o card
 *  de aprovação aparece — erro/cancelamento não propõe plano pela metade. */
export function turnEndedOk(items: ChatItem[]): boolean {
  const last = items[items.length - 1]
  return last?.kind === "result" && last.ok
}
