import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

// Fontes offline (Fontsource), sem depender de CDN em runtime
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"

import "./index.css"
import App from "./App.tsx"
import { Fronteira } from "@/components/common/Fronteira"
import { AppContextMenu } from "@/components/common/AppContextMenu"
import { CopiaDeTabela } from "@/components/common/CopiaDeTabela"
import { installRuntimeLogging } from "@/lib/runtimeLogging"
import { lerEstadoPersistido } from "@/lib/chaveDoApp"

// Antes do primeiro render: erros do React/WebView precisam sobreviver à tela
// preta e chegar ao arquivo rotativo da release.
installRuntimeLogging()

// Tema persistido (frota.app via zustand persist) aplicado ANTES do React p/ não
// piscar dark no boot. Default = dark quando nada foi salvo. O popover da tray
// tem seu próprio entry (tray.tsx) — este só monta o App.
const dark = (() => {
  try {
    const persisted = lerEstadoPersistido() as { state?: Record<string, unknown> } | null
    if (persisted?.state?.themePreference === "system") {
      return matchMedia("(prefers-color-scheme: dark)").matches
    }
    return persisted?.state?.theme !== "light"
  } catch {
    return true
  }
})()
document.documentElement.classList.toggle("dark", dark)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fronteira area="a janela" variante="janela">
      <App />
    </Fronteira>
    {/* Botão direito é do app, nunca do motor (ADR-042). Mora no entry, e não
        dentro do App, pelo mesmo motivo do tray.tsx: a guarda do menu nativo é
        por JANELA, e o clique pode nascer dentro de qualquer portal (dialog,
        popover), que não descende de nenhuma árvore do App. */}
    <AppContextMenu />
    <CopiaDeTabela />
  </StrictMode>,
)
