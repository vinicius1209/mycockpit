import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { TitleBar } from "@/components/layout/TitleBar"
import { StatusBar } from "@/components/layout/StatusBar"
import { useProjectConfig } from "@/hooks/useProjectConfig"
import { RiskClimate } from "@/components/chat/RiskClimate"
import { DecisionStrip } from "@/components/decisions/DecisionStrip"
import { CommandMenu } from "@/components/common/CommandMenu"
import { GlobalInteractionHost } from "@/components/common/GlobalInteractionHost"
import { LightboxOverlay } from "@/components/chat/Lightbox"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { ConfirmHost } from "@/components/common/confirm"
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard"
import { startDictationHotkey } from "@/lib/dictationHotkey"
import { AppShell } from "@/components/layout/AppShell"
import { useApp } from "@/store/app"
import { pendingDeferred, useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useNotifs } from "@/store/notifications"
// Side-effect: registra os listeners globais de interação (interaction://
// request/resolved) no BOOT — approvals disparados antes de qualquer superfície
// montar já entram na fila única (store) que host e derive compartilham.
import {
  awaitingDecisionCount,
  currentOriginAnyKind,
  useInteractions,
} from "@/store/interactions"
// Side-effect: hidrata o board de cards (E1) no BOOT — o Painel abre com os
// cards prontos e o vigia do Sprint 2 nunca varre um store vazio.
import "@/store/cards"
// Side-effect: liga a ponte do Companion Web (push de estado coalescido +
// executor de companion://action) no boot — no-op fora do Tauri.
import "@/lib/companion"
// Side-effect: assina update://event no BOOT — o job de update de CLI é do
// APP, não do modal de Configurações (toast estável + estado sobrevive ao
// fechar/reabrir o modal). No-op fora do Tauri.
import "@/lib/updates"
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
import { focusConsoleComposer } from "@/lib/focusComposer"
import { startTurnWatchdog } from "@/lib/watchdog"
import { startUsageWindow } from "@/lib/usageWindow"
import {
  engineLabel,
  externalSessionsKey,
  sessionPlace,
  startExternalSessions,
  useExternalSessions,
  visibleSessions,
} from "@/lib/externalSessions"
import { agentLabel, cancelAgent } from "@/lib/agent"
import { isTauri, listProjects } from "@/lib/db"
import {
  commandForChannel,
  detectAgents,
  toProbeMap,
  updateAvailable,
  refreshAgyModels,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import { agentDef } from "@/lib/agents"
import { reloadActiveProposals } from "@/lib/modelCurator"
import { runDailyModelMaintenance } from "@/lib/modelRound"
import { BROWSER_DEMO_PROJECTS } from "@/lib/demoProjects"

/** Intervalo mínimo entre checagens de update dos agents (1x/dia). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const queryClient = new QueryClient()



export default function App() {
  const setProjects = useApp((s) => s.setProjects)
  const setReady = useApp((s) => s.setReady)
  const theme = useApp((s) => s.theme)
  const onboarded = useApp((s) => s.settings.onboarded)
  const keepInTrayOnClose = useApp((s) => s.settings.keepInTrayOnClose)
  const trayCloseHintShown = useApp((s) => s.settings.trayCloseHintShown)
  const activeProjectId = useApp((s) => s.activeProjectId)

  // Atalho de ditado (estilo Wispr): tap alterna, hold é push-to-talk. O combo
  // vem de settings.dictationHotkey (lido por evento — trocar vale na hora;
  // null = desativado). O alvo é o registro fino de lib/dictationHotkey
  // (MicButton do composer); não dispara com modal aberto (⌘K e afins:
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
        if (!cancelled) setProjects(BROWSER_DEMO_PROJECTS)
        return
      }
      const existing = await listProjects()
      if (cancelled) return
      // Banco vazio → tela vazia, INCLUSIVE em dev. Antes o dev semeava
      // projetos de exemplo, e eles eram os projetos reais de uma máquina
      // específica: isso não pertence ao código-fonte nem a uma captura de
      // marketing. O onboarding (docs/onboarding.md) guia a adição do primeiro.
      setProjects(existing ?? [])
    }
    load()
      .catch((e) => {
        console.error("Falha ao carregar projetos:", e)
        if (!cancelled) setProjects([])
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
  // gate diário é só o trabalho de rede não-essencial (catálogo de preços,
  // curador semanal, rodada de modelos); a NOTIFICAÇÃO segue com dedupe.
  useEffect(() => {
    if (!isTauri()) return
    // modelos reais do `agy models` → cache dinâmico (barato, todo boot).
    void refreshAgyModels()
    // modelos aprovados do curador → cache do picker (barato, todo boot).
    void reloadActiveProposals()
    const last = useApp.getState().settings.lastUpdateCheck ?? 0
    // Catálogo de preços, curador semanal e rodada de modelos (M3): a
    // sequência inteira, com os freios dela, mora em lib/modelRound.
    if (Date.now() - last >= UPDATE_CHECK_INTERVAL_MS)
      void runDailyModelMaintenance()
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
        // G3.2 — o comando sugerido é o do CANAL detectado do binário (npm vs
        // homebrew); canal desconhecido → copy neutra em vez do comando errado.
        const cmd = commandForChannel(t.id, t.latestChannel)
        useNotifs.getState().push({
          kind: "run_done",
          title: `Atualização disponível: ${label} ${t.latest}`,
          subtitle:
            cmd ??
            `instalado ${t.version ?? "?"} → ${t.latest}, atualize em Configurações ▸ Agentes na máquina`,
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

  // Medidor de janela de uso: hidrata os snapshots vivos do backend e assina
  // o push da statusline (usage://snapshot). O poll (codex) roda na passada
  // do vigia acima — nenhum ticker novo.
  useEffect(() => startUsageWindow(), [])

  // H1 (hooks-plan) — sessões EXTERNAS: hidrata do backend e assina o push
  // dos hooks (hooks://sessions). Presença em memória, nada persistido.
  useEffect(() => startExternalSessions(), [])

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
  //
  // Conta CONVERSAS, não pedidos: um turno pode pedir 20 `Bash` idênticos, e um
  // clique em "Aprovar todas" zera os 20 — anunciar "20 decisões" para uma
  // decisão só é inflar o número que deveria te dizer quanto trabalho te espera.
  // É a mesma colapsagem que o aviso já faz por episódio (announceArrival dedupa
  // por conversa) e que o card faz por assinatura.
  // Primitivo no seletor ⇒ estável durante o streaming. A regra é pura e testada
  // em store/interactions (awaitingDecisionCount).
  const pendingInteractions = useInteractions((s) =>
    awaitingDecisionCount(s.queue, useChat.getState(), useMission.getState()),
  )
  // Chaves semânticas: mudam quando a etapa exibida na telemetria muda, mas
  // permanecem estáveis durante deltas de texto do streaming.
  const chatTrayKey = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id, c]) => {
        const last = c.items[c.items.length - 1]
        const tool = last?.kind === "tool" ? last.name : ""
        // nº de diferidos vivos entra na chave: o snapshot da tray (e o aviso
        // de saída, D1.4) precisa reagir quando um workflow nasce/termina.
        const deferred = pendingDeferred(c.items).length
        return `${id}:${last?.kind ?? "idle"}:${tool}:${c.streamingTextId ?? ""}:${deferred}`
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
  // Sessões EXTERNAS (H1): chave semântica estável — o efeito só re-envia
  // quando o conjunto/estado muda, não a cada evento de hook.
  const externalKey = useExternalSessions((s) =>
    externalSessionsKey(visibleSessions(s.sessions)),
  )
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

      // Trabalho diferido do provider vivo em QUALQUER conversa carregada:
      // conta pro aviso honesto do quit (D1.4). Derivado de items.
      const deferredCount = Object.values(chat.byId).reduce(
        (acc, c) => acc + pendingDeferred(c.items).length,
        0,
      )

      // Sessões EXTERNAS observadas pelos hooks (H1): linhas informativas no
      // tray — o app observa, não dirige. Rótulo/projeto resolvidos AQUI (o
      // Rust só exibe o que chega pronto).
      const external = visibleSessions(
        useExternalSessions.getState().sessions,
      ).map((s) => ({
        agent: engineLabel(s.agent),
        place: sessionPlace(s, app.projects),
        status: s.status,
        lastSeen: s.lastSeen,
      }))

      updateTray({
        running: activities.size,
        decisions: decisionsPending + pendingInteractions,
        deferred: deferredCount,
        external,
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
    externalKey,
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
    const focusComposer = () => setTimeout(focusConsoleComposer, 140)
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
          void feedback("Disputa promovendo o vencedor, aguarde concluir")
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
            "Sessão nativa expirou; conversa retomada pela memória do Frota",
        })
        toast("Sessão nativa expirou; conversa retomada pela memória do Frota")
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

  // H2 (prompt-hygiene-plan): o Rust anunciou o plano de MCPs no corpo do
  // prompt deste run → carimba o fingerprint no ledger efêmero da conversa
  // (mesmo mecanismo do frescor da doutrina, H4). É ele que volta como
  // `mcpFingerprint` no próximo envio: motor 1º-turno-só re-anuncia SÓ quando
  // o plano muda mid-conversa. Listener global: cobre runs em background.
  useEffect(() => {
    if (!isTauri()) return
    let un: UnlistenFn | null = null
    let disposed = false
    listen<{ conv_id: string; fingerprint: string }>("mcp://announced", (e) => {
      useChat
        .getState()
        .recordInjectedFingerprint(e.payload.conv_id, "mcp", e.payload.fingerprint)
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

  // Config do projeto ativo (.mycockpit/config.toml vence o cache do SQLite).
  useProjectConfig(activeProjectId)

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div className="grain relative flex h-screen w-screen flex-col overflow-hidden bg-rail text-foreground">
          {/* Moldura ambiente do modo Liberado: JANELA inteira, não o painel.
              Regra, alcance e o porquê da subida: lib/climate. */}
          <RiskClimate />
          <TitleBar />
          {/* A faixa "precisa de você" (ADR-040): CHROME, entre a barra do topo
              e o conteúdo, pra ser visível de dentro do Trabalho e não só do
              Painel. Sem decisão pendente ela renderiza null e não ocupa
              pixel nenhum. */}
          <DecisionStrip />
          <AppShell />
          {/* Faixa de status: AMBIENTE (janela do plano, custo da sessão, build).
              A linha viva do turno NÃO desce pra cá — ela é dona do agora e mora
              no composer (lib/statusBar guarda essa fronteira). */}
          <StatusBar />
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
        {/* Lightbox ÚNICO do fio (evidência de tool B1 + anexos do usuário):
            host global — MessageList existe em Linear e Painel e o
            overlay é um só. Fechado renderiza null. */}
        <LightboxOverlay />
        <SettingsDialog />
        <ConfirmHost />
        {/* Onboarding: overlay full-screen no 1º run (onboarded=false). O boot
            de projetos segue por baixo; finish grava onboarded=true. */}
        {!onboarded && <OnboardingWizard />}
      </TooltipProvider>
    </QueryClientProvider>
  )
}
