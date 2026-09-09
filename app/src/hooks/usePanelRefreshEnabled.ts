import { useEffect, useState } from "react"
import { useApp } from "@/store/app"

/** Trabalho periódico do Painel só existe quando a superfície pode ser vista. */
export function usePanelRefreshEnabled(): boolean {
  const panelActive = useApp((state) => state.viewMode === "painel")
  const [windowVisible, setWindowVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  )

  useEffect(() => {
    const update = () => setWindowVisible(!document.hidden)
    document.addEventListener("visibilitychange", update)
    return () => document.removeEventListener("visibilitychange", update)
  }, [])

  return panelActive && windowVisible
}
