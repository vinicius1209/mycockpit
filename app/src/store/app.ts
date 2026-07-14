import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { PermissionMode, Project } from "@/lib/types"
import { type GlobalSettings, DEFAULT_SETTINGS } from "@/lib/settings"
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
  extraDirs: string[] // pastas extras liberadas ao agent (viram --add-dir)
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
  /** Agents com limite de uso atingido (id → hint de reset), cross-conversa. */
  limitedAgents: Record<string, string | null>
  /** Slug de plano SDD pra focar ao entrar no modo (navegação do inbox). */
  sddFocusSlug: string | null
  /** Contador-gatilho: a sidebar pede "Nova feature" e o SddView (dono do form)
   *  abre a criação ao ver o número mudar. Evita acoplamento direto. */
  sddCreateRequested: number
  /** Versão dos DADOS do SDD: o SddView bumpa ao criar/recarregar planos e a
   *  lista da sidebar recarrega ao ver mudar (dois caches, uma verdade). */
  sddDataVersion: number
  /** Preferências globais (persistidas). */
  settings: GlobalSettings
  /** Modal de configurações aberto? */
  settingsOpen: boolean

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
  setAgentLimited: (agent: string, resetHint: string | null) => void
  clearAgentLimited: (agent: string) => void
  setSddFocus: (slug: string | null) => void
  /** Pede a abertura do form de Nova feature (bump do contador). */
  requestSddCreate: () => void
  /** Sinaliza que os planos SDD mudaram no disco (criação/etapa/seed). */
  bumpSddData: () => void
  /** Patch parcial das preferências globais. */
  setSettings: (patch: Partial<GlobalSettings>) => void
  setSettingsOpen: (v: boolean) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      projects: [],
      activeProjectId: null,
      theme: "dark",
      sidebarOpen: true,
      contextOpen: true,
      viewMode: "linear",
      ready: false,
      mycockpit: {},
      limitedAgents: {},
      sddFocusSlug: null,
      sddCreateRequested: 0,
      sddDataVersion: 0,
      settings: DEFAULT_SETTINGS,
      settingsOpen: false,

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
      setAgentLimited: (agent, resetHint) =>
        set((s) => ({
          limitedAgents: { ...s.limitedAgents, [agent]: resetHint },
        })),
      clearAgentLimited: (agent) =>
        set((s) => {
          if (!(agent in s.limitedAgents)) return {}
          const rest = { ...s.limitedAgents }
          delete rest[agent]
          return { limitedAgents: rest }
        }),
      setSddFocus: (sddFocusSlug) => set({ sddFocusSlug }),
      requestSddCreate: () =>
        set((s) => ({ sddCreateRequested: s.sddCreateRequested + 1 })),
      bumpSddData: () =>
        set((s) => ({ sddDataVersion: s.sddDataVersion + 1 })),
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: "mc.app",
      version: 2,
      // SÓ preferências: nunca persistir projects/mycockpit/limitedAgents/ready/
      // activeProjectId — esses vêm do banco no boot.
      partialize: (s) => ({
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        contextOpen: s.contextOpen,
        viewMode: s.viewMode,
        settings: s.settings,
      }),
      // v1→v2: quem já tinha estado persistido é usuário EXISTENTE (não 1ª
      // instalação) → não deve ver o wizard de onboarding. Marca onboarded=true.
      // Instalação nova (sem estado persistido) NÃO chama migrate → onboarded
      // fica no default false → wizard aparece.
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as { settings?: Record<string, unknown> }
        if (fromVersion < 2) {
          p.settings = { ...(p.settings ?? {}), onboarded: true }
        }
        return p as unknown as AppState
      },
      // deep-merge de settings p/ campos novos ganharem o default (evita undefined
      // quando o schema cresce entre versões).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          ...p,
          settings: { ...current.settings, ...(p.settings ?? {}) },
        }
      },
      // DOM ↔ estado ao reidratar (o pre-mount do main.tsx já evitou o flash).
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

/** Seletor utilitário do projeto ativo. */
export function useActiveProject(): Project | null {
  return useApp(
    (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null,
  )
}
