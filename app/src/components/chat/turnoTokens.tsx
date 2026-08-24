// A linha de TOKENS do recibo do turno: entrada/saída, cache lido e — o que
// faltava — cache RECONSTRUÍDO.
//
// Saiu do `MessageList` porque a catraca de tamanho não deixa arquivo já
// congelado crescer, e a regra da casa é DIVIDIR. Foi o corte certo: o resto do
// `TurnTelemetry` é desfecho e duração; isto aqui é a contabilidade do turno.
//
// O PORQUÊ da reconstrução aparecer está em `lib/cacheDoTurno`.

import { fmtTokens } from "@/lib/format"
import { divisaoDoCacheDoTurno } from "@/lib/cacheDoTurno"

function Sep() {
  return <span className="text-muted-foreground/30">·</span>
}

export function TurnoTokens({
  usage,
}: {
  usage?: { input: number; output: number; cacheRead: number; cacheCreation?: number }
}) {
  const d = divisaoDoCacheDoTurno(usage)
  const temIO = !!usage && (usage.input > 0 || usage.output > 0)
  if (!temIO && !d.lido && !d.reconstruido) return null
  return (
    <span className="flex items-center gap-1.5">
      {temIO && (
        <span className="tabular-nums">
          {fmtTokens(usage!.input)} ↓ · {fmtTokens(usage!.output)} ↑
        </span>
      )}
      {d.lido > 0 && (
        <>
          {temIO && <Sep />}
          <span className="tabular-nums">cache {fmtTokens(d.lido)}</span>
        </>
      )}
      {/* Só aparece quando houve: linha que aparece sempre ninguém lê. */}
      {d.reconstruido > 0 && (
        <>
          {(temIO || d.lido > 0) && <Sep />}
          <span
            className="tabular-nums text-st-warning"
            title="O cache foi reconstruído neste turno, e reconstruir custa mais por token do que ler."
          >
            +{fmtTokens(d.reconstruido)} reconstruído
          </span>
        </>
      )}
    </span>
  )
}
