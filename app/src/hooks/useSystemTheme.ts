import { useEffect } from "react"
import { useApp } from "@/store/app"
import { SYSTEM_THEME_QUERY } from "@/lib/theme"

/** A preferência continua "system"; os consumidores recebem sempre a cor resolvida. */
export function useSystemTheme() {
  useEffect(() => {
    const media = window.matchMedia(SYSTEM_THEME_QUERY)
    const sync = () => {
      const app = useApp.getState()
      if (app.themePreference === "system") app.setTheme("system")
    }
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])
}
