import type { Project } from "@/lib/types"

// Ambiente de navegador/demo: dados deliberadamente fictícios. Este caminho é
// usado por smoke tests, capturas de marketing e desenvolvimento sem Tauri —
// nunca deve carregar nomes, caminhos ou métricas do computador do autor.
export const BROWSER_DEMO_PROJECTS: Project[] = [
  {
    id: "demo-atlas",
    name: "atlas-commerce",
    path: "/demo/atlas-commerce",
    createdAt: 3,
    hasClaudeMd: true,
    hasAgentsMd: true,
    status: "idle",
  },
  {
    id: "demo-lumen",
    name: "lumen-mobile",
    path: "/demo/lumen-mobile",
    createdAt: 2,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  },
  {
    id: "demo-northstar",
    name: "northstar-docs",
    path: "/demo/northstar-docs",
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: true,
    status: "idle",
  },
]
