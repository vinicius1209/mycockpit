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
  projectId?: string
  ts: number
}

/** O mesmo turno, com o endereço que um canal REMOTO precisa (o celular não
 *  tem as stores pra resolver projeto a partir do id sozinho). */
export interface TurnoRecente extends UltimoTurno {
  convId: string
  projectId: string
}

/** Resolve o nome VIGENTE da conversa. O feed guarda o título observado no
 *  instante do evento, mas superfícies de estado (HUD e Companion) precisam
 *  acompanhar uma renomeação posterior sem reescrever o recibo histórico. */
export type ResolveConversationTitle = (
  convId: string,
  projectId: string | undefined,
) => string | null | undefined

function currentTitle(
  item: ItemDeFeed,
  resolveTitle?: ResolveConversationTitle,
): string {
  const resolved = item.convId
    ? resolveTitle?.(item.convId, item.projectId)?.trim()
    : null
  return resolved || item.title
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
/**
 * Os N turnos de conversa mais recentes, do mais novo pro mais velho.
 *
 * PLURAL de propósito, e a diferença com o `ultimoTurno` é de pergunta: na
 * bandeja você olha de relance e quer "e agora?"; no celular você chega DEPOIS
 * e quer "o que aconteceu enquanto eu não estava". Um item só responderia a
 * primeira pergunta nos dois lugares.
 *
 * `max` existe pra isto não virar log: o celular é resumo, não histórico — quem
 * quer o histórico abre o app.
 */
export function turnosRecentes(
  feed: readonly ItemDeFeed[],
  max = 5,
  resolveTitle?: ResolveConversationTitle,
): TurnoRecente[] {
  return feed
    .filter(
      (it) =>
        (it.kind === "run_done" || it.kind === "run_error") &&
        !!it.convId &&
        !!it.projectId,
    )
    .sort((a, b) => b.ts - a.ts)
    .slice(0, max)
    .map((it) => ({
      convId: it.convId!,
      projectId: it.projectId!,
      title: currentTitle(it, resolveTitle),
      receipt: it.body?.trim() || null,
      ok: it.kind === "run_done",
      at: it.ts,
    }))
}

export function ultimoTurno(
  feed: readonly ItemDeFeed[],
  resolveTitle?: ResolveConversationTitle,
): UltimoTurno | null {
  const melhor = ultimoEventoDeTurno(feed)
  if (!melhor) return null
  return {
    title: currentTitle(melhor, resolveTitle),
    receipt: melhor.body?.trim() || null,
    ok: melhor.kind === "run_done",
    at: melhor.ts,
  }
}

/** O evento que sustenta o cartão de último turno. Mantém a referência do
 *  store, para assinantes reagirem só quando o evento realmente muda. */
export function ultimoEventoDeTurno(
  feed: readonly ItemDeFeed[],
): ItemDeFeed | null {
  let melhor: ItemDeFeed | null = null
  for (const it of feed) {
    if (it.kind !== "run_done" && it.kind !== "run_error") continue
    if (!it.convId) continue // missão/ferramenta não são turno de conversa
    if (!melhor || it.ts > melhor.ts) melhor = it
  }
  return melhor
}
