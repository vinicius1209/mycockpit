// O recibo de fim de turno no fio: erro (quando houve), legenda e ações.
//
// ADR-199: sem borda (uma linha só não é superfície), legenda discreta e a
// régua de ações à vista só no turno mais recente. Saiu do MessageList, que
// está no teto da catraca de tamanho.

import { TurnActions, type FeedbackApi } from "@/components/chat/TurnActions"
import { TurnTelemetry } from "@/components/chat/TurnTelemetry"
import type { ChatItem } from "@/store/chat"

type ResultItem = Extract<ChatItem, { kind: "result" }>

/** `result` sem nada a contar: sem texto, sem custo e sem token. É o envelope
 *  de bastidor que alguns motores fecham no meio do pedido (ex.: a tarefa em
 *  segundo plano que parou, ADR-199). Puro. */
export function reciboSemConteudo(it: ResultItem): boolean {
  const u = it.usage
  const semTokens =
    !u || (u.input === 0 && u.output === 0 && u.cacheRead === 0 && !u.cacheCreation)
  return it.ok && !it.text?.trim() && !it.costUsd && semTokens
}

export function TurnReceipt({
  it,
  feedback,
  feedbackText,
  final,
  lastTurn,
}: {
  it: ResultItem
  feedback?: FeedbackApi | null
  feedbackText?: string
  /** É o resultado mais recente do SEU pedido? Parcial vazio não vira recibo. */
  final: boolean
  lastTurn: boolean
}) {
  if (!final && reciboSemConteudo(it)) return null
  return (
    <div className="flex flex-col gap-1.5">
      {!it.ok && it.text && (
        <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2">
          <div
            data-selectable
            className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
          >
            {it.text}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <TurnTelemetry it={it} />
        {feedback && (
          <TurnActions it={it} feedbackText={feedbackText} api={feedback} lastTurn={lastTurn} />
        )}
      </div>
    </div>
  )
}
