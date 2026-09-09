import { useState } from "react"
import { Check, Clock3, Copy, LocateFixed } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { copyText } from "@/lib/clipboard"
import type { DirectionChange, SemanticClaim } from "@/lib/conversationMap"
import type { ChatItem } from "@/store/chat"

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
})

export type ConversationMapSource = SemanticClaim | DirectionChange

function sourceText(item: ChatItem): string {
  switch (item.kind) {
    case "user":
    case "text":
    case "note":
    case "advice":
      return item.text
    case "planGate":
      return item.text
    case "error":
    case "limit":
      return item.message
    case "cancelled":
      return "Turno interrompido"
    case "result":
      return item.text?.trim() || (item.ok ? "Turno concluído" : "Turno encerrado com falha")
    case "tool":
      return `${item.name}, ${item.result ? (item.result.ok ? "concluída" : "falhou") : "sem desfecho"}`
    case "notice":
      return item.message
  }
}

function sourceAuthor(item: ChatItem): string {
  if (item.kind === "user" || item.kind === "note") return "Você"
  if (item.kind === "advice") return item.personaName
  if (item.kind === "text") return "Agente"
  return "Frota"
}

export function ConversationMapSourceDialog({
  source,
  items,
  onClose,
  onReveal,
}: {
  source: ConversationMapSource | null
  items: readonly ChatItem[]
  onClose: () => void
  onReveal: (itemId: string) => void
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function handleCopy(itemId: string, text: string) {
    const ok = await copyText(text)
    if (ok) {
      setCopiedId(itemId)
      setTimeout(() => {
        setCopiedId((curr) => (curr === itemId ? null : curr))
      }, 1500)
    }
  }

  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="text-[14px]">Fontes no fio</DialogTitle>
          <DialogDescription className="text-[12px]">
            A leitura aponta para trechos reais, sem copiar o transcript.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-5 py-4">
          {source?.evidence.map((ref) => {
            const item = items.find((candidate) => candidate.id === ref.itemId)
            if (!item) {
              return (
                <div key={ref.itemId} className="px-2 py-3 text-[12px] text-muted-foreground">
                  Este trecho não está mais no fio.
                </div>
              )
            }
            const text = sourceText(item)
            const isCopied = copiedId === item.id

            return (
              <div key={ref.itemId} className="rounded-lg bg-secondary/45 px-3 py-3">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">{sourceAuthor(item)}</span>
                  {item.ts != null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <Clock3 className="size-3" />
                      <span className="font-mono tabular-nums">{HORA.format(new Date(item.ts))}</span>
                    </>
                  )}
                </div>
                <div
                  data-selectable
                  className="mt-2 select-text whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80"
                >
                  {text}
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="compacto"
                    onClick={() => void handleCopy(item.id, text)}
                    title="Copiar trecho"
                  >
                    {isCopied ? <Check /> : <Copy />}
                    {isCopied ? "Copiado" : "Copiar"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="compacto"
                    onClick={() => onReveal(item.id)}
                  >
                    <LocateFixed />
                    Ver no fio
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
