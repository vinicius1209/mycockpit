// A saída de um trabalho no terminal dos Bastidores, colada no fim enquanto
// você não rola para cima (quem sobe para ler não é puxado de volta).

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react"
import { Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SaidaViva } from "@/lib/bastidores"
import { copyText } from "@/lib/clipboard"
import { semCor, trechosComCor } from "@/lib/corDoTerminal"

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
  const trechos = useMemo(() => trechosComCor(texto), [texto])

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
        // A saída é o que se veio ler: o texto mais forte da vista.
        <div className="group/saida">
          {/* Faixa de altura ZERO colada no topo da rolagem: o botão acompanha quem
              lê uma saída comprida sem reservar linha nem largura do log. */}
          <div className="sticky top-0 z-10 flex h-0 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icone-chip"
              onClick={() => void copyText(semCor(texto), "Saída copiada")}
              title="Copiar a saída"
              aria-label="Copiar a saída"
              className="bg-terminal-raised text-terminal-dim opacity-0 group-hover/saida:opacity-100 focus-visible:opacity-100 hover:bg-terminal-line hover:text-terminal-strong dark:hover:bg-terminal-line"
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          <pre data-selectable className="font-mono break-words whitespace-pre-wrap text-terminal-strong [overflow-wrap:anywhere]">
            {trechos.map((t, i) => (t.classe ? <span key={i} className={t.classe}>{t.texto}</span> : t.texto))}
          </pre>
        </div>
      ) : (
        <p className="text-terminal-dim">{vazio}</p>
      )}
      {fim}
    </div>
  )
}
