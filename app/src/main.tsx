import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

// Fontes offline (Fontsource), sem depender de CDN em runtime
import "@fontsource-variable/geist"
import "@fontsource-variable/geist-mono"

import "./index.css"
import App from "./App.tsx"

// dark-first (o toggle de tema entra no polish do M1)
document.documentElement.classList.add("dark")

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
