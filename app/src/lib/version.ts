// S3.1 (docs/sidebar-plan.md) — a versão do rodapé NUNCA trunca. Os builds de
// teste carimbam "0.1.0-test.177", que estourava a largura do rodapé e o
// truncate comia exatamente o número que identifica o build. Formato curto
// ("v0.1.0-t177") na linha; a string completa vai no tooltip.

/** "0.1.0-test.177" → "v0.1.0-t177"; release limpo ("0.1.0") → "v0.1.0". */
export function shortVersion(version: string): string {
  return `v${version.replace(/-test\.?(\d+)/, "-t$1")}`
}
