// Balão de mensagem do usuário com suporte a menções e ações rápidas no hover.
// Permite editar e reenviar para o composer, bifurcar (fork) a conversa a partir deste
// ponto ou copiar o texto para a área de transferência.

import { useMemo, useState } from "react"
import { Check, Copy, CornerDownRight, GitFork, PenLine } from "lucide-react"
import { toast } from "sonner"
import { splitMentions } from "@/components/chat/mentions"
import { Button } from "@/components/ui/button"
import { usePresets } from "@/store/presets"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { blocoDaCitacaoNoTexto, itemDaCitacao, separarCitacoes } from "@/lib/citacao"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

export function MentionText({ text }: { text: string }) {
  const list = usePresets((s) => s.list)
  const segs = useMemo(
    () => splitMentions(text, list.map((p) => p.name)),
    [text, list],
  )
  if (segs.length === 1 && segs[0].type === "text") return <>{text}</>
  return (
    <>
      {segs.map((seg, i) =>
        seg.type === "mention" ? (
          <span
            key={i}
            className="rounded bg-brass/[0.12] px-1 font-medium text-brass"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  )
}

export function UserMessageBubble({
  itemId,
  text,
}: {
  itemId: string
  text: string
}) {
  const [copied, setCopied] = useState(false)
  const [forking, setForking] = useState(false)
  // Citação enviada (capricho R4) vira linha ↳ acima do texto, nunca o formato cru.
  const { citacoes, corpo } = useMemo(() => separarCitacoes(text), [text])

  function handleEdit() {
    const convId = useChat.getState().activeId
    if (!convId) return

    const drafts = useComposerDrafts.getState()
    drafts.setText(convId, corpo)
    if (citacoes.length > 0) drafts.setBlocos(convId, citacoes.map((c) => blocoDaCitacaoNoTexto(c)))
    const inputEl = document.querySelector<HTMLElement>('[data-composer="console"]')
    if (inputEl) {
      inputEl.focus()
    }
    toast("Mensagem carregada no composer para edição.")
  }

  async function handleFork() {
    const convId = useChat.getState().activeId
    if (!convId || !itemId) return

    setForking(true)
    try {
      const created = await useChat.getState().forkConversationAt(convId, itemId)
      if (!created) {
        toast.error("Não foi possível bifurcar a conversa a partir desta mensagem.")
      }
    } catch (err) {
      toast.error("Não foi possível bifurcar a conversa.", {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setForking(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast("Mensagem copiada para a área de transferência.")
    } catch {
      toast.error("Não foi possível copiar o texto.")
    }
  }

  return (
    <div className="group relative inline-block max-w-full">
      {citacoes.map((c, i) => (
        <button
          key={i}
          type="button"
          title={`Ir para a mensagem original: ${c.trecho}`}
          // C-Q3: a busca é feita no clique, não a cada render do fio.
          onClick={() => {
            const convId = useChat.getState().activeId
            const items = convId ? useChat.getState().byId[convId]?.items : undefined
            const original = items ? itemDaCitacao(items, c.trecho, itemId) : null
            if (convId && original) useApp.getState().revealTranscriptItem(convId, original)
            else toast("A mensagem citada não está mais nesta conversa.")
          }}
          className="mb-1 flex max-w-[520px] items-center gap-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <CornerDownRight className="size-3 shrink-0" />
          <span className="shrink-0 font-mono text-[11px]">
            {c.autor} · {c.hora}
          </span>
          <span className="min-w-0 truncate italic">«{c.trecho.replace(/\s+/g, " ")}»</span>
        </button>
      ))}
      <div
        data-selectable
        className="max-w-full rounded-2xl rounded-tl-md bg-secondary px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground"
      >
        <MentionText text={corpo} />
      </div>

      <div
        className={cn(
          "absolute -top-3.5 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border/40 bg-card p-0.5 shadow-xs transition-opacity duration-150",
          "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={handleEdit}
          title="Editar e reenviar"
          aria-label="Editar e reenviar"
          className="text-muted-foreground hover:text-foreground"
        >
          <PenLine className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => void handleFork()}
          disabled={forking}
          title="Bifurcar conversa a partir daqui"
          aria-label="Bifurcar conversa a partir daqui"
          className="text-muted-foreground hover:text-foreground"
        >
          <GitFork className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icone-chip"
          onClick={() => void handleCopy()}
          title="Copiar mensagem"
          aria-label="Copiar mensagem"
          className="text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3 text-foreground" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
      </div>
    </div>
  )
}
