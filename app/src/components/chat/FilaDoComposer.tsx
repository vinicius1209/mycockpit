// A fila do composer (ADR-240, mock aprovado em
// docs/mocks/composer-anexos-fila-video.html): mensagens digitadas durante o
// turno, que vão JUNTAS, num envio só, quando ele terminar.
//
// Antes: uma tira de texto cortado na primeira linha, anexos como nomes
// iguais ("image.png", "image.png") e um "Interromper e enviar" em cada linha,
// que mandava a fila inteira, não aquela mensagem. Agora: a mensagem em até
// duas linhas (clicar abre o resto), as imagens como miniaturas que abrem em
// tela cheia, editar e tirar no hover, arrastar pela alça para reordenar, e
// "Enviar agora" uma vez só, no cabeçalho, que é o que ele faz.

import { useRef, useState } from "react"
import { GripVertical, Pencil, X, Zap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MiniaturaDeAnexo } from "@/components/chat/MiniaturaDeAnexo"
import { moverNaFila } from "@/components/chat/filaComposer"
import { useChat, type QueuedMsg } from "@/store/chat"
import { cn } from "@/lib/utils"

/** A frase do cabeçalho, conforme o turno. Puro. */
export function fraseDaFila(turnState: "running" | "finalizing" | "idle"): string {
  if (turnState === "running") return "vão juntas, num envio só, quando este turno terminar"
  if (turnState === "finalizing") return "aguardando o fechamento do turno"
  return "prontas para enviar"
}

/** Onde soltar: o índice do item cujo meio o ponteiro passou. Puro. */
export function indiceDeSoltura(y: number, meios: readonly number[]): number {
  let i = 0
  while (i < meios.length && y > meios[i]) i++
  return i
}

export function QueuedChips({
  queued,
  onRemove,
  onEdit,
  onForceSend,
  onMover,
  turnState,
}: {
  queued: QueuedMsg[]
  onRemove: (index: number) => void
  onEdit?: (index: number) => void
  /** Interrompe o turno (se rodando) e envia a fila toda. */
  onForceSend?: (index: number) => void
  onMover?: (de: number, para: number) => void
  turnState: "running" | "finalizing" | "idle"
}) {
  const [aberta, setAberta] = useState<number | null>(null)
  const [arrastando, setArrastando] = useState<{ de: number; para: number } | null>(null)
  const itens = useRef<(HTMLLIElement | null)[]>([])
  if (queued.length === 0) return null

  const comecar = (de: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!onMover || queued.length < 2) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setArrastando({ de, para: de })
  }
  const mover = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!arrastando) return
    const meios = itens.current.map((el) => {
      const r = el?.getBoundingClientRect()
      return r ? r.top + r.height / 2 : 0
    })
    const alvo = Math.min(indiceDeSoltura(e.clientY, meios), queued.length - 1)
    if (alvo !== arrastando.para) setArrastando({ ...arrastando, para: alvo })
  }
  const soltar = () => {
    if (arrastando && arrastando.de !== arrastando.para) onMover?.(arrastando.de, arrastando.para)
    setArrastando(null)
  }

  return (
    <div className="mb-2 overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b border-border/40 py-1.5 pr-1.5 pl-3">
        <span className="rounded-md bg-st-queued/15 px-1.5 font-mono text-[11px] font-semibold text-st-queued tabular-nums">
          {queued.length}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/85">
          Na fila · {fraseDaFila(turnState)}
        </span>
        {onForceSend && (
          <Button
            variant="ghost"
            size="chip"
            onClick={() => onForceSend(0)}
            className="text-st-queued hover:bg-st-queued/15 hover:text-st-queued"
            title={turnState === "running" ? "Para o turno atual e envia a fila agora" : "Envia a fila agora"}
            aria-label={turnState === "running" ? "Interromper e enviar a fila" : "Enviar a fila"}
          >
            <Zap className="fill-current" />
            Enviar agora
          </Button>
        )}
      </div>
      <ol>
        {queued.map((msg, i) => {
          const movendo = arrastando?.de === i
          const alvo = arrastando && arrastando.para === i && arrastando.de !== i
          return (
            <li
              key={i}
              ref={(el) => {
                itens.current[i] = el
              }}
              className={cn(
                "group/item grid grid-cols-[14px_16px_minmax(0,1fr)_auto] items-start gap-x-2 py-2 pr-1.5 pl-1.5 transition-colors hover:bg-accent/30",
                i > 0 && "border-t border-border/40",
                movendo && "opacity-50",
                alvo && "bg-st-queued/10",
              )}
            >
              <button
                type="button"
                onPointerDown={comecar(i)}
                onPointerMove={mover}
                onPointerUp={soltar}
                onPointerCancel={() => setArrastando(null)}
                disabled={!onMover || queued.length < 2}
                aria-label="Arrastar para reordenar"
                title="Arrastar para reordenar"
                // `invisible`, nunca `hidden`: a alça é a 1ª coluna do grid. Com
                // um item só ela fica desabilitada, e `display:none` a tirava do
                // fluxo; tudo andava uma coluna e o texto caía na de 16px, uma
                // letra por linha (visto em 24/09/2026).
                className="flex h-[18px] cursor-grab touch-none items-center text-muted-foreground/60 opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100 active:cursor-grabbing disabled:invisible"
              >
                <GripVertical className="size-3.5" />
              </button>
              <span className="text-right font-mono text-[11px] leading-[18px] text-muted-foreground/70 tabular-nums">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => setAberta(aberta === i ? null : i)}
                title={aberta === i ? "Recolher" : "Ver a mensagem inteira"}
                className={cn(
                  "min-w-0 text-left text-[13px] leading-[18px] break-words text-foreground/90",
                  aberta !== i && "line-clamp-2",
                )}
              >
                {msg.text || <span className="text-muted-foreground">(só anexos)</span>}
              </button>
              <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                {onEdit && (
                  <Button variant="ghost" size="icone-chip" onClick={() => onEdit(i)} title="Editar no composer" aria-label="Editar mensagem">
                    <Pencil />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icone-chip"
                  onClick={() => onRemove(i)}
                  className="hover:text-destructive"
                  title="Tirar da fila"
                  aria-label="Remover da fila"
                >
                  <X />
                </Button>
              </span>
              {msg.attachments.length > 0 && (
                <span className="col-start-3 mt-1.5 flex flex-wrap gap-1.5">
                  {msg.attachments.map((a) => (
                    <MiniaturaDeAnexo key={a.path} anexo={a} galeria={msg.attachments} compacta />
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** A fila de UMA conversa: tirar e reordenar falam com o store daqui, e o
 *  console só diz qual conversa e o que fazer ao editar e ao forçar o envio. */
export function FilaDaConversa({
  convId,
  ...props
}: Omit<React.ComponentProps<typeof QueuedChips>, "onRemove" | "onMover"> & { convId: string }) {
  return (
    <QueuedChips
      {...props}
      onRemove={(i) => useChat.getState().removeQueued(convId, i)}
      onMover={(de, para) => moverNaFila(convId, de, para)}
    />
  )
}
