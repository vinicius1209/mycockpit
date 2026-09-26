// O cartão de um pedido de RECURSO (ADR-261, mock `docs/mocks/avisos.html`):
// o agente quer o navegador do projeto ou o computador e está esperando.
//
// Mesmo idioma das aprovações (superfície âmbar de decisão pendente, a origem
// no alto), porque é a mesma coisa: o turno parou e a decisão é sua. Antes era
// um toast sem prazo em cima do composer, e o ✕ dele era a recusa. Aqui
// "Agora não" é um botão, e o ✕ não existe: dispensar SEM decidir não é uma
// resposta que o agente entenda.

import { ArrowRight, Globe, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { goToOrigin, QueueHint } from "@/components/chat/pecasDoPedido"
import { PENDING_DECISION } from "@/lib/attention"
import type { RecursoData } from "@/lib/interaction"
import { nomeDoProjeto, textoDoPedido } from "@/lib/pedidosDeRecurso"
import { cn } from "@/lib/utils"
import type { InteractionOrigin } from "@/store/interactions"

export function CartaoDeRecurso({
  data,
  origin,
  compact,
  extra,
  onDecide,
}: {
  data: RecursoData
  origin: InteractionOrigin | null
  /** No canto (a conversa dona não está na tela): sem o detalhe, com "Abrir". */
  compact: boolean
  extra: number
  onDecide: (sim: boolean) => void
}) {
  const texto = textoDoPedido(data, nomeDoProjeto(data.projectPath))
  const Icone = data.recurso === "navegador" ? Globe : Monitor
  return (
    <div className={cn("mb-2 rounded-lg border px-3 py-2.5", PENDING_DECISION)} data-pedido={data.recurso}>
      {origin && (
        <p className="mb-1.5 truncate text-[11px] text-muted-foreground">
          {origin.projectName}
          <span className="mx-1 opacity-50">·</span>
          {origin.convTitle}
        </p>
      )}
      <div className="flex items-start gap-2">
        <Icone className="mt-0.5 size-4 shrink-0 text-st-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-foreground">
            <span className="font-medium">{texto.titulo}</span>. O agente está{" "}
            <span className="font-medium">esperando</span> você.
            <QueueHint extra={extra} />
          </p>
          {!compact && <p className="mt-0.5 text-[12px] text-muted-foreground">{texto.detalhe}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {compact && origin && (
          <Button
            variant="ghost"
            size="compacto"
            className="mr-auto"
            onClick={() => void goToOrigin(origin)}
            title="Abrir a conversa que pediu"
          >
            Abrir <ArrowRight />
          </Button>
        )}
        <Button variant="outline" size="compacto" onClick={() => onDecide(false)}>
          Agora não
        </Button>
        <Button size="compacto" onClick={() => onDecide(true)}>
          {texto.sim}
        </Button>
      </div>
    </div>
  )
}
