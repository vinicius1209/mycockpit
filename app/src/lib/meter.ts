// Paleta ÚNICA de medidor (STYLEGUIDE §2): anel de contexto, barras de uso,
// quota, qualquer coisa que preenche até um teto fala a mesma língua.
//
//   cinza < 60%  ·  âmbar 60 a 80%  ·  vermelho ≥ 80%
//
// Medidor saudável NUNCA é brass (brass é gesto/foco/ativo) nem verde (verde é
// marco raro). E a partir do vermelho o medidor deixa de ser mudo: o número
// entra como texto ao lado, porque um arco de 16px passa batido.
//
// Decisão pura, sem React: quem desenha importa o tom, não recalcula limiar.

export type MeterTone = "ok" | "warn" | "danger"

/** Aquecendo: ainda dá pra seguir, mas já pede o canto do olho. */
export const METER_WARN_PCT = 60
/** Perto do teto: o medidor grita (cor + número). */
export const METER_DANGER_PCT = 80

/** Tom do medidor pra um percentual em 0 a 100. */
export function meterTone(pct: number): MeterTone {
  if (pct >= METER_DANGER_PCT) return "danger"
  if (pct >= METER_WARN_PCT) return "warn"
  return "ok"
}

/** O medidor ainda é mudo (só o arco/barra) ou já entra com número? */
export function meterIsLoud(pct: number): boolean {
  return meterTone(pct) === "danger"
}

/** Classe de TEXTO por tom (saudável é cinza, não brass). */
export const METER_TEXT: Record<MeterTone, string> = {
  ok: "text-muted-foreground",
  warn: "text-st-warning",
  danger: "text-st-error",
}

/** Classe de PREENCHIMENTO (barra/arco) por tom. */
export const METER_FILL: Record<MeterTone, string> = {
  // Sólido (ADR-245): a 45% a barra sumia no trilho e o medidor parecia
  // desligado. Continua cinza, que é o que "saudável" é aqui.
  ok: "bg-muted-foreground",
  warn: "bg-st-warning",
  danger: "bg-st-error",
}

// ---------------------------------------------------------------------------
// Valor ABSOLUTO (US$ gasto na sessão, MB baixados, o que não tem teto).
//
// Percentual tem teto natural: 100% é 100% pra todo mundo. Dólar não. Pintar
// "US$ 5,00" de vermelho exigiria que NÓS escolhêssemos o valor em que gastar
// vira problema, e esse número é do usuário, não nosso: pra quem roda um
// refactor de 12h, US$ 5 é troco; pra quem testa um prompt, é caro. Número que
// fica vermelho a partir de um limiar que inventamos é opinião disfarçada de
// medição, e o §1 do STYLEGUIDE proíbe (a UI mostra estado real, não opina).
//
// Então: cinza sempre, até o usuário dar um teto. Com teto definido por ELE, o
// absoluto vira percentual DAQUELE teto e cai na régua única acima. Uma régua
// só, nenhum limiar inventado.
// ---------------------------------------------------------------------------

/**
 * Tom de um valor absoluto contra um teto que o USUÁRIO definiu.
 * Sem teto (null/0/negativo/não-finito) → sempre "ok" (cinza): a medição
 * segue honesta, só não opina.
 */
export function absoluteTone(value: number, limit: number | null | undefined): MeterTone {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return "ok"
  if (!Number.isFinite(value) || value <= 0) return "ok"
  return meterTone((value / limit) * 100)
}
