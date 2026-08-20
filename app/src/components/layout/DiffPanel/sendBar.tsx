// Rodapé dos comentários do diff: a tira de ÓRFÃOS + a barra de envio.
// Extraído de DiffPanel.tsx porque o arquivo-mãe estava em 629/700 linhas e
// a regra da casa é dividir, nunca subir o teto.
//
// Órfão = comentário cuja linha não existe mais no diff atual (o agente mexeu
// no arquivo e o "Atualizar" trouxe outro conteúdo). Ele NÃO é descartado e
// NÃO é re-ancorado por adivinhação: aparece aqui, com o `path:linha` original
// e o trecho citado, e continua indo na mensagem — a citação já o torna
// auto-suficiente. Errar o palpite é pior que admitir (§6 do STYLEGUIDE).

import { MessageSquarePlus, X } from "lucide-react"
import type { DiffComment } from "@/lib/deliveryDiff"

export function DiffCommentsFooter({
  total,
  stale,
  onRemove,
  onDiscard,
  onSend,
}: {
  total: number
  stale: readonly DiffComment[]
  onRemove: (id: string) => void
  onDiscard: () => void
  onSend: () => void
}) {
  if (total === 0) return null
  return (
    <>
      {stale.length > 0 && (
        <div className="shrink-0 border-t bg-st-warning/[0.06] px-3 py-2">
          <p className="text-[11px] text-muted-foreground">
            {stale.length} comentário{stale.length === 1 ? "" : "s"} saí
            {stale.length === 1 ? "u" : "ram"} do lugar: a linha mudou depois
            que você escreveu. O trecho citado vai junto na mensagem.
          </p>
          <div className="mt-1.5 flex flex-col gap-1">
            {stale.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-2 rounded border border-border/50 bg-card/40 px-2 py-1.5 text-[11px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-muted-foreground">
                    {c.path}
                    {c.lineNo != null ? `:${c.lineNo}` : ""}
                  </span>
                  <span className="block truncate font-mono text-muted-foreground/60">
                    {c.codeText.trim()}
                  </span>
                  <span className="mt-0.5 block text-foreground/85">{c.note}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(c.id)}
                  title="Remover comentário"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-t bg-brass/[0.05] px-3 py-2 text-[12px]">
        <MessageSquarePlus className="size-3.5 text-brass" />
        <span className="text-foreground/85">
          {total} comentário{total === 1 ? "" : "s"} no diff
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-md border px-2.5 py-1 text-foreground transition-colors hover:bg-accent"
          >
            Descartar
          </button>
          <button
            type="button"
            onClick={onSend}
            className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 font-medium text-background transition-opacity hover:opacity-90"
          >
            Enviar ao agente
          </button>
        </div>
      </div>
    </>
  )
}
