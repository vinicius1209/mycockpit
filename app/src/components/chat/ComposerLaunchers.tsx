import { useEffect, useRef, useState } from "react"
import { FusionLauncher } from "@/components/fusion/FusionLauncher"
import { MissionLauncher } from "@/components/mission/MissionLauncher"
import type { AgentRunConfig } from "@/lib/types"
import { useApp } from "@/store/app"

export function ComposerLaunchers({
  task,
  seed,
  onLaunched,
}: {
  task: string
  seed: AgentRunConfig
  onLaunched: () => void
}) {
  const [missionOpen, setMissionOpen] = useState(false)
  const [fusionOpen, setFusionOpen] = useState(false)

  const missionReq = useApp((s) => s.missionLaunchRequested)
  const fusionReq = useApp((s) => s.fusionLaunchRequested)

  const missionReqSeen = useRef(missionReq)
  const fusionReqSeen = useRef(fusionReq)

  useEffect(() => {
    if (missionReq !== missionReqSeen.current) {
      missionReqSeen.current = missionReq
      setMissionOpen(true)
    }
    if (fusionReq !== fusionReqSeen.current) {
      fusionReqSeen.current = fusionReq
      setFusionOpen(true)
    }
  }, [missionReq, fusionReq])

  return (
    <>
      <MissionLauncher
        open={missionOpen}
        onOpenChange={setMissionOpen}
        initialTask={task}
        onLaunched={onLaunched}
      />
      <FusionLauncher
        open={fusionOpen}
        onOpenChange={setFusionOpen}
        initialTask={task}
        seed={seed}
        onLaunched={onLaunched}
      />
    </>
  )
}
