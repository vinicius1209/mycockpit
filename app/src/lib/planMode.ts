// "Planejar primeiro" (plan mode por turno): lógica PURA do lado front.
// O motor (Rust) segura os writes quando o run vai com plan_first=true; aqui
// mora só o que a UI decide — o prompt de execução pós-aprovação por agent e a
// captura do texto do plano no fio da conversa.

import { agentDef } from "@/lib/agents"
import type { ChatItem } from "@/store/chat"

/** Nome curto do toggle (visível na linha do painel). */
export const PLAN_FIRST_LABEL = "Planejar primeiro"

/** O que o toggle FAZ, por extenso (segunda linha da mesma). */
export const PLAN_FIRST_DESCRIPTION =
  "o agent propõe um plano e só executa depois da sua aprovação"

/** Composição das duas — fonte única de quem só precisa da frase inteira
 *  (ex.: `title` de um alvo que não tem as duas linhas). */
export const PLAN_FIRST_TOOLTIP = `${PLAN_FIRST_LABEL}: ${PLAN_FIRST_DESCRIPTION}`

/** true se o agent não tem resume (o plano vai embutido no prompt de execução,
 *  senão o agent não sabe o que aprovamos). H5: derivado da capability
 *  `sessionResume` do registry — nunca de `agent === "agy"`; motor
 *  desconhecido embute (fail-closed: não conta com resume que não provou). */
export function needsPlanEmbedded(agent: string): boolean {
  return !(agentDef(agent)?.sessionResume ?? false)
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
