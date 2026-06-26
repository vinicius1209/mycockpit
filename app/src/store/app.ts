import { create } from "zustand"
import type { PermissionMode, Project } from "@/lib/types"

type Theme = "dark" | "light"

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  theme: Theme
  sidebarOpen: boolean
  contextOpen: boolean
  ready: boolean
  /** Modelo auxiliar p/ sugestões/títulos (Sprint 3). null = desligado. */
  helperModel: string | null

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  setActiveProject: (id: string | null) => void
  setProjectPermission: (id: string, mode: PermissionMode) => void
  setHelperModel: (m: string | null) => void
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
  helperModel: "haiku",

  setProjects: (projects) =>
    set((s) => ({
      projects,
      activeProjectId: s.activeProjectId ?? projects[0]?.id ?? null,
    })),
  addProject: (p) =>
    set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
  setActiveProject: (id) => set({ activeProjectId: id }),
  setProjectPermission: (id, mode) =>
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, permissionMode: mode } : p,
      ),
    })),
  setHelperModel: (helperModel) => set({ helperModel }),
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
