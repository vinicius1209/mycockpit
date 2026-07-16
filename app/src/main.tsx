import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

// Fontes offline (Fontsource), sem depender de CDN em runtime
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"

import "./index.css"
import App from "./App.tsx"
import { TrayPopover } from "@/components/tray/TrayPopover"

// Tema persistido (mc.app via zustand persist) aplicado ANTES do React p/ não
// piscar dark no boot. Default = dark quando nada foi salvo.
const dark = (() => {
  try {
    const persisted = JSON.parse(localStorage.getItem("mc.app") ?? "null")
    return persisted?.state?.theme !== "light"
  } catch {
    return true
  }
})()
document.documentElement.classList.toggle("dark", dark)

const isTraySurface =
  new URLSearchParams(window.location.search).get("surface") === "tray"

// Popover: o vibrancy nativo segue o appearance do NSWindow, não a classe do
// documento — alinha os dois já no boot (tema do app pode divergir do sistema).
if (isTraySurface) {
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().setTheme(dark ? "dark" : "light"),
    )
    .catch(() => {})
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isTraySurface ? <TrayPopover /> : <App />}</StrictMode>,
)
