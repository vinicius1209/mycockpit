import { LivePlanCard } from "@/components/chat/LivePlanCard"
import { RunCapabilityStrip } from "@/components/chat/RunCapabilityStrip"
import type { ConvState } from "@/store/chat"

export function RunStatusStack({
  conversation,
  detailInSidebar,
}: {
  conversation: Pick<ConvState, "items" | "running" | "finalizing" | "runManifest">
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
      <RunCapabilityStrip manifest={conversation.runManifest} />
    </>
  )
}
