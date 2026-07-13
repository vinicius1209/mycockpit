import { useEffect, useState } from "react"
import { ShieldQuestion, Check, X, Terminal } from "lucide-react"
import {
  onApprovalRequest,
  answerApproval,
  type ApprovalRequest,
} from "@/lib/agent"
import { isTauri } from "@/lib/db"

/** Aprovação GRANULAR inline (autonomia, Dimensão 1). Enquanto o Claude (modo
 *  Padrao) espera OK p/ uma tool que precisa de aprovação, o turno fica PAUSADO e
 *  este banner (acima do composer) mostra o comando exato + [Aprovar] [Negar]. Ao
 *  decidir, chama `answer_approval` → o turno CONTINUA. Vários pedidos empilham
 *  (o Claude pode encadear tools); cada um é respondido pelo seu `id`.
 *
 *  Independente do chat store (escuta o evento global do backend), por isso é só
 *  montado no ChatPanel. Fecha um pedido só depois que o backend confirmar a
 *  decisão (senão o botão sumia antes de destravar o turno). */
export function ApprovalModal() {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    let alive = true
    void onApprovalRequest((req) => {
      // dedup defensivo por id (um re-emit não duplica o card).
      setQueue((q) => (q.some((r) => r.id === req.id) ? q : [...q, req]))
    }).then((fn) => {
      if (alive) unlisten = fn
      else fn() // desmontou antes do listener registrar
    })
    return () => {
      alive = false
      unlisten?.()
    }
  }, [])

  async function decide(req: ApprovalRequest, allow: boolean) {
    setBusy(req.id)
    try {
      await answerApproval(req.id, allow)
      setQueue((q) => q.filter((r) => r.id !== req.id))
    } catch {
      // se a resposta falhou, mantém o card (o usuário pode tentar de novo).
    } finally {
      setBusy(null)
    }
  }

  if (queue.length === 0) return null
  // mostra o pedido mais antigo (FIFO); os demais aguardam a vez.
  const req = queue[0]
  const extra = queue.length - 1

  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          O agente pediu permissão para usar{" "}
          <span className="font-medium">{req.tool_name}</span>. O turno está{" "}
          <span className="font-medium text-brass">pausado</span> aguardando você.
          {extra > 0 && (
            <span className="text-muted-foreground">
              {" "}(+{extra} na fila)
            </span>
          )}
        </p>
      </div>
      {req.command ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border bg-card/70 px-2.5 py-1.5">
          <Terminal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11.5px] text-foreground/90">
            {req.command}
          </code>
        </div>
      ) : (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md border bg-card/70 px-2.5 py-1.5 font-mono text-[11px] text-foreground/80">
          {JSON.stringify(req.input, null, 2)}
        </pre>
      )}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          onClick={() => void decide(req, false)}
          disabled={busy === req.id}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <X className="size-3.5" /> Negar
        </button>
        <button
          onClick={() => void decide(req, true)}
          disabled={busy === req.id}
          className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check className="size-3.5" /> Aprovar
        </button>
      </div>
    </div>
  )
}
