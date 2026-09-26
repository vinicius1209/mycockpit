// S3.1 (docs/sidebar-plan.md) — a versão do rodapé NUNCA trunca. Os builds de
// teste carimbam "0.1.0-test.177", que estourava a largura do rodapé e o
// truncate comia exatamente o número que identifica o build. Formato curto
// ("v0.1.0-t177") na linha; a string completa vai no tooltip.

/** "0.1.0-test.177" → "v0.1.0-t177"; release limpo ("0.1.0") → "v0.1.0". */
export function shortVersion(version: string): string {
  return `v${version.replace(/-test\.?(\d+)/, "-t$1")}`
}

/** O build em execução, como o Rust o conhece (`versao.rs`, ADR-264). */
export interface InfoDoBuild {
  canal: "oficial" | "teste" | "dev" | "local"
  numero: number | null
  commit: string | null
  mudancasLocais: boolean
  /** Carimbo local do `build.sh` ("2026-09-26T14:32:10"). */
  feitoEm: string | null
  pasta: string | null
}

/** O que se cola num relato: "Frota 0.1.0-test.442 (b982da6)". Puro. */
export function versaoParaRelato(version: string | null, info: InfoDoBuild | null): string {
  const commit = info?.commit ? ` (${info.commit}${info.mudancasLocais ? ", com mudanças locais" : ""})` : ""
  return `Frota ${version ?? "sem versão"}${commit}`
}

/** Quando o build foi feito, para a dica: "hoje, 14:32" ou "25/09, 09:10".
 *  O carimbo é hora local sem fuso (`date +%Y-%m-%dT%H:%M:%S`). Puro. */
export function quandoFoiFeito(feitoEm: string | null, now: number): string | null {
  const m = feitoEm?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const [, a, mes, d, h, min] = m
  const feito = new Date(Number(a), Number(mes) - 1, Number(d))
  const hoje = new Date(now)
  const mesmoDia = feito.toDateString() === hoje.toDateString()
  return `${mesmoDia ? "hoje" : `${d}/${mes}`}, ${h}:${min}`
}
