import { CHAVE_APP } from "@/lib/chaveDoApp"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { migratePersistedApp, type ViewMode } from "@/store/appMigracao"
import { applyTheme, currentTheme, type Theme, type ThemePreference } from "@/lib/theme"
import type { PermissionMode, Project } from "@/lib/types"
import type { MainTab } from "@/lib/mainTabs"
import {
  type GlobalSettings,
  DEFAULT_SETTINGS,
  reconcileMissionPresets,
} from "@/lib/settings"
import {
  renameProject as dbRenameProject,
  setProjectColor as dbSetProjectColor,
  persistProjectOrder as dbPersistProjectOrder,
} from "@/lib/db"
import { moveByDelta, reorderByIds } from "@/lib/reorder"
import type {
  ContextPanelTab,
  ProjectConfig,
  TranscriptRevealRequest,
} from "@/store/appTypes"

export type {
  ContextPanelTab,
  ProjectConfig,
  TranscriptRevealRequest,
} from "@/store/appTypes"


/** Destinos históricos persistidos: a navegação visível mora em Geral, e
 * preservá-los mantém a última tela no boot (ADR-187). Os modos e a migração
 * moram em `appMigracao.ts`. */
export { VIEW_MODES, migratePersistedApp } from "@/store/appMigracao"
export type { ViewMode } from "@/store/appMigracao"

