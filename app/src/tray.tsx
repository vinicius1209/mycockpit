// Entry SEPARADO do popover da tray — carrega SÓ o TrayPopover, não o grafo do
// App inteiro (stores, react-query, etc.). Antes o webview escondido bootava o
// bundle completo só pra mostrar um painel de 360×430.

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"

import "./index.css"
import { TrayPopover } from "@/components/tray/TrayPopover"
import { instalarGuardaDoMenuNativo } from "@/lib/nativeMenu"

// O popover da tray é OUTRO webview: a guarda do menu do motor é por janela, e
// a da janela principal não alcança aqui (ADR-042). Este painel não tem campo
// de texto nem fio, então ele só CALA o nativo, sem menu próprio: menu vazio é
// pior que menu ausente.
instalarGuardaDoMenuNativo({ dev: import.meta.env.DEV })

// Tema persistido (mc.app via zustand persist) aplicado antes do React.
const dark = (() => {
  try {
    const persisted = JSON.parse(localStorage.getItem("mc.app") ?? "null")
    return persisted?.state?.theme !== "light"
  } catch {
    return true
  }
})()
document.documentElement.classList.toggle("dark", dark)

// O vibrancy nativo segue o appearance do NSWindow — alinha os dois no boot.
void import("@tauri-apps/api/window")
  .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(dark ? "dark" : "light"))
  .catch(() => {})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TrayPopover />
  </StrictMode>,
)
