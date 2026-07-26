import { lazy, Suspense, useEffect, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
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
import { GlobalInteractionHost } from "@/components/common/GlobalInteractionHost"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { ConfirmHost } from "@/components/common/confirm"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { addProjectViaDialog } from "@/lib/projects"
import { startDictationHotkey } from "@/lib/dictationHotkey"
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
// Side-effect: registra os listeners globais de interação (interaction://
// request/resolved) no BOOT — approvals disparados antes da 1ª visita ao
// office já entram na fila única (store) que host e derive compartilham.
import {
  currentOriginAnyKind,
  useInteractions,
} from "@/store/interactions"
// Side-effect: hidrata o board de cards (E1) no BOOT — o Painel abre com os
// cards prontos e o vigia do Sprint 2 nunca varre um store vazio.
import "@/store/cards"
// Side-effect: liga a ponte do Companion Web (push de estado coalescido +
// executor de companion://action) no boot — no-op fora do Tauri.
import "@/lib/companion"
import { useSchedules } from "@/store/schedules"
import { tickSchedules } from "@/lib/scheduleEngine"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
import {
  setTrayPreferences,
  updateTray,
  type TrayAction,
  type TrayActivity,
} from "@/lib/tray"
import { nativeNotify } from "@/lib/notify"
import { startTurnWatchdog } from "@/lib/watchdog"
import { agentLabel, cancelAgent } from "@/lib/agent"
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
import { cn } from "@/lib/utils"

/** Intervalo mínimo entre checagens de update dos agents (1x/dia). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const queryClient = new QueryClient()

// Agent Office (O1): lazy — o chunk (Pixi incluso) só baixa na 1ª visita ao
// modo; depois fica montado com `hidden` (loop parado) como Painel/Trabalho.
const OfficeMode = lazy(() => import("@/office/ui/OfficeMode"))

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
  const keepInTrayOnClose = useApp((s) => s.settings.keepInTrayOnClose)
  const trayCloseHintShown = useApp((s) => s.settings.trayCloseHintShown)
  const activeProjectId = useApp((s) => s.activeProjectId)

  // Office: monta LAZY na 1ª visita e nunca desmonta (padrão Painel/Trabalho —
  // remontar destruiria o mundo/canvas); ao sair fica hidden + loop parado.
  const [officeVisited, setOfficeVisited] = useState(false)
  useEffect(() => {
    if (viewMode === "office") setOfficeVisited(true)
  }, [viewMode])

  // Atalho de ditado (estilo Wispr): tap alterna, hold é push-to-talk. O combo
  // vem de settings.dictationHotkey (lido por evento — trocar vale na hora;
  // null = desativado). O alvo é o registro fino de lib/dictationHotkey
  // (MicButton/docks do office); não dispara com modal aberto (⌘K e afins:
  // dialog Radix com data-state=open) e respeita o MESMO gate do MicButton
  // (settings.dictationEnabled).
  useEffect(
    () =>
      startDictationHotkey({
        combo: () => useApp.getState().settings.dictationHotkey,
        enabled: () => useApp.getState().settings.dictationEnabled,
        blocked: () =>
          !!document.querySelector('[role="dialog"][data-state="open"]'),
        onNoTarget: () => toast("Abra uma conversa para ditar"),
      }),
    [],
  )

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

  // P2 — vigia de turno mudo: avisa quando um turno running fica sem produzir.
  useEffect(() => startTurnWatchdog(), [])

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
  // Pedidos bloqueantes (permissão/pergunta) entram na contagem de "decisões" da
  // tray: é o sinal que alcança você com a janela fechada, sem depender do SO.
  // Primitivo no seletor ⇒ estável durante o streaming.
  const pendingInteractions = useInteractions((s) => s.queue.length)
  // Chaves semânticas: mudam quando a etapa exibida na telemetria muda, mas
  // permanecem estáveis durante deltas de texto do streaming.
  const chatTrayKey = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id, c]) => {
        const last = c.items[c.items.length - 1]
        const tool = last?.kind === "tool" ? last.name : ""
        return `${id}:${last?.kind ?? "idle"}:${tool}:${c.streamingTextId ?? ""}`
      })
      .sort()
      .join("|"),
  )
  const missionTrayKey = useMission((s) =>
    Object.entries(s.byConv)
      .filter(([, m]) => m.status === "running")
      .map(([id, m]) => `${id}:${m.current}:${m.phases[m.current]?.status ?? ""}`)
      .sort()
      .join("|"),
  )
  const fusionTrayKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => ["running", "judging", "promoting"].includes(f.phase))
      .map(
        ([id, f]) =>
          `${id}:${f.phase}:${f.candidates.map((c) => c.status).join(",")}`,
      )
      .sort()
      .join("|"),
  )
  const schedules = useSchedules((s) => s.schedules)
  useEffect(() => {
    if (!isTauri()) return
    const send = () => {
      const app = useApp.getState()
      const chat = useChat.getState()
      const missions = useMission.getState()
      const fusions = useFusion.getState()
      const scheduleState = useSchedules.getState()
      const projectName = new Map(app.projects.map((p) => [p.id, p.name]))
      const titleOf = (convId: string, projectId: string) =>
        chat.conversationsByProject[projectId]?.find((c) => c.id === convId)
          ?.title ?? "Conversa"
      const activities = new Map<string, TrayActivity>()
      const linearDetail = (convId: string): string => {
        const c = chat.byId[convId]
        const last = c?.items[c.items.length - 1]
        if (last?.kind === "tool") {
          const known: Record<string, string> = {
            Bash: "Executando comando…",
            Read: "Lendo arquivo…",
            Edit: "Editando arquivos…",
            Write: "Escrevendo arquivo…",
            Glob: "Mapeando o projeto…",
            Grep: "Buscando no projeto…",
            WebSearch: "Pesquisando na web…",
          }
          return known[last.name] ?? `Usando ${last.name}…`
        }
        if (c?.streamingTextId || last?.kind === "text") return "Redigindo resposta…"
        return "Analisando a tarefa…"
      }
      const push = (
        convId: string,
        kind: TrayActivity["kind"],
        title?: string | null,
        startedAt?: number | null,
        agent = "",
        model: string | null = null,
        detail = "Em operação…",
      ) => {
        // Conversa deletada com missão/disputa ainda viva: NÃO some do
        // snapshot — sumir subcontaria `running` e o "Sair" mataria o trabalho
        // sem confirmação. Sem projectId a navegação vira no-op, mas a
        // atividade continua visível, contada e parável.
        const projectId = chat.byId[convId]?.projectId ?? ""
        activities.set(convId, {
          convId,
          projectId,
          title: title || titleOf(convId, projectId),
          projectName: projectName.get(projectId) ?? "Projeto",
          kind,
          startedAt: startedAt ?? null,
          agent,
          model,
          detail,
        })
      }
      for (const [id, c] of Object.entries(chat.byId))
        if (c.running)
          push(
            id,
            "turno",
            null,
            c.startedAt,
            agentLabel(c.agent),
            c.model ?? c.reqModel,
            linearDetail(id),
          )
      for (const [id, m] of Object.entries(missions.byConv)) {
        if (m.status !== "running") continue
        const phase = m.phases[m.current]
        push(
          id,
          "missão",
          m.task,
          phase?.startedAt ?? m.startedAt,
          phase ? agentLabel(phase.def.agent) : "Mission",
          phase?.def.model ?? null,
          phase ? `${phase.def.label}…` : "Preparando próxima etapa…",
        )
      }
      for (const [id, f] of Object.entries(fusions.byConv)) {
        if (!["running", "judging", "promoting"].includes(f.phase)) continue
        const live = f.candidates.filter((c) =>
          ["queued", "running", "finalizing"].includes(c.status),
        )
        const detail =
          f.phase === "judging"
            ? "Juiz avaliando os candidatos…"
            : f.phase === "promoting"
              ? "Promovendo a resposta escolhida…"
              : `${live.length} ${live.length === 1 ? "agent trabalhando" : "agents trabalhando"}…`
        push(
          id,
          "disputa",
          f.prompt,
          Math.min(...live.map((c) => c.startedAt ?? f.createdAt), f.createdAt),
          live.length === 1 ? agentLabel(live[0].agent) : `${live.length} agents`,
          live.length === 1 ? (live[0].model ?? live[0].reqModel) : null,
          detail,
        )
      }

      const decision = Object.entries(fusions.byConv).find(
        ([, f]) => f.phase === "deciding",
      )
      // Interação pendente (permissão/pergunta) TAMBÉM é decisão esperando você.
      // Sem isto a tray ficava cega justo no caso em que o app está em
      // background — e a notificação nativa não pode ser o único sinal: ela
      // depende de autorização do SO que builds ad-hoc não conseguem (ver
      // nativeNotify em lib/notify.ts). A tray sempre funciona.
      const pending = useInteractions.getState().queue
      const decisionConvId =
        decision?.[0] ??
        (pending.length > 0
          ? (currentOriginAnyKind(pending[0])?.convId ?? null)
          : null)
      const decisionProjectId = decisionConvId
        ? (chat.byId[decisionConvId]?.projectId ?? null)
        : null
      const next = nextScheduled(scheduleState.schedules)
      const last = [...scheduleState.schedules]
        .filter((s) => s.lastRunAt != null)
        .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))[0]

      updateTray({
        running: activities.size,
        decisions: decisionsPending + pendingInteractions,
        activities: [...activities.values()].slice(0, 3),
        decisionConvId,
        decisionProjectId,
        nextSchedule:
          next?.nextRun != null
            ? {
                name: next.name,
                at: next.nextRun,
                relative: fmtUntilShort(next.nextRun - Date.now()),
              }
            : null,
        lastRun:
          last?.lastRunAt != null && last.lastRunStatus
            ? {
                name: last.name,
                status: last.lastRunStatus,
                at: last.lastRunAt,
              }
            : null,
        enabledSchedules: scheduleState.schedules.filter((s) => s.enabled)
          .length,
      })
    }
    send()
    // re-envio de minuto: o "· 2h" da próxima agendada não pode mofar
    // (updateTray dedupa — só invoca quando a string muda de verdade).
    const t = setInterval(send, 60_000)
    return () => clearInterval(t)
  }, [
    runningConvs,
    missionsRunning,
    fusionsLive,
    decisionsPending,
    pendingInteractions,
    chatTrayKey,
    missionTrayKey,
    fusionTrayKey,
    schedules,
  ])

  // Preferências persistidas do ciclo de vida → backend (que recebe o evento
  // de fechar antes do React e, portanto, não pode consultar localStorage).
  useEffect(() => {
    setTrayPreferences(keepInTrayOnClose, trayCloseHintShown)
  }, [keepInTrayOnClose, trayCloseHintShown])

  // Ações do menu/popover chegam por um único canal e já abrem a janela. Cada
  // ação navega até o objeto, sem deixar o usuário procurar novamente.
  useEffect(() => {
    if (!isTauri()) return
    const unlisteners: UnlistenFn[] = []
    let disposed = false
    const focusComposer = () =>
      setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>('textarea[data-composer="console"]')
          ?.focus()
      }, 140)
    const openConversation = async (projectId?: string | null, convId?: string | null) => {
      if (!projectId || !convId) return
      const app = useApp.getState()
      app.setActiveProject(projectId)
      await useChat.getState().openProject(projectId)
      await useChat.getState().switchConversation(convId)
      app.setViewMode("linear")
    }
    // Ações de FUNDO (stop/pause) chegam com a janela principal escondida — um
    // toast nela é invisível; notificação nativa cobre esse caso.
    const feedback = async (message: string) => {
      const visible = await getCurrentWindow()
        .isVisible()
        .catch(() => true)
      if (visible) toast(message)
      else void nativeNotify("Frota", message)
    }
    listen<TrayAction>("tray://action", async ({ payload }) => {
      const app = useApp.getState()
      if (payload.action === "new-task") {
        const projectId = app.activeProjectId ?? app.projects[0]?.id
        if (!projectId) {
          toast("Adicione um projeto antes de criar uma tarefa")
          return
        }
        app.setActiveProject(projectId)
        // Clique repetido (o popover some no blur e parece que falhou) não
        // pode empilhar conversas vazias no banco: reusa a ativa se vazia.
        const chat = useChat.getState()
        const active = chat.activeId ? chat.byId[chat.activeId] : null
        const activeEmpty =
          active?.projectId === projectId &&
          active.items.length === 0 &&
          !active.running
        if (!activeEmpty) await chat.newConversation(projectId)
        app.setViewMode("linear")
        focusComposer()
      } else if (
        payload.action === "review-decision" ||
        payload.action === "open-activity"
      ) {
        await openConversation(payload.projectId, payload.convId)
      } else if (payload.action === "stop-activity" && payload.convId) {
        const convId = payload.convId
        const mission = useMission.getState().byConv[convId]
        const fusion = useFusion.getState().byConv[convId]
        if (mission?.status === "running") {
          useMission.getState().abort(convId)
          void feedback("Missão interrompida")
        } else if (
          fusion &&
          (fusion.phase === "running" || fusion.phase === "judging")
        ) {
          useFusion.getState().abort(convId)
          void feedback("Disputa interrompida")
        } else if (fusion?.phase === "promoting") {
          // Promoção é one-shot (abort no-opa): não finge que parou.
          void feedback("Disputa promovendo o vencedor — aguarde concluir")
        } else {
          const chat = useChat.getState()
          chat.cancelAutoResume(convId)
          const runId = chat.byId[convId]?.runId
          if (runId) await cancelAgent(runId)
          void feedback(
            runId ? "Tarefa interrompida" : "Tarefa já não estava em execução",
          )
        }
      } else if (payload.action === "show-running") {
        app.setViewMode("painel")
      } else if (payload.action === "open-schedules") {
        app.setScheduledOpen(true)
      } else if (payload.action === "open-settings") {
        app.setSettingsOpen(true)
      } else if (payload.action === "pause-schedules") {
        const scheduleStore = useSchedules.getState()
        const enabled = scheduleStore.schedules.filter((s) => s.enabled)
        // toggles independentes (cada um mexe só na própria linha) → paralelo
        await Promise.all(enabled.map((s) => scheduleStore.toggle(s.id, false)))
        void feedback(
          enabled.length === 1
            ? "1 automação pausada"
            : `${enabled.length} automações pausadas`,
        )
      }
      // "confirm-quit" morreu: a confirmação de saída virou diálogo NATIVO no
      // Rust (request_quit) — não depende deste webview estar vivo/visível.
    })
      .then((u) => {
        if (disposed) u()
        else unlisteners.push(u)
      })
      .catch(() => {})

    listen("tray://first-hide", () => {
      useApp.getState().setSettings({ trayCloseHintShown: true })
      void nativeNotify(
        "Frota continua em operação",
        "Agents e automações seguem rodando pela barra de menus.",
      )
    })
      .then((u) => {
        if (disposed) u()
        else unlisteners.push(u)
      })
      .catch(() => {})
    return () => {
      disposed = true
      unlisteners.forEach((u) => u())
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
            "Sessão nativa expirou — conversa retomada pela memória do Frota",
        })
        toast("Sessão nativa expirou — conversa retomada pela memória do Frota")
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
                          estado próprio — o switcher de superfícies fica como está.
                          Painel e Trabalho ficam SEMPRE MONTADOS (toggle por CSS):
                          desmontar/remontar a árvore do chat (markdown gigante) a
                          cada troca de aba travava o main thread — o memo dos
                          itens não sobrevive a remount. SDD/Agendado seguem
                          condicionais (menos frequentes, e o SddView recarrega
                          planos ao montar de propósito). */}
                      <div
                        className={cn(
                          "h-full",
                          (scheduledOpen || viewMode !== "painel") && "hidden",
                        )}
                      >
                        <MissionControl />
                      </div>
                      <div
                        className={cn(
                          "h-full",
                          (scheduledOpen || viewMode !== "linear") && "hidden",
                        )}
                      >
                        <ChatPanel />
                      </div>
                      {/* Office (O1): lazy mount na 1ª visita, depois fica
                          montado com `hidden` (o próprio OfficeMode esconde a
                          raiz e PARA o loop/ticker — §7). Wrapper relative:
                          o OfficeMode é absolute inset-0. */}
                      {officeVisited && (
                        <div
                          className={cn(
                            "relative h-full",
                            (scheduledOpen || viewMode !== "office") &&
                              "hidden",
                          )}
                        >
                          <Suspense fallback={null}>
                            <OfficeMode
                              hidden={scheduledOpen || viewMode !== "office"}
                            />
                          </Suspense>
                        </div>
                      )}
                      {scheduledOpen ? (
                        <ScheduledView />
                      ) : viewMode === "sdd" ? (
                        <SddView />
                      ) : null}
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
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {/* Toaster na RAIZ da janela (sem ancestral com transform) → position
            fixed = viewport, bottom-center REAL da janela. Antes vivia dentro do
            painel de conteúdo com um wrapper transform, o que o centrava só na
            coluna de conteúdo (parecia deslocado pra direita). */}
        <Toaster position="bottom-center" theme={theme} />
        <CommandMenu />
        {/* Host GLOBAL de interações (§6.1 item 4): approvals/perguntas têm
            card em QUALQUER viewMode (o ChatPanel não o monta mais). */}
        <GlobalInteractionHost />
        <SettingsDialog />
        <ConfirmHost />
        {/* Onboarding: overlay full-screen no 1º run (onboarded=false). O boot
            de projetos segue por baixo; finish grava onboarded=true. */}
        {!onboarded && <OnboardingWizard />}
      </TooltipProvider>
    </QueryClientProvider>
  )
}