export interface AppState {
  projects: Project[]
  activeProjectId: string | null
  theme: Theme
  themePreference: ThemePreference
  setTheme: (preference: ThemePreference) => void
  sidebarOpen: boolean
  contextOpen: boolean
  /** Aba do painel direito. Efêmera, mas compartilhada porque o card de plano
   *  junto ao composer precisa saber quando a checklist já está aberta ali. */
  contextPanelTab: ContextPanelTab
  /** Superfície do centro: Painel (cross-projeto) ou Trabalho (chat Linear).
   *  Modos que saíram do produto migram para "linear" no persist. */
  viewMode: ViewMode
  /** A vista dentro de Trabalho (docs/abas-no-principal-plan.md), só o que está
   *  na tela agora. A tira de cada conversa mora em `store/abasDeArquivo.ts`,
   *  e trocar de conversa troca esta vista pela guardada nela (ADR-244). */
  mainTab: MainTab
  /** Pedido efêmero para revelar uma fonte do mapa no fio. O nonce permite
   *  repetir o gesto para o mesmo item sem depender de limpar estado. */
  transcriptReveal: TranscriptRevealRequest | null
  /** F7 — view GLOBAL "Agendado" aberta? Estado PRÓPRIO (não é um viewMode):
   *  quando true, ela cobre o conteúdo principal; qualquer navegação (trocar
   *  superfície/projeto) fecha. Não persiste. */
  scheduledOpen: boolean
  /** Editor global dos Planos de voo. Assim como Agendado, ocupa o centro sem
   *  fingir ser uma superfície de projeto e não persiste entre boots. */
  flightPlansOpen: boolean
  /** Rollup "Frota": tudo que está RODANDO agora, em qualquer projeto — o
   *  Fio Vivo é por sessão, isto é o cross-sessão. Mesma família de Agendado/
   *  Planos de voo: cobre o centro via estado próprio, não persiste. */
  fleetOpen: boolean
  /** A fila "Precisam de você" está expandida abaixo da faixa do chrome?
   *  (ADR-040) Não persiste: decisão pendente não se dispensa entre boots, e a
   *  faixa some sozinha quando a fila esvazia. */
  decisionsOpen: boolean
  ready: boolean
  /** Config por projeto vinda de .frota/config.toml (Fase 1). */
  projectConfigs: Record<string, ProjectConfig>
  /** Agents com limite de uso atingido (id → hint de reset), cross-conversa. */
  limitedAgents: Record<string, string | null>
  /** Contadores-gatilho dos launchers do composer (Launchpad pede, o
   *  CommandConsole — dono dos dialogs — abre ao ver mudar). */
  missionLaunchRequested: number
  fusionLaunchRequested: number
  /** P3 — Entrega→diff em 1 clique: intenção "abrir a conversa com o painel de
   *  Alterações já aberto" + o texto da entrega (vira o prefill de correção).
   *  Efêmera (não persiste); o ContextPanel consome quando a conversa bate. */
  deliveryDiff: { convId: string; text: string } | null
  /** Preferências globais (persistidas). */
  settings: GlobalSettings
  /** Modal de configurações aberto? */
  settingsOpen: boolean
  /** Seção pedida por quem abriu as Configurações (deep link do tray, da pill
   *  de uso, da paleta). String CRUA de propósito: quem resolve é o dialog,
   *  via resolveSection (id órfão cai numa seção válida). Efêmera: o dialog
   *  consome e limpa, senão a próxima abertura pularia pra cá de novo. */
  settingsSection: string | null
  /** Modal de adicionar projeto aberto? */
  addProjectOpen: boolean

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  setAddProjectOpen: (v: boolean) => void
  setActiveProject: (id: string | null) => void
  setProjectPermission: (id: string, mode: PermissionMode) => void
  /** Renomeia o projeto (store + persiste no banco). */
  renameProject: (id: string, name: string) => void
  /** Define/limpa (null) a cor-rótulo do projeto. */
  setProjectColor: (id: string, color: string | null) => void
  /** S1.2 — drag & drop: move o projeto `dragId` pra posição do `overId` e
   *  persiste a ordem manual (sort_order). */
  reorderProjects: (dragId: string, overId: string) => void
  /** S1.2 — teclado/context menu: move o projeto uma posição (cima/baixo). */
  moveProject: (id: string, delta: -1 | 1) => void
  setProjectConfig: (id: string, cfg: ProjectConfig) => void
  patchProjectConfig: (id: string, patch: Partial<ProjectConfig>) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleContext: () => void
  setContextPanelTab: (tab: ContextPanelTab) => void
  setViewMode: (m: ViewMode) => void
  /** Abre (ou refoca) a aba do diff, opcionalmente num arquivo ou commit. */
  openDiffTab: (focusPath?: string, commitHash?: string) => void
  /** Abre um arquivo real na aba principal, fora da coluna estreita. */
  openFileTab: (path: string) => void
  /** A aba Navegador está na tira da conversa ATIVA, mesmo sem estar à
   *  vista. Cada conversa guarda a sua (ADR-244, `store/abasDeArquivo.ts`). */
  navegadorAberto: boolean
  /** Abre o navegador do projeto ativo na aba principal. */
  openBrowserTab: () => void
  /** Põe o navegador na tira sem trocar a aba à vista. */
  showBrowserTab: () => void
  /** Fecha a aba do navegador (o Chromium do projeto segue como estava). */
  closeBrowserTab: () => void
  /** Volta pra conversa. A aba transitória deixa de existir. */
  closeMainTab: () => void
  revealTranscriptItem: (conversationId: string, itemId: string) => void
  /** Abre/fecha a visualização em split de ramos da conversa ativa. */
  branchSplitOpen: boolean
  toggleBranchSplit: () => void
  setBranchSplitOpen: (v: boolean) => void
  /** Abre/fecha a view global "Agendado" (F7). */
  setScheduledOpen: (v: boolean) => void
  /** Abre/fecha o workspace global de Planos de voo. */
  setFlightPlansOpen: (v: boolean) => void
  /** Abre/fecha o rollup global "Frota". */
  setFleetOpen: (v: boolean) => void
  /** Abre/fecha a fila de decisões pendentes da faixa do chrome. */
  setDecisionsOpen: (v: boolean) => void
  setReady: (v: boolean) => void
  setAgentLimited: (agent: string, resetHint: string | null) => void
  clearAgentLimited: (agent: string) => void
  /** Pedem a abertura dos launchers de missão/disputa no composer. */
  requestMissionLaunch: () => void
  requestFusionLaunch: () => void
  /** Pede a abertura do diff de uma entrega (aba Alterações + header de correção). */
  requestDeliveryDiff: (convId: string, text: string) => void
  clearDeliveryDiff: () => void
  /** Patch parcial das preferências globais. */
  setSettings: (patch: Partial<GlobalSettings>) => void
  /** Abre/fecha as Configurações. `section` (opcional) pede uma seção. */
  setSettingsOpen: (v: boolean, section?: string) => void
  /** Marca o pedido de seção como consumido. */
  clearSettingsSection: () => void
  /** Grava no ledger a resolução de modelo observada num evento `session` e
   *  devolve o `resolved` ANTERIOR do mesmo pedido (null = primeira vez).
   *  Dedup: a mesma resolução não regrava (o `at` marca a 1ª observação). */
  recordResolution: (
    agent: string,
    reqModel: string | null,
    resolved: string | null,
  ) => string | null
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      theme: "dark",
      themePreference: "dark",
      sidebarOpen: true,
      contextOpen: true,
      contextPanelTab: "conversa",
      viewMode: "linear",
      mainTab: { kind: "conversa" },
      navegadorAberto: false,
      transcriptReveal: null,
      branchSplitOpen: false,
      scheduledOpen: false,
      flightPlansOpen: false,
      fleetOpen: false,
      decisionsOpen: false,
      ready: false,
      projectConfigs: {},
      limitedAgents: {},
      missionLaunchRequested: 0,
      fusionLaunchRequested: 0,
      deliveryDiff: null,
      settings: DEFAULT_SETTINGS,
      settingsOpen: false,
      settingsSection: null,
      addProjectOpen: false,

