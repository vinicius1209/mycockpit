// A saída de um trabalho no terminal dos Bastidores, colada no fim enquanto
// você não rola para cima (quem sobe para ler não é puxado de volta).

import { useLayoutEffect, useRef, type ReactNode } from "react"
import type { SaidaViva } from "@/lib/bastidores"

export function SaidaDeLog({
  saida,
  vazio,
  cabeca,
  fim,
}: {
  saida: SaidaViva
  /** O que dizer antes da primeira linha. */
  vazio: string
  /** Prompt e linha de comando, antes da saída. */
  cabeca?: ReactNode
  /** Cursor vivo ou a linha de estado final, depois da saída. */
  fim?: ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const colado = useRef(true)
  const texto = saida.resto ? [...saida.linhas, saida.resto].join("\n") : saida.linhas.join("\n")

  useLayoutEffect(() => {
    const el = caixa.current
    if (el && colado.current) el.scrollTop = el.scrollHeight
  }, [texto])

  return (
    <div
      ref={caixa}
      onScroll={(e) => {
        const el = e.currentTarget
        colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className="min-h-0 flex-1 overflow-auto px-3.5 py-3"
    >
      {cabeca}
      {saida.descartadas > 0 && (
        <p className="text-terminal-dim">Linhas anteriores foram omitidas para manter a vista leve.</p>
      )}
      {texto ? (
        <pre data-selectable className="font-mono break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          {texto}
        </pre>
      ) : (
        <p className="text-terminal-dim">{vazio}</p>
      )}
      {fim}
    </div>
  )
}
