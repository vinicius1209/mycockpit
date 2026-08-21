// O ÚLTIMO TURNO DE CONVERSA, para os canais que são snapshot (tray, Companion).
//
// O recibo (ADR-055) já é estado durável: ele vive como `body` do item
// `run_done`/`run_error` no feed do sino, que é persistido. Então tray e
// Companion não precisam de evento novo, canal novo nem tabela nova — precisam
// LER. É este arquivo.
//
// Puro de propósito: quem escolhe "qual foi o último turno" é regra, e regra
// dá pra testar sem montar tray nem servir Companion.

/** O que um canal de snapshot precisa saber sobre o turno que acabou. */
export interface UltimoTurno {
  /** Título da conversa (o "onde"). */
  title: string
  /** O que o turno FEZ. `null` quando não houve recibo — turno de primeiro
   *  plano, helper desligado, ou prazo estourado (ADR-055). Ausência aqui é
   *  normal, não falha: quem mostra cai no desfecho. */
  receipt: string | null
  ok: boolean
  at: number
}

/** Só o que o feed guarda e nos interessa (evita importar o store aqui). */
export interface ItemDeFeed {
  kind: string
  title: string
  body?: string
  convId?: string
  ts: number
}

/**
 * O turno de CONVERSA mais recente do feed, ou `null`.
 *
 * `convId` é a peneira que separa turno de tudo o mais: o feed também carrega
 * desfecho de MISSÃO e notícia de ferramenta, e um "último turno" que mostrasse
 * missão concluída estaria dizendo outra coisa com a mesma frase.
 *
 * Não filtra por idade. Um turno de ontem continua sendo o último turno — e a
 * tray mostra o instante junto, então quem lê decide se ainda importa. Inventar
 * um corte ("só das últimas 2h") esconderia o único dado que havia.
 */
export function ultimoTurno(feed: readonly ItemDeFeed[]): UltimoTurno | null {
  let melhor: ItemDeFeed | null = null
  for (const it of feed) {
    if (it.kind !== "run_done" && it.kind !== "run_error") continue
    if (!it.convId) continue // missão/ferramenta não são turno de conversa
    if (!melhor || it.ts > melhor.ts) melhor = it
  }
  if (!melhor) return null
  return {
    title: melhor.title,
    receipt: melhor.body?.trim() || null,
    ok: melhor.kind === "run_done",
    at: melhor.ts,
  }
}
