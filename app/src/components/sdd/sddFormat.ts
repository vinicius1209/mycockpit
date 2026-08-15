// Formatadores puros do modo SDD, compartilhados entre o detalhe do plano
// (`SddView`) e o trilho de etapas (`StagePipeline`). Saíram do `SddView.tsx`
// quando o trilho virou arquivo próprio: eram os únicos ajudantes que os dois
// lados usavam, e deixá-los lá faria o componente extraído importar de volta
// do arquivo de onde saiu.

/** "5 gates passaram · 1 falhou · 2 não rodados" (omite zeros). */
export function gateSummary(gc: {
  pass: number
  fail: number
  notRun: number
}): string {
  const parts: string[] = []
  if (gc.pass)
    parts.push(`${gc.pass} ${gc.pass === 1 ? "gate passou" : "gates passaram"}`)
  if (gc.fail) parts.push(`${gc.fail} ${gc.fail === 1 ? "falhou" : "falharam"}`)
  if (gc.notRun)
    parts.push(`${gc.notRun} não ${gc.notRun === 1 ? "rodado" : "rodados"}`)
  return parts.join(" · ")
}

/** "PR #476" a partir da URL do GitHub (…/pull/476); fallback "Pull request". */
export function prLabel(url: string): string {
  const m = url.match(/\/pull\/(\d+)/)
  return m ? `PR #${m[1]}` : "Pull request"
}

/** ISO → "dd/mm/aaaa hh:mm" (local). Fallback p/ só a data, se inválido. */
export function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  } catch {
    return iso.slice(0, 10)
  }
}
