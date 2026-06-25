import { create } from "zustand"
import type { Project } from "@/lib/types"

type Theme = "dark" | "light"

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  theme: Theme
  sidebarOpen: boolean
  contextOpen: boolean
  ready: boolean

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  setActiveProject: (id: string | null) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleContext: () => void
  setReady: (v: boolean) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export const useApp = create<AppState>((set) => ({
  projects: [],
  activeProjectId: null,
  theme: "dark",
  sidebarOpen: true,
  contextOpen: true,
  ready: false,

  setProjects: (projects) =>
    set((s) => ({
      projects,
      activeProjectId: s.activeProjectId ?? projects[0]?.id ?? null,
    })),
  addProject: (p) =>
    set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
  setActiveProject: (id) => set({ activeProjectId: id }),
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === "dark" ? "light" : "dark"
      applyTheme(theme)
      return { theme }
    }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleContext: () => set((s) => ({ contextOpen: !s.contextOpen })),
  setReady: (ready) => set({ ready }),
}))

/** Seletor utilitário do projeto ativo. */
export function useActiveProject(): Project | null {
  return useApp(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  )
}