      setProjects: (projects) =>
        set((s) => ({
          projects,
          activeProjectId: s.activeProjectId ?? projects[0]?.id ?? null,
        })),
      addProject: (p) =>
        set((s) => ({
          projects: [p, ...s.projects],
          activeProjectId: p.id,
          viewMode: "linear",
          scheduledOpen: false,
          flightPlansOpen: false,
          fleetOpen: false,
          mainTab: { kind: "conversa" },
        })),
      setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
      // trocar de projeto é navegação → fecha qualquer workspace global.
      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          viewMode: "linear",
          mainTab: { kind: "conversa" },
          branchSplitOpen: false,
          scheduledOpen: false,
          flightPlansOpen: false,
          fleetOpen: false,
        }),
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
      // S1.2 — a ordem exibida É a ordem persistida: no-op do helper (mesma
      // referência) não grava nem re-renderiza; mudança grava a lista inteira.
      reorderProjects: (dragId, overId) => {
        const next = reorderByIds(get().projects, dragId, overId)
        if (next === get().projects) return
        set({ projects: next })
        void dbPersistProjectOrder(next.map((p) => p.id))
      },
      moveProject: (id, delta) => {
        const next = moveByDelta(get().projects, id, delta)
        if (next === get().projects) return
        set({ projects: next })
        void dbPersistProjectOrder(next.map((p) => p.id))
      },
      setProjectConfig: (id, cfg) =>
        set((s) => ({ projectConfigs: { ...s.projectConfigs, [id]: cfg } })),
      patchProjectConfig: (id, patch) =>
        set((s) => {
          const cur = s.projectConfigs[id]
          if (!cur) return {}
          return { projectConfigs: { ...s.projectConfigs, [id]: { ...cur, ...patch } } }
        }),
      setTheme: (themePreference) => {
        const theme = currentTheme(themePreference)
        applyTheme(theme, themePreference)
        set({ theme, themePreference })
      },
      toggleTheme: () =>
        set((s) => {
          const theme: Theme = s.theme === "dark" ? "light" : "dark"
          applyTheme(theme)
          return { theme, themePreference: theme }
        }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setContextPanelTab: (contextPanelTab) => set({ contextPanelTab }),
      // o switcher não conhece os workspaces globais; trocar de superfície os fecha.
      setViewMode: (viewMode) =>
        set({
          viewMode,
          branchSplitOpen: viewMode === "linear" ? get().branchSplitOpen : false,
          scheduledOpen: false,
          flightPlansOpen: false,
          fleetOpen: false,
        }),
      // Cada pedido ganha um selo (`focusSeq`): pedir o mesmo arquivo de novo
      // tem que rolar até ele, mesmo com o `focusPath` igual.
      openDiffTab: (focusPath, commitHash) =>
        set((s) => ({
          branchSplitOpen: false,
          mainTab: {
            kind: "diff",
            focusPath,
            commitHash,
            focusSeq:
              (s.mainTab.kind === "diff" ? (s.mainTab.focusSeq ?? 0) : 0) + 1,
          },
        })),
      openFileTab: (path) =>
        set({ branchSplitOpen: false, mainTab: { kind: "arquivo", path } }),
      openBrowserTab: () =>
        set({ branchSplitOpen: false, navegadorAberto: true, mainTab: { kind: "navegador" } }),
      showBrowserTab: () => set({ navegadorAberto: true }),
      closeBrowserTab: () =>
        set((s) => ({
          navegadorAberto: false,
          mainTab: s.mainTab.kind === "navegador" ? { kind: "conversa" } : s.mainTab,
        })),
      closeMainTab: () => set({ mainTab: { kind: "conversa" } }),
      revealTranscriptItem: (conversationId, itemId) =>
        set((state) => ({
          mainTab: { kind: "conversa" },
          transcriptReveal: {
            conversationId,
            itemId,
            nonce: (state.transcriptReveal?.nonce ?? 0) + 1,
          },
        })),
      toggleBranchSplit: () =>
        set((s) => ({ branchSplitOpen: !s.branchSplitOpen })),
      setBranchSplitOpen: (branchSplitOpen) => set({ branchSplitOpen }),
      setScheduledOpen: (scheduledOpen) =>
        set({
          scheduledOpen,
          flightPlansOpen: scheduledOpen ? false : get().flightPlansOpen,
          fleetOpen: scheduledOpen ? false : get().fleetOpen,
        }),
      setFlightPlansOpen: (flightPlansOpen) =>
        set({
          flightPlansOpen,
          scheduledOpen: flightPlansOpen ? false : get().scheduledOpen,
          fleetOpen: flightPlansOpen ? false : get().fleetOpen,
        }),
      setFleetOpen: (fleetOpen) =>
        set({
          fleetOpen,
          scheduledOpen: fleetOpen ? false : get().scheduledOpen,
          flightPlansOpen: fleetOpen ? false : get().flightPlansOpen,
        }),
      // a faixa é chrome: expandir a fila NÃO troca de superfície nem fecha
      // workspace nenhum (ela existe por cima do que você já estava fazendo).
      setDecisionsOpen: (decisionsOpen) => set({ decisionsOpen }),
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
      requestMissionLaunch: () =>
        set((s) => ({ missionLaunchRequested: s.missionLaunchRequested + 1 })),
      requestFusionLaunch: () =>
        set((s) => ({ fusionLaunchRequested: s.fusionLaunchRequested + 1 })),
      requestDeliveryDiff: (convId, text) =>
        set({ deliveryDiff: { convId, text } }),
      clearDeliveryDiff: () => set({ deliveryDiff: null }),
      setSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      setSettingsOpen: (settingsOpen, section) =>
        set(section ? { settingsOpen, settingsSection: section } : { settingsOpen }),
      clearSettingsSection: () => set({ settingsSection: null }),
      recordResolution: (agent, reqModel, resolved) => {
        if (!resolved) return null
        const req = reqModel ?? "default"
        const prev =
          get().settings.observedResolutions[agent]?.[req]?.resolved ?? null
        if (prev !== resolved) {
          set((s) => ({
            settings: {
              ...s.settings,
              observedResolutions: {
                ...s.settings.observedResolutions,
                [agent]: {
                  ...(s.settings.observedResolutions[agent] ?? {}),
                  [req]: { resolved, at: Date.now() },
                },
              },
            },
          }))
        }
        return prev
      },
    }),
    {
      name: CHAVE_APP,
      version: 5,
      // SÓ preferências: nunca persistir projects/mycockpit/limitedAgents/ready/
      // activeProjectId — esses vêm do banco no boot.
      partialize: (s) => ({
        theme: s.theme,
        themePreference: s.themePreference,
        sidebarOpen: s.sidebarOpen,
        contextOpen: s.contextOpen,
        viewMode: s.viewMode,
        settings: s.settings,
      }),
      // Regras versão a versão documentadas na própria migratePersistedApp
      // (pura, exportada, coberta em app.migrate.test.ts).
      migrate: migratePersistedApp,
      // deep-merge de settings p/ campos novos ganharem o default (evita undefined
      // quando o schema cresce entre versões).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        const persistedSettings = (p.settings ?? {}) as Partial<GlobalSettings>
        return {
          ...current,
          ...p,
          themePreference: p.themePreference ?? p.theme ?? "dark",
          settings: {
            ...current.settings,
            ...persistedSettings,
            userProfile: {
              ...current.settings.userProfile,
              ...persistedSettings.userProfile,
            },
            userPreferences: {
              ...current.settings.userPreferences,
              ...persistedSettings.userPreferences,
            },
            helperFeatures: {
              ...current.settings.helperFeatures,
              ...persistedSettings.helperFeatures,
            },
            utilityInference: {
              ...current.settings.utilityInference,
              ...persistedSettings.utilityInference,
              tasks: {
                ...current.settings.utilityInference.tasks,
                ...persistedSettings.utilityInference?.tasks,
              },
            },
            missionPresets: reconcileMissionPresets(
              persistedSettings.missionPresets,
            ),
          },
        }
      },
      // DOM ↔ estado ao reidratar (o pre-mount do main.tsx já evitou o flash).
      onRehydrateStorage: () => (state) => {
        if (state) state.setTheme(state.themePreference)
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
