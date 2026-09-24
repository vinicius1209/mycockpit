// O aviso do sistema no fio (`kind: "notice"`). Desde a ADR-249 a PRIMEIRA
// linha é o resumo que aparece e o resto é o detalhe, que vai para o hover: o
// aviso de memória era um parágrafo de três linhas no meio da conversa. Aviso
// de uma linha só segue igual. Número e unidade chegam ligados por espaço
// inquebrável do Rust ("2,3 GB" nunca se parte).

import { AlertCircle } from "lucide-react"

export function AvisoDoFio({ message }: { message: string }) {
  const quebra = message.indexOf("\n")
  const resumo = quebra < 0 ? message : message.slice(0, quebra)
  const detalhe = quebra < 0 ? "" : message.slice(quebra + 1).trim()
  return (
    <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground/80">
      <AlertCircle className="size-3 shrink-0" />
      <span>
        {resumo}
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
