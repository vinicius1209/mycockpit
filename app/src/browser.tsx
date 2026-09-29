import { StrictMode } from "react"
import { currentTheme, preferenciaPersistida, temaNativo } from "@/lib/theme"
import { createRoot } from "react-dom/client"
import { getCurrentWindow } from "@tauri-apps/api/window"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./index.css"
import { BrowserPanel } from "@/components/browser/BrowserPanel"
import { instalarGuardaDoMenuNativo } from "@/lib/nativeMenu"
import { lerEstadoPersistido } from "@/lib/chaveDoApp"

instalarGuardaDoMenuNativo({ dev: import.meta.env.DEV })

const preferencia = (() => {
  try {
    return preferenciaPersistida(lerEstadoPersistido() as { state?: Record<string, unknown> } | null)
  } catch {
    return "dark" as const
  }
})()
document.documentElement.classList.toggle("dark", currentTheme(preferencia) === "dark")
void getCurrentWindow()
  .setTheme(temaNativo(preferencia))
  .catch((cause) => console.warn("Tema nativo do painel indisponível:", cause))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserPanel />
  </StrictMode>,
)
