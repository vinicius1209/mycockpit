// A divisão do cache de um turno: quanto foi LIDO e quanto foi RECONSTRUÍDO.
//
// ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
// São dois fatos com preços muito diferentes. Na Anthropic, ler do cache custa
// ~0,1x o preço do input e RECONSTRUIR custa ~1,25x — doze vezes mais por
// token. O ledger guardava os dois SOMADOS numa coluna `cache_tokens`, então o
// recibo sabia o total e não sabia explicá-lo.
//
// A medida que justificou a mudança, feita nos transcripts reais desta máquina:
//
//   cache lido        5.542.749.751 tokens   (96,5% dos tokens de cache)
//   cache reconstruído  201.004.177 tokens   ( 3,5% dos tokens)
//
// Pesando pelo preço relativo, a reconstrução é ~31% do custo de cache. Ou
// seja: a fatia que a coluna somada escondia é justamente a cara.
//
// ── O QUE NÃO FIZEMOS, E POR QUÊ ────────────────────────────────────────────
// O concorrente mostra um CRONÔMETRO até o cache expirar. Não copiamos: o TTL
// é configuração do provedor (5 min no padrão da Anthropic, 1h no modo
// estendido), não algo que a gente observe. Um relógio contando um prazo que
// nós chutamos pareceria dado e seria invenção — foi exatamente o erro do
// `3_000` herdado no orçamento da memória.
//
// O que dá pra afirmar sem chutar é o que ACONTECEU: houve reconstrução neste
// turno, e ela custou. Isso o dado responde.

/** O `usage` de um item `result`. `cacheCreation` é opcional porque item
 *  gravado num transcript ANTIGO pode não ter o campo — e aí não sabemos se
 *  houve reconstrução, o que é diferente de saber que não houve. */
export interface UsageDoTurno {
  cacheRead?: number | null
  cacheCreation?: number | null
}

/** Quanto foi lido e quanto foi reconstruído. Campo ausente vira 0, e 0 aqui
 *  significa "não mostro nada" — nunca "afirmo que foi zero". */
export function divisaoDoCacheDoTurno(u?: UsageDoTurno): {
  lido: number
  reconstruido: number
} {
  return {
    lido: Math.max(0, u?.cacheRead ?? 0),
    reconstruido: Math.max(0, u?.cacheCreation ?? 0),
  }
}
