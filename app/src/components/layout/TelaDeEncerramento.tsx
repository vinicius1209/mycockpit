// A tela de encerramento (ADR-235). Depois que a pessoa confirma a saída, ela
// cobre a janela e mostra o que a Frota está fechando: cada item gira enquanto
// o registro dono dele não confirma a saída, vira ✓ quando confirma, e o que
// estava de pé no fim da espera aparece como encerrado à força.
//
// Container fino + lista pura (props): a lista é testável sem store, e o
// container resolve o título da conversa de cada tarefa, que o Rust não sabe.

import { Check } from "lucide-react"
import { useChat } from "@/store/chat"
import { useEncerramento, type ItemDoEncerramento } from "@/store/encerramento"
import { cn } from "@/lib/utils"

export interface LinhaDoEncerramento {
  id: string
  titulo: string
  detalhe: string | null
  estado: ItemDoEncerramento["estado"]
}

function Marca({ estado }: { estado: LinhaDoEncerramento["estado"] }) {
  if (estado === "encerrando") return <span className="conv-spin" aria-hidden />
  return (
    <Check
      className={cn("size-3.5", estado === "forcado" ? "text-st-warning" : "text-muted-foreground")}
      aria-hidden
    />
  )
}

export function ListaDoEncerramento({
  linhas,
  pronto,
}: {
  linhas: LinhaDoEncerramento[]
  pronto: boolean
}) {
  const faltam = linhas.filter((l) => l.estado === "encerrando").length
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[300] grid place-items-center bg-background"
    >
      <section className="w-[380px] max-w-[calc(100vw-48px)] rounded-xl border bg-card p-5 shadow-[var(--shadow-pop)]">
        <h2 className="text-[14px] font-medium text-foreground">Encerrando o Frota</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {pronto
            ? "Tudo o que o Frota abriu foi encerrado."
            : "Fechando o que o Frota abriu. Nada fica rodando por baixo."}
        </p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {linhas.map((linha) => (
            <li key={linha.id} className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5">
              {/* 16px de trilho: o anel (11px) e o ✓ (14px) centram no mesmo eixo. */}
              <span className="flex h-[18px] items-center justify-center">
                <Marca estado={linha.estado} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] leading-[18px] text-foreground/85">{linha.titulo}</p>
                {(linha.detalhe || linha.estado === "forcado") && (
                  <p className="truncate text-[11px] text-muted-foreground">
                    {linha.estado === "forcado" ? (
                      <span className="text-st-warning">encerrado à força</span>
                    ) : null}
                    {linha.estado === "forcado" && linha.detalhe ? " · " : null}
                    {linha.detalhe}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {!pronto && faltam > 0 && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground tabular-nums">
            {faltam} de {linhas.length} ainda encerrando
          </p>
        )}
      </section>
    </div>
  )
}

/** Título da conversa de uma tarefa ou processo, quando o fio sabe. */
function tituloDaConversa(convId: string | undefined, runId: string | undefined): string | null {
  const chat = useChat.getState()
  const id =
    convId ??
    (runId ? Object.entries(chat.byId).find(([, conv]) => conv.runId === runId)?.[0] : undefined)
  if (!id) return null
  for (const lista of Object.values(chat.conversationsByProject)) {
    const meta = lista.find((c) => c.id === id)
    if (meta?.title) return meta.title
  }
  return null
}

export function linhasDoEncerramento(itens: ItemDoEncerramento[]): LinhaDoEncerramento[] {
  return itens.map((item) => {
    const conversa = tituloDaConversa(item.convId, item.runId)
    if (item.tipo === "run") {
      return { id: item.id, titulo: conversa ?? item.rotulo, detalhe: "tarefa do agente", estado: item.estado }
    }
    return { id: item.id, titulo: item.rotulo, detalhe: conversa, estado: item.estado }
  })
}

export function TelaDeEncerramento() {
  const itens = useEncerramento((s) => s.itens)
  const pronto = useEncerramento((s) => s.pronto)
  if (!itens) return null
  return <ListaDoEncerramento linhas={linhasDoEncerramento(itens)} pronto={pronto} />
}
