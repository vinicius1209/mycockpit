// Os PLANOS na faixa de baixo (ADR-262, mock `docs/mocks/barra-de-baixo.html`,
// variante A): todo motor com janela de plano, cada um com o SEU logo, a SUA
// pior janela e o nome dela ("5h", "7d").
//
// Por que isto não repete o bug do build 201. Lá a faixa mostrava "Claude 59%"
// numa conversa do Antigravity: o número de um motor OCUPAVA o lugar do outro,
// e a faixa era lida como estado da conversa. Aqui ninguém ocupa o lugar de
// ninguém. Cada motor aparece com a própria marca, o da conversa aberta vem
// primeiro, e motor sem leitura simplesmente não aparece. A pergunta mudou de
// "como está esta conversa" para "quanto ainda posso usar, em cada plano"
// (26/09/2026: "uma forma de ver de todos os providers").

import { agentDef } from "@/lib/agents"
import {
  snapshotUsable,
  type UsageFailure,
  type UsageSnapshot,
  type UsageWindowInfo,
} from "@/lib/usageWindow"

export interface PlanoNaFaixa {
  agent: string
  janela: UsageWindowInfo
}

/** A pior janela de cada motor com leitura fresca, o motor da conversa aberta
 *  primeiro e os outros na ordem do registro. Motor sem capability de janela
 *  não entra (camada 1 de esconder). Puro. */
export function planosDaFaixa(
  ativo: string | null,
  snapshots: Record<string, UsageSnapshot>,
  failures: Record<string, UsageFailure>,
  now: number,
): PlanoNaFaixa[] {
  const out: PlanoNaFaixa[] = []
  for (const snap of Object.values(snapshots)) {
    if (agentDef(snap.agent)?.usageWindow == null) continue
    if (!snapshotUsable(snap, failures[snap.agent], now)) continue
    let pior: UsageWindowInfo | null = null
    for (const w of snap.windows) if (!pior || w.usedPercent > pior.usedPercent) pior = w
    if (pior) out.push({ agent: snap.agent, janela: pior })
  }
  return out.sort((a, b) => Number(b.agent === ativo) - Number(a.agent === ativo))
}

/** O nome curto da janela na faixa: "5h", "7d", ou o id até o escopo
 *  ("7d:fable" vira "7d"). Janela desconhecida degrada para o próprio id. */
export function rotuloCurtoDaJanela(w: UsageWindowInfo): string {
  if (w.windowMinutes === 300) return "5h"
  if (w.windowMinutes === 10_080) return "7d"
  if (w.windowMinutes != null && w.windowMinutes % 1440 === 0) return `${w.windowMinutes / 1440}d`
  if (w.windowMinutes != null && w.windowMinutes % 60 === 0) return `${w.windowMinutes / 60}h`
  return w.id.split(":")[0]
}

const PLANOS: Record<string, string> = {
  max_5x: "Max 5x",
  max_20x: "Max 20x",
  max: "Max",
  pro: "Pro",
  plus: "Plus",
  team: "Team",
  enterprise: "Enterprise",
  free: "Free",
}

/** O plano como a pessoa o conhece ("Max 5x", "Plus"). O Rust manda o nome
 *  canônico; nome novo passa com a primeira letra em maiúscula. */
export function rotuloDoPlano(plano: string | null | undefined): string | null {
  const p = plano?.trim().toLowerCase()
  if (!p) return null
  return PLANOS[p] ?? p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, " ")
}
