import { create } from "zustand"
import { persist } from "zustand/middleware"
import { emit } from "@tauri-apps/api/event"
import type { PermissionMode, Project } from "@/lib/types"
import { type GlobalSettings, DEFAULT_SETTINGS } from "@/lib/settings"
import {
  isTauri,
  renameProject as dbRenameProject,
  setProjectColor as dbSetProjectColor,
} from "@/lib/db"

type Theme = "dark" | "light"

/** Config por projeto (espelho resolvido de .mycockpit/config.toml, Fase 1). */
export interface ProjectConfig {
  exists: boolean
  permission: PermissionMode
  helper: string | null // null = sugestões desligadas
  mode: string // linear | sdd (o valor legado "fusion" é aceito e ignorado)
  extraDirs: string[] // pastas extras liberadas ao agent (viram --add-dir)
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  theme: Theme
  sidebarOpen: boolean
  contextOpen: boolean
  /** Superfície do centro (F4): Painel (home cross-projeto), Trabalho (chat
   *  Linear), Features (SDD) ou Escritório (Agent Office). A disputa Fusion
   *  vive dentro da conversa via ⚔️ do composer, não é um modo. Valores
   *  antigos ("linear"/"sdd") seguem válidos → sem migração de persist.
   *  "office" NUNCA persiste como modo de boot (partialize grava "linear"). */
  viewMode: "painel" | "linear" | "sdd" | "office"
  /** F7 — view GLOBAL "Agendado" aberta? Estado PRÓPRIO (não é um viewMode):
   *  quando true, ela cobre o conteúdo principal; qualquer navegação (trocar
   *  superfície/projeto) fecha. Não persiste. */
  scheduledOpen: boolean
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
  /** Contadores-gatilho dos launchers do composer (Launchpad pede, o
   *  CommandConsole — dono dos dialogs — abre ao ver mudar). */
  missionLaunchRequested: number
  fusionLaunchRequested: number
  /** Versão dos DADOS do SDD: o SddView bumpa ao criar/recarregar planos e a
   *  lista da sidebar recarrega ao ver mudar (dois caches, uma verdade). */
  sddDataVersion: number
  /** P3 — Entrega→diff em 1 clique: intenção "abrir a conversa com o painel de
   *  Alterações já aberto" + o texto da entrega (vira o prefill de correção).
   *  Efêmera (não persiste); o ContextPanel consome quando a conversa bate. */
  deliveryDiff: { convId: string; text: string } | null
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
  setViewMode: (m: "painel" | "linear" | "sdd" | "office") => void
  /** Abre/fecha a view global "Agendado" (F7). */
  setScheduledOpen: (v: boolean) => void
  setReady: (v: boolean) => void
  setAgentLimited: (agent: string, resetHint: string | null) => void
  clearAgentLimited: (agent: string) => void
  setSddFocus: (slug: string | null) => void
  /** Pede a abertura do form de Nova feature (bump do contador). */
  requestSddCreate: () => void
  /** Pedem a abertura dos launchers de missão/disputa no composer. */
  requestMissionLaunch: () => void
  requestFusionLaunch: () => void
  /** Sinaliza que os planos SDD mudaram no disco (criação/etapa/seed). */
  bumpSddData: () => void
  /** Pede a abertura do diff de uma entrega (aba Alterações + header de correção). */
  requestDeliveryDiff: (convId: string, text: string) => void
  clearDeliveryDiff: () => void
  /** Patch parcial das preferências globais. */
  setSettings: (patch: Partial<GlobalSettings>) => void
  setSettingsOpen: (v: boolean) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  // O popover da tray é OUTRO contexto JS (webview próprio) e só lê o tema no
  // boot — sem este broadcast ele ficaria no tema antigo até reiniciar o app.
  if (isTauri()) void emit("app://theme", theme).catch(() => {})
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
      scheduledOpen: false,
      ready: false,
      mycockpit: {},
      limitedAgents: {},
      sddFocusSlug: null,
      sddCreateRequested: 0,
      missionLaunchRequested: 0,
      fusionLaunchRequested: 0,
      sddDataVersion: 0,
      deliveryDiff: null,
      settings: DEFAULT_SETTINGS,
      settingsOpen: false,

      setProjects: (projects) =>
        set((s) => ({
          projects,
          activeProjectId: s.activeProjectId ?? projects[0]?.id ?? null,
        })),
      addProject: (p) =>
        set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
      // trocar de projeto é navegação → fecha a view global "Agendado".
      setActiveProject: (id) =>
        set({ activeProjectId: id, scheduledOpen: false }),
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
      // o switcher NÃO conhece o Agendado; trocar de superfície só o fecha.
      setViewMode: (viewMode) => set({ viewMode, scheduledOpen: false }),
      setScheduledOpen: (scheduledOpen) => set({ scheduledOpen }),
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
      requestMissionLaunch: () =>
        set((s) => ({ missionLaunchRequested: s.missionLaunchRequested + 1 })),
      requestFusionLaunch: () =>
        set((s) => ({ fusionLaunchRequested: s.fusionLaunchRequested + 1 })),
      bumpSddData: () =>
        set((s) => ({ sddDataVersion: s.sddDataVersion + 1 })),
      requestDeliveryDiff: (convId, text) =>
        set({ deliveryDiff: { convId, text } }),
      clearDeliveryDiff: () => set({ deliveryDiff: null }),
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    }),
    {
      name: "mc.app",
      version: 3,
      // SÓ preferências: nunca persistir projects/mycockpit/limitedAgents/ready/
      // activeProjectId — esses vêm do banco no boot.
      partialize: (s) => ({
        theme: s.theme,
        sidebarOpen: s.sidebarOpen,
        contextOpen: s.contextOpen,
        // O Office não é modo de boot (§6.1): rehidrata como "linear". O cast
        // mantém o tipo persistido na união completa (o migrate devolve AppState).
        viewMode: (s.viewMode === "office"
          ? "linear"
          : s.viewMode) as AppState["viewMode"],
        settings: s.settings,
      }),
      // v1→v2: quem já tinha estado persistido é usuário EXISTENTE (não 1ª
      // instalação) → não deve ver o wizard de onboarding. Marca onboarded=true.
      // Instalação nova (sem estado persistido) NÃO chama migrate → onboarded
      // fica no default false → wizard aparece.
      // v2→v3: o modo Fusion se dissolveu (F3) — quem tinha viewMode="fusion"
      // persistido volta pro Linear (não pode abrir num modo que não existe).
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as {
          settings?: Record<string, unknown>
          viewMode?: string
        }
        if (fromVersion < 2) {
          p.settings = { ...(p.settings ?? {}), onboarded: true }
        }
        if (fromVersion < 3 && p.viewMode === "fusion") {
          p.viewMode = "linear"
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
