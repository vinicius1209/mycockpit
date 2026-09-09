// A linha de TOKENS do recibo do turno: entrada/saída e — o que faltava —
// cache RECONSTRUÍDO.
//
// O cache LIDO não é mais texto: ele vive no tooltip junto com a quebra de
// entrada/saída. É número que confirma o que já se sabe (o cache funcionou), e
// linha que aparece sempre ninguém lê. O reconstruído continua visível porque
// ele é o contrário: só aparece quando custou caro.
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
  // A guarda pergunta pelo que de fato SE VÊ. O cache lido saiu do texto e virou
  // tooltip, então ele deixou de sustentar o componente sozinho: mantê-lo aqui
  // devolvia um <span> vazio (nada de I/O, nada de reconstrução, nada visível)
  // pendurado num tooltip que ninguém acha sem alvo pra pairar.
  if (!temIO && !d.reconstruido) return null
  return (
    <span
      className="flex items-center gap-1.5"
      title={
        usage && d.lido > 0
          ? `Cache lido: ${fmtTokens(d.lido)} · Entrada: ${fmtTokens(usage.input)} · Saída: ${fmtTokens(usage.output)}`
          : undefined
      }
    >
      {temIO && (
        <span className="tabular-nums">
          {fmtTokens(usage!.input)} ↓ · {fmtTokens(usage!.output)} ↑
        </span>
      )}
      {/* Só aparece quando houve: linha que aparece sempre ninguém lê. */}
      {d.reconstruido > 0 && (
        <>
          {temIO && <Sep />}
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
