// Qual fala do turno é a RESPOSTA e quais são narração do caminho (G8). O fio
// dá peso à resposta e baixa o tom da narração, para a conclusão de um turno
// longo se achar sem ler tudo.
//
// Duas fontes, nesta ordem:
// 1. o motor disse (`fase` no item, hoje o Codex no app-server);
// 2. ninguém disse: a resposta é a última fala depois da última ação.
// Só vale para turno que TERMINOU bem. Rodando, nada é final ainda; turno que
// falhou ou foi cortado tem marco próprio (ADR-180) e a última fala dele não é
// resposta.

import type { ChatItem } from "@/store/chat"
import type { FaseDaFala } from "@/store/chat/itens"

export type VozDaFala = FaseDaFala

/** Vozes das falas de UM turno terminado bem. Puro. */
export function vozesDoTurno(turno: readonly ChatItem[]): Map<string, VozDaFala> {
  const falas = turno.filter((it): it is Extract<ChatItem, { kind: "text" }> => it.kind === "text" && !!it.text.trim())
  const out = new Map<string, VozDaFala>()
  if (falas.length === 0) return out

  if (falas.some((f) => f.fase)) {
    // O motor disse. Fala sem fase num turno que tem fases fica no tom normal.
    if (!falas.some((f) => f.fase === "resposta")) return out
    for (const f of falas) if (f.fase) out.set(f.id, f.fase)
    return out
  }

  let ultimaAcao = -1
  turno.forEach((it, i) => {
    if (it.kind === "tool") ultimaAcao = i
  })
  const depois = turno.slice(ultimaAcao + 1).filter((it) => it.kind === "text" && it.text.trim())
  const resposta = depois[depois.length - 1]
  if (!resposta) return out
  for (const f of falas) out.set(f.id, f.id === resposta.id ? "resposta" : "narracao")
  return out
}

/** id da fala → voz, para cada turno fechado por um `result` ok a partir de
 *  `from`. Turno fechado não muda mais: o mapa do turno é reaproveitado do
 *  `anterior` pela chave do `result`. Puro. */
export function vozesPorTurno(
  items: readonly ChatItem[],
  from: number,
  anterior: ReadonlyMap<string, Map<string, VozDaFala>> = new Map(),
): Map<string, Map<string, VozDaFala>> {
  const out = new Map<string, Map<string, VozDaFala>>()
  let inicio = from
  for (let i = from; i < items.length; i++) {
    const it = items[i]
    if (it.kind === "user") inicio = i + 1
    if (it.kind !== "result") continue
    const reaproveitado = anterior.get(it.id)
    out.set(it.id, reaproveitado ?? (it.ok ? vozesDoTurno(items.slice(inicio, i)) : new Map()))
    inicio = i + 1
  }
  return out
}

/** Os mapas por turno num mapa só, id da fala → voz. Puro. */
export function vozesPlanas(porTurno: ReadonlyMap<string, Map<string, VozDaFala>>): Map<string, VozDaFala> {
  const out = new Map<string, VozDaFala>()
  for (const m of porTurno.values()) for (const [id, voz] of m) out.set(id, voz)
  return out
}

/** A voz de um nó do fio que costura várias falas (e as ações delas, que não
 *  têm voz): se alguma fala é a resposta, o nó é resposta (nunca baixa o tom
 *  da conclusão); narração só se as falas com voz são todas narração. */
export function vozDoNo(ids: readonly string[], vozes: ReadonlyMap<string, VozDaFala>): VozDaFala | null {
  let achou: VozDaFala | null = null
  for (const id of ids) {
    const voz = vozes.get(id)
    if (voz === "resposta") return "resposta"
    if (voz) achou = voz
  }
  return achou
}
