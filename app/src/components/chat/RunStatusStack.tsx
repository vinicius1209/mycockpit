import { LivePlanCard } from "@/components/chat/LivePlanCard"
import { ExcecoesDoTurno } from "@/components/chat/ExcecoesDoTurno"
import type { ConvState } from "@/store/chat"

export function RunStatusStack({
  conversation,
  detailInSidebar,
}: {
  conversation: Pick<ConvState, "items" | "running" | "finalizing" | "runManifest" | "agent">
  detailInSidebar: boolean
}) {
  return (
    <>
      <LivePlanCard
        items={conversation.items}
        running={conversation.running}
        finalizing={conversation.finalizing}
        detailInSidebar={detailInSidebar}
      />
      {/* Só exceção (ADR-239): sem nada que peça atenção, não há faixa. */}
      <ExcecoesDoTurno manifest={conversation.runManifest} agent={conversation.agent} />
    </>
  )
}
