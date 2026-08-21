import { create } from "zustand"
import { persist } from "zustand/middleware"
import { emit } from "@tauri-apps/api/event"
import type { PermissionMode, Project } from "@/lib/types"
import type { MainTab } from "@/lib/mainTabs"
import { type GlobalSettings, DEFAULT_SETTINGS } from "@/lib/settings"
import {
  isTauri,
  renameProject as dbRenameProject,
  setProjectColor as dbSetProjectColor,
  persistProjectOrder as dbPersistProjectOrder,
} from "@/lib/db"
import { moveByDelta, reorderByIds } from "@/lib/reorder"

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
   *  Linear) ou Features (SDD). A disputa Fusion vive dentro da conversa via
   *  ⚔️ do composer, não é um modo. Valores persistidos de modos que já
   *  saíram do produto ("fusion", "office") migram para "linear" no persist
   *  (v3/v4) — nunca abrimos num modo que não existe. */
  viewMode: "painel" | "linear" | "sdd"
  /** Aba aberta DENTRO da superfície Trabalho (docs/abas-no-principal-plan.md).
   *  União discriminada, igual à do Paseo, porque ela aguenta ganhar variante
   *  (terminal, arquivo, PR) sem retrabalho — mas hoje são DUAS e só.
   *
   *  NÃO persiste, de propósito: reabrir o app numa tela de diff que você não
   *  lembra de ter aberto é pior que reabrir na conversa. Aba é gesto da
   *  sessão, não preferência. */
  mainTab: MainTab
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
  /** Seção pedida por quem abriu as Configurações (deep link do tray, da pill
   *  de uso, da paleta). String CRUA de propósito: quem resolve é o dialog,
   *  via resolveSection (id órfão cai numa seção válida). Efêmera: o dialog
   *  consome e limpa, senão a próxima abertura pularia pra cá de novo. */
  settingsSection: string | null

  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
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
  setMycockpit: (id: string, cfg: ProjectConfig) => void
  patchMycockpit: (id: string, patch: Partial<ProjectConfig>) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  toggleContext: () => void
  setViewMode: (m: "painel" | "linear" | "sdd") => void
  /** Abre (ou refoca) a aba do diff, opcionalmente já num arquivo. */
  openDiffTab: (focusPath?: string) => void
  /** Volta pra conversa. A aba do diff deixa de existir, não fica escondida. */
  closeDiffTab: () => void
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

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
  // O popover da tray é OUTRO contexto JS (webview próprio) e só lê o tema no
  // boot — sem este broadcast ele ficaria no tema antigo até reiniciar o app.
  if (isTauri()) void emit("app://theme", theme).catch(() => {})
}

/** Migração PURA do estado persistido (mc.app) — exportada p/ teste porque o
 *  risco dela é o pior tipo: viewMode órfão persistido = boot num modo que não
 *  existe (tela branca) pra TODO usuário existente.
 *  - v<2: estado persistido = usuário existente → onboarded=true (instalação
 *    nova não passa por migrate → wizard aparece).
 *  - v<3: modo Fusion dissolvido (F3) → "fusion" vira "linear".
 *  - v<4: Escritório removido (office-removal-plan R2) → "office" e QUALQUER
 *    valor fora da união atual caem em "linear" (Trabalho), nunca tela branca. */
export function migratePersistedApp(
  persisted: unknown,
  fromVersion: number,
): AppState {
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
  if (
    fromVersion < 4 &&
    p.viewMode != null &&
    !["painel", "linear", "sdd"].includes(p.viewMode)
  ) {
    p.viewMode = "linear"
  }
  return p as unknown as AppState
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      theme: "dark",
      sidebarOpen: true,
      contextOpen: true,
      viewMode: "linear",
      mainTab: { kind: "conversa" },
      scheduledOpen: false,
      flightPlansOpen: false,
      fleetOpen: false,
      decisionsOpen: false,
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
      settingsSection: null,

      setProjects: (projects) =>
        set((s) => ({
          projects,
          activeProjectId: s.activeProjectId ?? projects[0]?.id ?? null,
        })),
      addProject: (p) =>
        set((s) => ({ projects: [p, ...s.projects], activeProjectId: p.id })),
      // trocar de projeto é navegação → fecha qualquer workspace global.
      setActiveProject: (id) =>
        set({
          activeProjectId: id,
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
      // o switcher não conhece os workspaces globais; trocar de superfície os fecha.
      setViewMode: (viewMode) =>
        set({ viewMode, scheduledOpen: false, flightPlansOpen: false, fleetOpen: false }),
      // Cada pedido ganha um selo próprio (`focusSeq`). Sem ele, clicar DE
      // NOVO no mesmo arquivo era no-op: o efeito que rola até ele depende do
      // `focusPath`, a string não mudava, e quem tinha rolado pra longe não
      // voltava. Pedir a mesma coisa duas vezes é pedido, não repetição.
      openDiffTab: (focusPath) =>
        set((s) => ({
          mainTab: {
            kind: "diff",
            focusPath,
            focusSeq:
              (s.mainTab.kind === "diff" ? (s.mainTab.focusSeq ?? 0) : 0) + 1,
          },
        })),
      closeDiffTab: () => set({ mainTab: { kind: "conversa" } }),
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
      name: "mc.app",
      version: 4,
      // SÓ preferências: nunca persistir projects/mycockpit/limitedAgents/ready/
      // activeProjectId — esses vêm do banco no boot.
      partialize: (s) => ({
        theme: s.theme,
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
