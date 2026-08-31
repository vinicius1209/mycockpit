import { useEffect, useState } from "react"
import { DynamicHud } from "@/components/tray/DynamicHud"
import { TrayPopover } from "@/components/tray/TrayPopover"
import {
  hudStatus,
  listenHudState,
  type HudRuntimeView,
} from "@/lib/hud"

export function TraySurface() {
  const [runtime, setRuntime] = useState<HudRuntimeView | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void hudStatus()
      .then((status) => {
        if (!disposed) setRuntime(status)
      })
      .catch((cause) => {
        console.error("Estado do instrumento indisponível:", cause)
        if (!disposed) setFailed(true)
      })
    void listenHudState((status) => {
      if (!disposed) {
        setRuntime(status)
        setFailed(false)
      }
    })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((cause) => {
        console.error("Atualizações do instrumento indisponíveis:", cause)
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  if (!runtime && !failed) return null
  if (
    runtime?.enabled &&
    runtime.effectivePosition !== "menubar"
  ) {
    return <DynamicHud runtime={runtime} />
  }
  return <TrayPopover />
}
