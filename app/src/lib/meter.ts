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
  ok: "bg-muted-foreground/45",
  warn: "bg-st-warning",
  danger: "bg-st-error",
}
