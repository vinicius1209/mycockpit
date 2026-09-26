// O aviso do sistema no fio (`kind: "notice"`). Desde a ADR-249 a PRIMEIRA
// linha é o resumo que aparece e o resto é o detalhe, que vai para o hover: o
// aviso de memória era um parágrafo de três linhas no meio da conversa. Aviso
// de uma linha só segue igual. Número e unidade chegam ligados por espaço
// inquebrável do Rust ("2,3 GB" nunca se parte).

// A decisão (`tom: "decisao"`, ADR-261) é o registro de um gesto seu sobre um
// pedido do agente: o cartão do pedido assenta nesta linha, com o ✓ e a hora,
// e ela fica como histórico.

import { AlertCircle, Check } from "lucide-react"

const hora = (ts: number) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

export function AvisoDoFio({ message, tom, ts }: { message: string; tom?: "decisao"; ts?: number }) {
  const quebra = message.indexOf("\n")
  const resumo = quebra < 0 ? message : message.slice(0, quebra)
  const detalhe = quebra < 0 ? "" : message.slice(quebra + 1).trim()
  return (
    <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground/80">
      {tom === "decisao" ? <Check className="size-3 shrink-0" /> : <AlertCircle className="size-3 shrink-0" />}
      <span>
        {resumo}
        {tom === "decisao" && ts != null && <span className="text-faint"> · {hora(ts)}</span>}
        {detalhe && (
          <span
            title={detalhe}
            className="ml-1.5 cursor-help text-faint underline decoration-dotted underline-offset-3"
          >
            (detalhe)
          </span>
        )}
      </span>
    </div>
  )
}
