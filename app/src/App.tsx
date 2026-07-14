import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { TitleBar } from "@/components/layout/TitleBar"
import { Sidebar } from "@/components/layout/Sidebar"
import { ContextPanel } from "@/components/layout/ContextPanel"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SddView } from "@/components/sdd/SddView"
import { MissionControl } from "@/components/panel/MissionControl"
import { CommandMenu } from "@/components/common/CommandMenu"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { ConfirmHost } from "@/components/common/confirm"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { addProjectViaDialog } from "@/lib/projects"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useApp } from "@/store/app"
import type { ProjectConfig } from "@/store/app"
import { useNotifs } from "@/store/notifications"
import {
  isTauri,
  listProjects,
  insertProject,
  updateProjectPermission,
} from "@/lib/db"
import { readMycockpitConfig } from "@/lib/mycockpit"
import {
  detectAgents,
  toProbeMap,
  updateAvailable,
  refreshAgyModels,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import { agentDef } from "@/lib/agents"
import type { PermissionMode, Project } from "@/lib/types"

/** Intervalo mínimo entre checagens de update dos agents (1x/dia). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const queryClient = new QueryClient()

// Seed do 1º run: projetos reais como exemplo. Persistem no SQLite a partir daí.
const SEED: Project[] = [
  {
    id: "seed-prime",
    name: "prime-sales-hub",
    path: "/Users/viniciusmachado/projetos/prime/prime-sales-hub",
    createdAt: 3,
    hasClaudeMd: true,
    hasAgentsMd: true,
    status: "idle",
  },
  {
    id: "seed-warp",
    name: "warp",
    path: "/Users/viniciusmachado/projetos/warp",
    createdAt: 2,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  },
  {
    id: "seed-studio",
    name: "vinimachado-studio",
    path: "/Users/viniciusmachado/projetos/pessoais/vinimachado-studio",
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: true,
    status: "idle",
  },
]

export default function App() {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const contextOpen = useApp((s) => s.contextOpen)
  const viewMode = useApp((s) => s.viewMode)
  const setProjects = useApp((s) => s.setProjects)
  const setReady = useApp((s) => s.setReady)
  const theme = useApp((s) => s.theme)
  const onboarded = useApp((s) => s.settings.onboarded)
  const activeProjectId = useApp((s) => s.activeProjectId)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Em `vite dev` (browser) não há Tauri → seed em memória.
      if (!isTauri()) {
        if (!cancelled) setProjects(SEED)
        return
      }
      const existing = await listProjects()
      if (cancelled) return
      if (existing && existing.length > 0) {
        setProjects(existing)
      } else if (import.meta.env.DEV) {
        // DEV only: semeia projetos de exemplo por conveniência local. NUNCA no
        // build distribuído — install novo do amigo começa VAZIO (nada fixo do
        // ambiente de quem desenvolveu). O onboarding (docs/onboarding.md) guia
        // a adição do 1º projeto real.
        for (const p of SEED) await insertProject(p)
        const seeded = await listProjects()
        if (!cancelled) setProjects(seeded ?? [])
      } else {
        if (!cancelled) setProjects([])
      }
    }
    load()
      .catch((e) => {
        console.error("Falha ao carregar projetos:", e)
        if (!cancelled) setProjects(import.meta.env.DEV ? SEED : [])
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [setProjects, setReady])

  // Verificador de update dos agents (1x/dia no boot): re-detecta versões
  // (instalada + latest do canal oficial), persiste o snapshot e notifica UMA
  // vez por versão nova (dedupe em lastNotifiedVersions). No mesmo boot,
  // atualiza os modelos dinâmicos do agy (falha → lista estática continua).
  useEffect(() => {
    if (!isTauri()) return
    // modelos reais do `agy models` → cache dinâmico (barato, todo boot).
    void refreshAgyModels()
    const last = useApp.getState().settings.lastUpdateCheck ?? 0
    if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return
    void (async () => {
      const tools = await detectAgents()
      const now = Date.now()
      if (tools.length === 0) {
        // detecção falhou/vazia: marca a tentativa (não martela a cada boot).
        useApp.getState().setSettings({ lastUpdateCheck: now })
        return
      }
      useApp.getState().setSettings({
        detected: toProbeMap(tools, now),
        lastUpdateCheck: now,
      })
      const notified = {
        ...useApp.getState().settings.lastNotifiedVersions,
      }
      let changed = false
      for (const t of tools) {
        // só os code agents (git/swiftc ficam fora do aviso de update).
        if (!(t.id in UPDATE_COMMANDS)) continue
        if (!t.latest || !updateAvailable(t)) continue
        if (notified[t.id] === t.latest) continue // já avisado desta versão
        const label = agentDef(t.id)?.label ?? t.id
        const cmd = UPDATE_COMMANDS[t.id]
        useNotifs.getState().push({
          kind: "run_done",
          title: `Atualização disponível: ${label} ${t.latest}`,
          subtitle: cmd ?? `instalado ${t.version ?? "?"} → ${t.latest}`,
          projectId: useApp.getState().activeProjectId ?? "",
        })
        notified[t.id] = t.latest
        changed = true
      }
      if (changed)
        useApp.getState().setSettings({ lastNotifiedVersions: notified })
    })()
  }, [])

  // Fase 1, carrega a config do projeto ativo de .mycockpit/config.toml (truth)
  // e sincroniza o cache de permissão que o run_claude lê.
  useEffect(() => {
    if (!activeProjectId || !isTauri()) return
    const proj = useApp.getState().projects.find((p) => p.id === activeProjectId)
    if (!proj) return
    void readMycockpitConfig(proj.path)
      .then((raw) => {
        const resolved: ProjectConfig = {
          exists: raw.exists,
          permission:
            (raw.permission as PermissionMode) ??
            proj.permissionMode ??
            "padrao",
          helper:
            raw.helper === "off"
              ? null
              : (raw.helper ?? useApp.getState().settings.helperModel),
          mode: raw.mode ?? "linear",
          extraDirs: raw.extra_dirs ?? [],
        }
        useApp.getState().setMycockpit(proj.id, resolved)
        if (raw.exists && resolved.permission !== proj.permissionMode) {
          useApp.getState().setProjectPermission(proj.id, resolved.permission)
          void updateProjectPermission(proj.id, resolved.permission)
        }
      })
      .catch((e) =>
        console.warn("[mycockpit] falha ao ler config.toml:", e),
      )
  }, [activeProjectId])

  async function handleAddProject() {
    await addProjectViaDialog()
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div className="grain flex h-screen w-screen flex-col overflow-hidden bg-rail text-foreground">
          <TitleBar />
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            {sidebarOpen && (
              <>
                <ResizablePanel
                  id="sidebar"
                  defaultSize="19%"
                  minSize="190px"
                  maxSize="32%"
                >
                  <Sidebar onAddProject={handleAddProject} />
                </ResizablePanel>
                <ResizableHandle className="bg-transparent transition-colors after:w-4 data-[resize-handle-state=hover]:bg-border/50 data-[resize-handle-state=drag]:bg-border/70" />
              </>
            )}
            {/* Conteúdo principal como "card inset" flutuando no rail. */}
            <ResizablePanel id="main" defaultSize="81%" minSize="40%">
              <div className="relative h-full py-2 pr-2 pl-1">
                <div className="flex h-full overflow-hidden rounded-xl border bg-background shadow-[var(--shadow-pop)]">
                  <ResizablePanelGroup
                    orientation="horizontal"
                    className="h-full"
                  >
                    <ResizablePanel id="chat" defaultSize="70%" minSize="42%">
                      {viewMode === "painel" ? (
                        <MissionControl />
                      ) : viewMode === "sdd" ? (
                        <SddView />
                      ) : (
                        <ChatPanel />
                      )}
                    </ResizablePanel>
                    {contextOpen && viewMode === "linear" && (
                      <>
                        <ResizableHandle className="bg-border/40 transition-colors after:w-3 data-[resize-handle-state=hover]:bg-brass/50 data-[resize-handle-state=drag]:bg-brass/60" />
                        <ResizablePanel
                          id="context"
                          defaultSize="30%"
                          minSize="240px"
                          maxSize="42%"
                        >
                          <ContextPanel />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
                {/* Toaster ancorado ao CONTEÚDO (centra no card, não na janela). O
                    wrapper com transform vira containing-block SÓ pro toaster; o
                    pointer-events-none não bloqueia o card (sonner re-habilita o clique). */}
                <div className="pointer-events-none absolute inset-0 z-[120] [transform:translate(0)]">
                  <Toaster position="bottom-center" theme={theme} />
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <CommandMenu />
        <SettingsDialog />
        <ConfirmHost />
        {/* Onboarding: overlay full-screen no 1º run (onboarded=false). O boot
            de projetos segue por baixo; finish grava onboarded=true. */}
        {!onboarded && <OnboardingWizard />}
      </TooltipProvider>
    </QueryClientProvider>
  )
}
