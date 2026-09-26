// O GASTO na faixa de baixo (ADR-262): o de hoje somando todos os motores, e
// no painel o de hoje e dos últimos 7 dias por motor. Antes a faixa só dizia o
// custo da conversa aberta ("sessão"), e a pergunta "quanto já gastei hoje?"
// só tinha resposta no Painel.
//
// A fonte é o livro de custos que o app grava por turno (`turn_costs`, lido
// por `loadLedger`), o mesmo do Painel de custos: um número, um dono.

import { costByAgent, windowRows, type LedgerRow } from "@/lib/panel"

export interface GastoDoMotor {
  agent: string
  hoje: number
  semana: number
  /** Turnos da semana com consumo e sem preço (ADR-047): fora da soma. */
  semPreco: number
}

export interface GastoDaFaixa {
  hoje: number
  semana: number
  semPreco: number
  porMotor: GastoDoMotor[]
}

/** Hoje (desde a meia-noite local) e 7 dias, por motor, do maior para o
 *  menor na semana. Puro. */
export function gastoDaFaixa(rows: LedgerRow[], now = Date.now()): GastoDaFaixa {
  const semana = costByAgent(windowRows(rows, "7d", now))
  const hoje = new Map(costByAgent(windowRows(rows, "today", now)).map((a) => [a.agent, a.costUsd]))
  const porMotor = semana.map((a) => ({
    agent: a.agent,
    hoje: hoje.get(a.agent) ?? 0,
    semana: a.costUsd,
    semPreco: a.unpricedTurns,
  }))
  return {
    hoje: porMotor.reduce((s, m) => s + m.hoje, 0),
    semana: porMotor.reduce((s, m) => s + m.semana, 0),
    semPreco: porMotor.reduce((s, m) => s + m.semPreco, 0),
    porMotor,
  }
}
