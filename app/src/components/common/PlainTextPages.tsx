import { useState } from "react"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { plainTextPage } from "./markdownBudget"

/** Conteúdo integral preservado; parser, highlight e DOM recebem trabalho limitado. */
export function PlainTextPages({ text }: { text: string }) {
  const [requested, setRequested] = useState(0)
  const current = plainTextPage(text, requested)
  return (
    <div data-plain-text className="min-w-0 space-y-2 text-[14px] text-foreground">
      <p className="text-[12px] text-muted-foreground">
        Mensagem extensa, exibida em partes sem formatação. O conteúdo está completo.
      </p>
      <pre data-selectable className="max-h-80 overflow-auto font-mono text-[13px] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {current.text}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" size="compacto" disabled={current.page === 0}
          onClick={() => setRequested(current.page - 1)}>Parte anterior</Button>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
          {current.page + 1} de {current.count}
        </span>
        <Button type="button" variant="ghost" size="compacto" disabled={current.page + 1 === current.count}
          onClick={() => setRequested(current.page + 1)}>Próxima parte</Button>
        <Button type="button" variant="ghost" size="compacto"
          onClick={() => { void copyText(text) }}>Copiar mensagem completa</Button>
      </div>
    </div>
  )
}
