// O gate do "Planejar primeiro" DENTRO do fio.
//
// Saiu do rodapé do ChatPanel, onde era um card alimentado por `pendingPlan` —
// campo de runtime que morria com o processo. O relato que motivou a mudança:
// o usuário pediu um plano ao agy, o card apareceu, e depois de reabrir o app
// não havia mais nem o pedido nem qualquer registro de que ele existiu. Fomos
// no banco: a conversa tinha 31 `tool`, 2 `user`, 2 `text`, 2 `result` — e nada
// sobre o plano.
//
// Agora é item do fio (`kind: "planGate"`), então persiste no mesmo `items` que
// já era gravado, e — o que importa mais — a decisão vira HISTÓRICO: depois de
// aprovar ou descartar o cartão não some, vira uma linha dizendo o que você
// decidiu. "Eu autorizei esse plano?" passa a ter resposta.

import { ClipboardList, Check, X } from "lucide-react"
import type { PlanGateItem } from "@/lib/planMode"

/** Decidido: uma linha discreta, no lugar onde a decisão aconteceu. Não é mais
 *  um cartão de ação — é registro, e registro não compete por atenção. */
function Decidido({ decision }: { decision: "approved" | "discarded" }) {
  const aprovado = decision === "approved"
  const Icone = aprovado ? Check : X
  return (
    <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
      <Icone className="size-3.5 shrink-0" />
      <span>
        {aprovado ? "Plano aprovado por você" : "Plano descartado por você"}
      </span>
    </div>
  )
}

export function PlanGateCard({
  item,
  onApprove,
  onDiscard,
}: {
  item: PlanGateItem
  /** Ausente = não dá pra agir agora (turno em voo, ou fio de outra conversa):
   *  o cartão então só informa, sem oferecer botão que não funcionaria. */
  onApprove?: () => void
  onDiscard?: () => void
}) {
  if (item.decision) return <Decidido decision={item.decision} />
  return (
    <div className="rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 shrink-0 text-brass" />
        {/* Sem emoji aqui: o ClipboardList ao lado já é o ícone do card. */}
        <p className="min-w-0 flex-1 text-[13px] text-foreground">
          <span className="font-medium">Plano proposto</span>, aguardando sua
          aprovação. O agent só executa o que está escrito acima.
        </p>
      </div>
      {onApprove && onDiscard && (
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button
            onClick={onDiscard}
            className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
          >
            Descartar
          </button>
          <button
            onClick={onApprove}
            className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Aprovar e executar
          </button>
        </div>
      )}
    </div>
  )
}
