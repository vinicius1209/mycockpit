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
try {
  const persisted = JSON.parse(localStorage.getItem("mc.app") ?? "null")
  document.documentElement.classList.toggle(
    "dark",
    persisted?.state?.theme !== "light",
  )
} catch {
  document.documentElement.classList.add("dark")
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get("surface") === "tray" ? (
      <TrayPopover />
    ) : (
      <App />
    )}
  </StrictMode>,
)
