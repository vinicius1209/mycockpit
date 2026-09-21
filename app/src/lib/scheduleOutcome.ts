// Desfecho de UMA execução agendada: como ele é lido do turno, como ele é
// gravado e o que ele diz no sino. Extraído do scheduleEngine porque os DOIS
// fluxos (prompt e Plano de voo) precisam do mesmo contrato — e porque a
// versão anterior repetia insert+mark+push em cada braço de falha, com o
// motivo real escrito de um jeito diferente em cada um (ou omitido).

import {
  insertScheduleRun,
  markScheduleRun,
  type ScheduleRecord,
} from "@/lib/db"
import type { ChatItem } from "@/store/chat"
import type { Notification } from "@/store/notifications"

/** Desfecho normalizado de um disparo:
 *  - "ok"      → o turno (ou a missão) terminou bem;
 *  - "failed"  → falhou, e `error` diz POR QUÊ (uma linha, colhida do turno);
 *  - "blocked" → preflight de capability barrou antes de gastar. */
export interface ScheduleOutcome {
  status: "ok" | "failed" | "blocked"
  cost: number | null
  convId: string | null
  /** Motivo REAL, nunca inventado. null = deu certo ou o desfecho veio mudo. */
  error: string | null
}

/** Uma linha só: o sino e a lista não são lugar de despejar transcript. Corta
 *  em `limit` caracteres pra não estourar o cartão, e nunca no meio de nada
 *  que o usuário precise (a conversa completa está a um clique). */
export function oneLine(text: string, limit = 180): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

/** Desfecho do turno lido dos items reduzidos pelo caminho normal do chat:
 *  ok = o último item "terminal" é um result com ok=true; o custo vem do
 *  último result (que carrega o total do turno — results consecutivos já
 *  foram colapsados pelo reduceItems); `error` é a mensagem REAL do item
 *  terminal (erro, limite, cancelamento ou o texto de um result que falhou). */
export function turnOutcome(items: ChatItem[]): {
  ok: boolean
  cost: number | null
  error: string | null
} {
  let cost: number | null = null
  let ok = false
  let error: string | null = null
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "result") {
      cost = it.costUsd ?? null
      ok = it.ok
      if (!it.ok) error = it.text ? oneLine(it.text) : "O turno terminou em erro."
      break
    }
    if (it.kind === "error" || it.kind === "cancelled" || it.kind === "limit") {
      ok = false
      error =
        it.kind === "cancelled"
          ? "Execução cancelada."
          : oneLine(it.message)
      // segue procurando um result anterior só pra recuperar o custo gasto.
      for (let j = i - 1; j >= 0; j--) {
        const prev = items[j]
        if (prev.kind === "result") {
          cost = prev.costUsd ?? null
          break
        }
      }
      break
    }
  }
  return { ok, cost, error }
}

/** Item de ferramenta, para a régua de "isto produziu trabalho?". */
type ToolItem = Extract<ChatItem, { kind: "tool" }>

/**
 * O AMBIENTE barrou este turno, apesar de ele ter terminado bem?
 *
 * `null` = não há sinal disto. String = o motivo, pronto pro histórico.
 *
 * # O `ok` que mentiu três vezes (04, 06 e 09/09/2026)
 *
 * A automação "Pendencias na Prime" rodou com o sandbox duplo: todo comando de
 * shell morria com `sandbox_apply: Operation not permitted` e a tool do frota-work
 * voltava "requires approval, but approval policy is never". O Codex não
 * FALHOU: ele NARROU a impossibilidade e saiu com `is_error: false`. O
 * `turnOutcome` só olha o item terminal, então leu `ok`, o sino ficou mudo e o
 * histórico gravou sucesso. US$ 1,16 em três execuções que não produziram nada.
 *
 * # Por que a régua é esta, e não "alguma ferramenta falhou"
 *
 * "Alguma falhou" condenaria turno legítimo (um `grep` sem resultado é rotina).
 * E "alguma passou" NÃO salva: no incidente duas passaram —
 * `list_mcp_resource_templates` e `list_mcp_resources`, as duas com `text: ""`
 * e `lines: 0`, o agente tateando por uma saída que não existia.
 *
 * O sinal honesto é a CONJUNÇÃO: nenhuma ferramenta produziu saída E pelo menos
 * uma falhou. Aí não é uma tarefa que deu em nada, é um ambiente que não deixou
 * trabalhar. Turno sem ferramenta nenhuma não entra (responder de cabeça é
 * desfecho legítimo), e corte seu (`interrupted`) não conta como falha (ADR-180).
 */
export function barradoPeloAmbiente(items: ChatItem[]): string | null {
  const tools = items.filter((i): i is ToolItem => i.kind === "tool")
  const falhas = tools.filter((t) => t.result?.ok === false && !t.result.interrupted)
  if (falhas.length === 0) return null
  const produziu = tools.some(
    (t) =>
      t.result?.ok === true &&
      (t.result.lines > 0 || t.result.text.trim().length > 0),
  )
  if (produziu) return null
  // O motivo REAL, colhido da primeira falha que trouxe texto. Sem texto em
  // nenhuma, a frase nomeia o que aconteceu em vez de inventar uma causa.
  const comTexto = falhas.find((t) => t.result!.text.trim().length > 0)
  const detalhe = comTexto
    ? `${comTexto.name}: ${oneLine(comTexto.result!.text, 120)}`
    : falhas.map((t) => t.name).join(", ")
  return `Terminou sem produzir trabalho: ${falhas.length} de ${tools.length} ferramentas falharam e nenhuma devolveu saída (${detalhe}).`
}

/** Grava o desfecho: uma linha no histórico (`schedule_runs`, com o motivo) e
 *  o carimbo do último desfecho no próprio schedule. Best-effort de ponta a
 *  ponta — o motor não pode cair aqui. */
export async function recordScheduleOutcome(
  s: ScheduleRecord,
  startedAt: number,
  outcome: ScheduleOutcome,
): Promise<void> {
  await insertScheduleRun({
    id: crypto.randomUUID(),
    scheduleId: s.id,
    startedAt,
    status: outcome.status,
    cost: outcome.cost,
    convId: outcome.convId,
    error: outcome.error,
  })
  await markScheduleRun(s.id, startedAt, outcome.status)
}

/** A notificação do sino quando o disparo NÃO deu certo — null quando deu.
 *  O subtítulo é o MOTIVO, não um conselho genérico: era ele que faltava (a
 *  versão anterior dizia 'Sem retry automático na v1' e o usuário tinha que
 *  abrir a conversa pra descobrir que o sandbox negou a leitura). */
export function failureNotice(
  s: ScheduleRecord,
  outcome: ScheduleOutcome,
): Omit<Notification, "id" | "ts" | "read"> | null {
  if (outcome.status === "ok") return null
  const blocked = outcome.status === "blocked"
  return {
    kind: "run_error",
    title: `${blocked ? "Automação aguardando configuração" : "Automação falhou"}: ${s.name}`,
    subtitle:
      outcome.error ??
      'Sem retry automático na v1; use "Rodar agora" em Agendado.',
    projectId: s.projectId,
    ...(outcome.convId ? { convId: outcome.convId } : {}),
  }
}
