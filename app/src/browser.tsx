import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { getCurrentWindow } from "@tauri-apps/api/window"
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"
import "./index.css"
import { BrowserPanel } from "@/components/browser/BrowserPanel"
import { instalarGuardaDoMenuNativo } from "@/lib/nativeMenu"

instalarGuardaDoMenuNativo({ dev: import.meta.env.DEV })

const dark = (() => {
  try {
    const persisted = JSON.parse(localStorage.getItem("mc.app") ?? "null")
    return persisted?.state?.theme !== "light"
  } catch {
    return true
  }
})()
document.documentElement.classList.toggle("dark", dark)
void getCurrentWindow()
  .setTheme(dark ? "dark" : "light")
  .catch((cause) => console.warn("Tema nativo do painel indisponível:", cause))

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserPanel />
  </StrictMode>,
)
