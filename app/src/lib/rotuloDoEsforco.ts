// O nome de cada degrau de esforço em pt-BR, no deslizador do seletor de motor
// (ADR-282). O valor que vai ao CLI não muda; muda só o que a pessoa lê. Degrau
// que um motor inventar amanhã aparece como o CLI escreveu.

const NOMES: Record<string, string> = {
  none: "nenhum",
  minimal: "mínimo",
  low: "baixo",
  medium: "médio",
  high: "alto",
  xhigh: "extra",
  max: "máximo",
  ultra: "ultra",
}

/** Rótulo curto de um degrau (sem "default", que é o "deixa o motor escolher"). Puro. */
export function rotuloDoEsforco(value: string, label: string): string {
  return NOMES[value] ?? label
}
