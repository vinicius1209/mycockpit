// Nota do HUMANO ancorada num turno (docs/notas-no-fio-plan.md, N1).
//
// Mora em arquivo próprio porque o MessageList está no teto da catraca — e o
// recorte é natural: "bloco de nota + caixa de escrever nota" é uma peça
// fechada, não um pedaço partido pra caber.
//
// Modelo A (decidido em 19/08/2026): a nota SEMPRE viaja pro agente — entra no
// recap (`contextEntries`) e no transcript pleno (`renderTranscript`), sempre
// enquadrada como DIREÇÃO do humano, nunca como fala do agente. Não existe
// nota privada: esconder parte do fio criaria uma segunda verdade.

import { useState } from "react"
import { Check, PenLine, X } from "lucide-react"
import { useChat } from "@/store/chat"
import { cn } from "@/lib/utils"

/**
 * O bloco de uma nota já gravada, ancorado sob o turno que ela comenta.
 *
 * PENDENTE vs ENTREGUE é a informação que faltava. A caixa promete "o agente
 * vai ler", mas a entrega só acontece no PRÓXIMO envio (`withNotes`): uma nota
 * escrita e nunca seguida de envio nunca chega, e antes disso ela era
 * pixel-a-pixel idêntica a uma que já tinha chegado. Promessa sem estado é
 * promessa que o usuário não tem como cobrar.
 *
 * E por que a diferença é MATIZ, não animação: o §6 reserva movimento pro que
 * está vivo E termina sozinho. Nota pendente não termina sozinha — ela espera
 * VOCÊ mandar a próxima mensagem. É o mesmo caso da falha, que o §6 resolveu
 * com "matiz próprio, não animação" depois de já ter pulsado uma vez.
 */
export function TurnNoteBlock({
  convId,
  id,
  text,
  sent,
}: {
  convId: string
  id: string
  text: string
  sent?: boolean
}) {
  const Icone = sent ? Check : PenLine
  return (
    <div
      className={cn(
        "group/nota mt-1.5 flex items-start gap-2 rounded-lg border px-3 py-2 transition-colors",
        sent ? "border-border/30 bg-secondary/15" : "border-border/55 bg-secondary/25",
      )}
    >
      <Icone className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground/70">
          {sent ? "Sua nota · entregue ao agente" : "Sua nota · vai no próximo envio"}
        </div>
        <p
          data-selectable
          className="text-[13px] leading-snug break-words whitespace-pre-wrap text-foreground/90"
        >
          {text}
        </p>
      </div>
      <button
        type="button"
        onClick={() => useChat.getState().removeThreadItem(convId, id)}
        title="Remover nota"
        className="shrink-0 rounded p-0.5 text-transparent transition-colors group-hover/nota:text-muted-foreground/60 hover:!text-foreground"
      >
        <X className="size-3.5" />
        <span className="sr-only">Remover nota</span>
      </button>
    </div>
  )
}

/** Caixa de escrever a nota (⌘⏎ grava, Esc cancela) — mesmo par de teclas do
 *  comentário no diff, pra não inventar um segundo idioma. */
export function TurnNoteComposer({
  onSave,
  onCancel,
}: {
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState("")
  function save() {
    const t = draft.trim()
    if (t) onSave(t)
    else onCancel()
  }
  return (
    <div className="mt-1.5 flex w-full basis-full items-start gap-1.5">
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save()
          if (e.key === "Escape") onCancel()
        }}
        rows={2}
        placeholder="Sua nota sobre este turno (o agente vai ler)…"
        className={cn(
          "min-w-0 flex-1 resize-none rounded-md border bg-secondary/30 p-2 text-[13px]",
          "text-foreground outline-none focus:border-brass/40",
        )}
      />
      <div className="flex shrink-0 flex-col gap-1">
        <button
          type="button"
          onClick={save}
          title="Salvar (⌘⏎)"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PenLine className="size-3.5" />
          <span className="sr-only">Salvar nota</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancelar (Esc)"
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
        >
          <X className="size-3.5" />
          <span className="sr-only">Cancelar</span>
        </button>
      </div>
    </div>
  )
}
