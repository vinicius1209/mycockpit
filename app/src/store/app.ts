import { create } from "zustand"
import type { PermissionMode, Project } from "@/lib/types"
import {
  renameProject as dbRenameProject,
  setProjectColor as dbSetProjectColor,
} from "@/lib/db"

type Theme = "dark" | "light"

/** Config por projeto (espelho resolvido de .mycockpit/config.toml, Fase 1). */
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
  /** Modo do centro: chat Linear, a Arena do Fusion, ou o pipeline do SDD. */
  viewMode: "linear" | "fusion" | "sdd"
  ready: boolean
  /** Config por projeto vinda de .mycockpit/config.toml (Fase 1). */
  mycockpit: Record<string, ProjectConfig>

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  setActiveProject: (id: string | null) => void
  setProjectPermission: (id: string, mode: PermissionMode) => void
  /** Renomeia o projeto (store + persiste no banco). */
  renameProject: (id: string, name: string) => void
  /** Define/limpa (null) a cor-rótulo do projeto. */
  setProjectColor: (id: string, color: string | null) => void
  setMycockpit: (id: string, cfg: ProjectConfig) => void
  patchMycockpit: (id: string, patch: Partial<ProjectConfig>) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleContext: () => void
  setViewMode: (m: "linear" | "fusion" | "sdd") => void
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
  viewMode: "linear",
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
  renameProject: (id, name) => {
    const n = name.trim()
    if (!n) return
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name: n } : p)),
    }))
    void dbRenameProject(id, n)
  },
  setProjectColor: (id, color) => {
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, color } : p)),
    }))
    void dbSetProjectColor(id, color)
  },
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
  setViewMode: (viewMode) => set({ viewMode }),
  toggleContext: () => set((s) => ({ contextOpen: !s.contextOpen })),
  setReady: (ready) => set({ ready }),
}))

/** Seletor utilitário do projeto ativo. */
export function useActiveProject(): Project | null {
  return useApp(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  )
}
