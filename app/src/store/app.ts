import { create } from "zustand"
import type { PermissionMode, Project } from "@/lib/types"

type Theme = "dark" | "light"

/** Config por projeto (espelho resolvido de .mycockpit/config.toml — Fase 1). */
export interface ProjectConfig {
  exists: boolean
  permission: PermissionMode
  helper: string | null // null = sugestões desligadas
  mode: string // linear | fusion | sdd
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  theme: Theme
  sidebarOpen: boolean
  contextOpen: boolean
  ready: boolean
  /** Config por projeto vinda de .mycockpit/config.toml (Fase 1). */
  mycockpit: Record<string, ProjectConfig>

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  setActiveProject: (id: string | null) => void
  setProjectPermission: (id: string, mode: PermissionMode) => void
  setMycockpit: (id: string, cfg: ProjectConfig) => void
  patchMycockpit: (id: string, patch: Partial<ProjectConfig>) => void
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
  mycockpit: {},

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
  setMycockpit: (id, cfg) =>
    set((s) => ({ mycockpit: { ...s.mycockpit, [id]: cfg } })),
  patchMycockpit: (id, patch) =>
    set((s) => {
      const cur = s.mycockpit[id]
      if (!cur) return {}
      return { mycockpit: { ...s.mycockpit, [id]: { ...cur, ...patch } } }
    }),
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
