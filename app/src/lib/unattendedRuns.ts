// Runs DESASSISTIDOS: registro de quem rodou SEM ninguém na frente da tela +
// a regra PURA de "este pedido esperou demais".
//
// O buraco que isto fecha (congelamento eterno): automação agendada
// (lib/scheduleEngine) roda em 'leitura' ou 'padrao', e nos DOIS o turno pode
// PARAR pedindo algo ao humano — 'padrao' liga o `--permission-prompt-tool`
// (aprovação granular) e a tool de conteúdo `ask_user` sobe em todo modo com
// MCP (src-tauri/src/adapters.rs). Quando isso acontece o backend BLOQUEIA
// esperando a resposta, "turno vivo, sem timeout" (src-tauri/src/approval.rs):
// às 18:30, com você fora, ninguém clica. O turno não falha e não avisa, fica
// pendurado pra sempre — e a automação some sem desfecho.
//
// A régua é de QUEM DISPARA, não de quem recebe: só o disparador sabe se tem
// gente olhando. O scheduleEngine gera o runId ANTES de chamar runAgent, então
// ele marca o run aqui e desmarca no `finally`; o vigia (lib/watchdog) só cobra
// prazo de pedido cujo run está marcado. Turno que VOCÊ digitou nunca expira —
// esperar você o tempo que precisar é o comportamento certo ali.

import type { InteractionKind } from "@/lib/interaction"

/** runId → conversa do run desassistido (a conversa é onde o aviso aparece).
 *  Memória de módulo, igual às marcas do watchdog: some no fim do run. */
const unattended = new Map<string, string>()

/** Marca um run como DESASSISTIDO (chamado pelo disparador, antes do runAgent). */
export function markUnattendedRun(runId: string, convId: string): void {
  if (!runId) return
  unattended.set(runId, convId)
}

/** Desmarca (chamado no `finally` do disparador). É o "cancelamento do timer":
 *  sem marca, nenhum pedido daquele run pode mais expirar — run que terminou
 *  antes do prazo não deixa nada pendurado, nem memória nem efeito. */
export function clearUnattendedRun(runId: string): void {
  unattended.delete(runId)
}

export function isUnattendedRun(runId: string): boolean {
  return unattended.has(runId)
}

/** Conversa registrada do run (fallback do aviso quando o dono já não é
 *  resolvível pelos stores — ex.: o run acabou entre a decisão e o aviso). */
export function unattendedConvOf(runId: string | null): string | null {
  return runId ? (unattended.get(runId) ?? null) : null
}

/** Snapshot dos runs marcados (entrada da regra pura). */
export function unattendedRunIds(): ReadonlySet<string> {
  return new Set(unattended.keys())
}

/** (testes) zera o registro. */
export function _resetUnattendedRuns(): void {
  unattended.clear()
}

/** Marca de UM pedido pendente vista pelo vigia (a memória do cronômetro). */
export interface PendingMark {
  /** id do pedido (mesmo id do InteractionRequest). */
  id: string
  kind: InteractionKind
  /** Run dono. null = pedido órfão (sem run resolvível) ⇒ NUNCA expira: sem
   *  run não dá pra afirmar que ninguém está olhando. */
  runId: string | null
  /** Quando o vigia viu este pedido pela 1ª vez — âncora do prazo. */
  since: number
}

/** Quais pedidos pendentes estouraram o prazo. PURA (o timer é efeito à parte,
 *  no ticker do watchdog): dado marcas + runs marcados + limiar + `now`,
 *  devolve sempre a mesma lista.
 *
 *  Regras, nesta ordem:
 *  - `afterMin <= 0` = knob desligado ⇒ nada expira (o turno espera pra sempre,
 *    que é o comportamento de hoje);
 *  - pedido de run NÃO marcado (você digitando) nunca expira, por mais tempo
 *    que passe;
 *  - prazo por PEDIDO, não por run: cada decisão pendente ganha a sua janela
 *    completa (o modelo pode pedir de novo depois de um deny). */
export function expiredUnattended(
  marks: readonly PendingMark[],
  unattendedRuns: ReadonlySet<string>,
  afterMin: number,
  now: number,
): PendingMark[] {
  if (afterMin <= 0) return []
  const limitMs = afterMin * 60_000
  return marks.filter(
    (m) =>
      m.runId != null &&
      unattendedRuns.has(m.runId) &&
      now - m.since >= limitMs,
  )
}
