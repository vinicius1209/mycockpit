// IGNORÂNCIA DECLARADA (R5 do docs/mocks/missao-README.md): quando o motor da
// fase não narra ação por ação, a tela DIZ isso com o que sabe, em vez de
// inventar verbo.
//
// O defeito: 5min 42s de agy com um `Agora: preparando…` no lugar do que a tela
// não sabia. "preparando…", "trabalhando…" e "redigindo resposta…" anunciavam
// ignorância como se fosse fato. As três somem; fica "nenhuma ação reportada
// nesta fase", que é verificável, e o slot continua reservado pra quando (e se)
// um evento chegar.
//
// Quem decide é a CAPABILITY, nunca o nome do motor: `structuredOutput` (o
// espelho de `structured_output`, adapters.rs) diz que aquele stdout é texto
// puro, não fluxo de eventos. Nenhum `agent === "agy"` em lugar nenhum. O proxy
// é fiel enquanto "emite JSON estruturado" e "emite evento por ação" andarem
// juntas; se um motor quebrar o proxy, aí nasce `tool_events` nos dois lados.
//
// DUAS IDADES, não uma: "rodando há 5min 42s" (a fase) e "última saída há 38s"
// (o motor). O que decide alarme é a SEGUNDA. Acima de 10 min sem byte a linha
// vira âmbar e o gesto de interromper sobe pra botão; antes disso é cinza,
// porque calado não é quebrado.
//
// Puro: `now` é sempre injetado.

import { agentDef } from "@/lib/agents"
import type { MissionPhaseRun } from "@/lib/missionTypes"
import type { ChatItem } from "@/store/chat"

/** Limiar do alarme de silêncio, amarrado ao ÚLTIMO BYTE (não ao tempo da
 *  fase): uma fase de 40 min que fala a cada 30s está saudável; uma de 12 min
 *  calada há 11 não está. */
export const SILENCE_ALERT_MS = 10 * 60 * 1000

/** O motor desta fase narra ação por ação? Motor fora do registry: `false`, na
 *  dúvida, degradação honesta (prometer narração que não vem seria pior). */
export function narratesActions(agentId: string): boolean {
  return agentDef(agentId)?.structuredOutput ?? false
}

/** Declaração que a fase NA FILA carrega, pra a quietude não ser surpresa
 *  depois. null = o motor narra e mede, e não há nada a declarar. */
export function queuedGranularityNote(agentId: string): string | null {
  const def = agentDef(agentId)
  if (!def) return "motor fora do registry, o app não sabe o que ele reporta"
  if (!def.structuredOutput && !def.reportsCost) {
    return "não reporta ações nem custo"
  }
  if (!def.structuredOutput) return "não reporta ações"
  if (!def.reportsCost) return "não reporta custo (o valor sai estimado)"
  return null
}

export interface QuietPhaseView {
  /** Cabeçalho do bloco: o que o motor NÃO faz, dito uma vez. */
  headline: string
  /** As duas idades, na mesma linha, com o `tabular-nums` da casa. */
  ages: string
  /** O que se sabe do trabalho: ações reportadas (ou a ausência delas). */
  reported: string
  /** A última linha que o motor escreveu de verdade. Conteúdo real, não verbo
   *  inventado. null = ele ainda não escreveu nada. */
  lastLine: string | null
  /** Passou de 10 min sem byte: a linha vira âmbar e "Interromper esta fase"
   *  sobe pra botão. */
  stalled: boolean
  /** ms desde a última saída. null = nada chegou ainda nesta fase. */
  sinceLastOutputMs: number | null
}

/** Última linha de texto que o motor escreveu (a de baixo, truncada por quem
 *  renderiza). null = nenhum texto ainda. */
export function lastEngineLine(items: ChatItem[] | undefined): string | null {
  const list = items ?? []
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i]
    if (it.kind !== "text" && it.kind !== "result") continue
    const txt = it.text?.trim()
    if (!txt) continue
    const linhas = txt.split("\n").filter((l) => l.trim())
    if (linhas.length > 0) return linhas[linhas.length - 1].trim()
  }
  return null
}

/** Formata uma idade em minutos/segundos sem inventar precisão. */
function idade(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}min ${String(s % 60).padStart(2, "0")}s`
}

/**
 * O bloco do MOTOR CALADO. Só faz sentido quando `narratesActions` é false —
 * quem chama decide qual componente montar; aqui mora o texto.
 */
export function quietPhaseView(
  phase: MissionPhaseRun,
  now: number,
): QuietPhaseView {
  const nome = agentDef(phase.def.agent)?.shortLabel ?? phase.def.agent
  const runningMs = phase.startedAt != null ? Math.max(0, now - phase.startedAt) : 0
  const sinceLastOutputMs =
    phase.lastOutputAt != null ? Math.max(0, now - phase.lastOutputAt) : null
  const stalled =
    sinceLastOutputMs != null && sinceLastOutputMs >= SILENCE_ALERT_MS
  const tools = (phase.items ?? []).filter((i) => i.kind === "tool").length
  return {
    headline: stalled
      ? `sem sinal do ${nome} há ${idade(sinceLastOutputMs)}`
      : `o ${nome} não reporta ação por ação`,
    ages:
      sinceLastOutputMs == null
        ? `rodando há ${idade(runningMs)} · nenhuma saída ainda`
        : `rodando há ${idade(runningMs)} · última saída há ${idade(sinceLastOutputMs)}`,
    reported:
      tools > 0
        ? `${tools} ${tools === 1 ? "ação reportada" : "ações reportadas"} nesta fase`
        : "nenhuma ação reportada nesta fase",
    lastLine: lastEngineLine(phase.items),
    stalled,
    sinceLastOutputMs,
  }
}
