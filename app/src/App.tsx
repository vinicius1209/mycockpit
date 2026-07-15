import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { toast } from "sonner"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { TitleBar } from "@/components/layout/TitleBar"
import { Sidebar } from "@/components/layout/Sidebar"
import { ContextPanel } from "@/components/layout/ContextPanel"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SddView } from "@/components/sdd/SddView"
import { MissionControl } from "@/components/panel/MissionControl"
import { ScheduledView } from "@/components/scheduled/ScheduledView"
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
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useNotifs } from "@/store/notifications"
import { useSchedules } from "@/store/schedules"
import { tickSchedules } from "@/lib/scheduleEngine"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
import { buildTrayStatus, updateTray } from "@/lib/tray"
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
import { refreshCatalogIntoSettings } from "@/lib/catalog"
import { runModelCurator, reloadActiveProposals } from "@/lib/modelCurator"
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
  const scheduledOpen = useApp((s) => s.scheduledOpen)
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

  // Verificador de update dos agents: a DETECÇÃO roda em TODO boot (probes
  // locais + latest, tudo paralelo e best-effort — o snapshot persistido nunca
  // fica mentindo depois de um `npm i -g`/`brew upgrade` feito fora do app; foi
  // um bug real: badges de update pra versões já instaladas). O que fica no
  // gate diário é só o trabalho de rede não-essencial (catálogo de preços +
  // curador semanal); a NOTIFICAÇÃO continua com dedupe por versão.
  useEffect(() => {
    if (!isTauri()) return
    // modelos reais do `agy models` → cache dinâmico (barato, todo boot).
    void refreshAgyModels()
    // modelos aprovados do curador → cache do picker (barato, todo boot).
    void reloadActiveProposals()
    const last = useApp.getState().settings.lastUpdateCheck ?? 0
    if (Date.now() - last >= UPDATE_CHECK_INTERVAL_MS) {
      // Camada A: refresh do catálogo de preços (models.dev) — best-effort
      // (rede falhou = silêncio). Depois, o curador semanal (self-gated em
      // lastCuratorRun; nunca roda com o helper global desligado).
      void (async () => {
        await refreshCatalogIntoSettings()
        await runModelCurator()
      })()
    }
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

  // F6 — motor das automações agendadas: tick IMEDIATO no boot (que também faz
  // o catch-up explícito dos perdidos >5min) + a cada 60s. O reload após cada
  // tick mantém o espelho (badge da sidebar / view / tray) fresco. Só no Tauri.
  useEffect(() => {
    if (!isTauri()) return
    const run = () => {
      void tickSchedules()
        .catch(() => {})
        .finally(() => {
          void useSchedules.getState().reload()
        })
    }
    run()
    const t = setInterval(run, 60_000)
    return () => clearInterval(t)
  }, [])

  // Tray (frente paralela no Rust): status da frota + próxima agendada, best-
  // effort (o comando pode não existir). Selectors devolvem PRIMITIVOS (contagens
  // /números) — só mudam em transição de estado, nunca a cada delta de stream.
  const runningConvs = useChat((s) => {
    let n = 0
    for (const c of Object.values(s.byId)) if (c.running) n++
    return n
  })
  const missionsRunning = useMission((s) => {
    let n = 0
    for (const m of Object.values(s.byConv)) if (m.status === "running") n++
    return n
  })
  const fusionsLive = useFusion((s) => {
    let n = 0
    for (const f of Object.values(s.byConv))
      if (
        f.phase === "running" ||
        f.phase === "judging" ||
        f.phase === "promoting"
      )
        n++
    return n
  })
  const decisionsPending = useFusion((s) => {
    let n = 0
    for (const f of Object.values(s.byConv)) if (f.phase === "deciding") n++
    return n
  })
  const nextSchedName = useSchedules(
    (s) => nextScheduled(s.schedules)?.name ?? null,
  )
  const nextSchedAt = useSchedules(
    (s) => nextScheduled(s.schedules)?.nextRun ?? null,
  )
  useEffect(() => {
    if (!isTauri()) return
    const send = () => {
      const running = runningConvs + missionsRunning + fusionsLive
      const next =
        nextSchedAt != null && nextSchedName
          ? `⏰ ${nextSchedName} · ${fmtUntilShort(nextSchedAt - Date.now())}`
          : null
      updateTray(buildTrayStatus(running, decisionsPending), next)
    }
    send()
    // re-envio de minuto: o "· 2h" da próxima agendada não pode mofar
    // (updateTray dedupa — só invoca quando a string muda de verdade).
    const t = setInterval(send, 60_000)
    return () => clearInterval(t)
  }, [runningConvs, missionsRunning, fusionsLive, decisionsPending, nextSchedName, nextSchedAt])

  // Tray → "Nova tarefa": foca o composer da conversa ativa (garante a
  // superfície Trabalho antes). Best-effort: fora do Tauri/sem tray, nada.
  useEffect(() => {
    if (!isTauri()) return
    let un: UnlistenFn | null = null
    let disposed = false
    listen("tray://new-task", () => {
      const app = useApp.getState()
      app.setScheduledOpen(false)
      app.setViewMode("linear")
      // espera o ChatPanel montar/renderizar antes de focar.
      setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>('textarea[data-composer="console"]')
          ?.focus()
      }, 120)
    })
      .then((u) => {
        if (disposed) u()
        else un = u
      })
      .catch(() => {})
    return () => {
      disposed = true
      un?.()
    }
  }, [])

  // MyCockpit resume: o motor avisa quando o resume NATIVO falhou e o run
  // reiniciou fresh. Sempre zera a sessão morta da conversa (o novo run emite
  // `session` e grava a nova). Se degradou COM a memória do cockpit
  // (used_memory), marca o aviso na conversa + toast; sem fallback (ex. turno 1)
  // não há o que avisar. Listener global: cobre runs em background também.
  useEffect(() => {
    if (!isTauri()) return
    let un: UnlistenFn | null = null
    let disposed = false
    listen<{ conv_id: string; run_id: string; used_memory: boolean }>(
      "resume://fallback",
      (e) => {
        const { conv_id, used_memory } = e.payload
        const chat = useChat.getState()
        if (!chat.byId[conv_id]) return
        chat.clearSession(conv_id)
        if (!used_memory) return
        chat.handleEvent(conv_id, {
          type: "notice",
          message:
            "Sessão nativa expirou — conversa retomada pela memória do MyCockpit",
        })
        toast("Sessão nativa expirou — conversa retomada pela memória do MyCockpit")
      },
    )
      .then((u) => {
        if (disposed) u()
        else un = u
      })
      .catch(() => {})
    return () => {
      disposed = true
      un?.()
    }
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
                      {/* F7: a view global "Agendado" cobre o conteúdo via
                          estado próprio — o switcher de superfícies fica como está. */}
                      {scheduledOpen ? (
                        <ScheduledView />
                      ) : viewMode === "painel" ? (
                        <MissionControl />
                      ) : viewMode === "sdd" ? (
                        <SddView />
                      ) : (
                        <ChatPanel />
                      )}
                    </ResizablePanel>
                    {contextOpen && viewMode === "linear" && !scheduledOpen && (
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
