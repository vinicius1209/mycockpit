import { useSystemTheme } from "@/hooks/useSystemTheme"
import { useEffect } from "react"
import { rastrearModalidade } from "@/lib/modalidade"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { avisar } from "@/lib/avisos"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { TitleBar } from "@/components/layout/TitleBar"
import { StatusBar } from "@/components/layout/StatusBar"
import { useProjectConfig } from "@/hooks/useProjectConfig"
import { DecisionStrip } from "@/components/decisions/DecisionStrip"
import { CommandMenu } from "@/components/common/CommandMenu"
import { GlobalInteractionHost } from "@/components/common/GlobalInteractionHost"
import { LightboxOverlay } from "@/components/chat/Lightbox"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { AddProjectDialog } from "@/components/layout/AddProjectDialog"
import { MarkdownViewerDialog } from "@/components/common/MarkdownViewerDialog"
import { ConfirmHost } from "@/components/common/confirm"
import { OnboardingGate } from "@/components/onboarding/OnboardingGate"
import { startDictationHotkey } from "@/lib/dictationHotkey"
import { AppShell } from "@/components/layout/AppShell"
import { TelaDeEncerramento } from "@/components/layout/TelaDeEncerramento"
import { aplicarKeepAwake } from "@/lib/keepAwake"
import { iniciarVisto } from "@/lib/sino/visto"
import { useApp } from "@/store/app"
import { pendingDeferred, useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useNotifs } from "@/store/notifications"
// Registra os listeners globais de interação no boot: approvals que chegam
// antes de qualquer superfície montar já entram na fila única.
import {
  awaitingDecisionCount,
  useInteractions,
} from "@/store/interactions"
// Side-effect: hidrata o board de cards (E1) no BOOT — o Painel abre com os
// cards prontos e o vigia do Sprint 2 nunca varre um store vazio.
import "@/store/cards"
// Side-effect: liga a ponte do Companion Web (push de estado coalescido +
// executor de companion://action) no boot — no-op fora do Tauri.
import "@/lib/companion"
// Assina update://event no boot: o job de update é do app, não do modal de
// Configurações (sobrevive a fechar e reabrir o modal).
import "@/lib/updates"
import { useSchedules } from "@/store/schedules"
import { tickSchedules } from "@/lib/scheduleEngine"
import {
  setTrayPreferences,
  type TrayAction,
} from "@/lib/tray"
import { setHudPreferences } from "@/lib/hud"
import { nativeNotify } from "@/lib/notify"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { startTurnWatchdog } from "@/lib/watchdog"
import { startVigiaDoNavegador } from "@/lib/vigiaDoNavegador"
import { startUsageWindow } from "@/lib/usageWindow"
import {
  externalSessionsKey,
  startExternalSessions,
  useExternalSessions,
  visibleSessions,
} from "@/lib/externalSessions"
import { cancelLinearTurn } from "@/lib/cancelLinearTurn"
import { abortarDisputa } from "@/lib/cancelConversationTurn"
import { enviarSnapshotDaTray, useLastTurnTrayKey } from "@/lib/traySnapshot"
import { useEdicao } from "@/store/edicao"
import { isTauri, listProjects } from "@/lib/db"
import {
  commandForChannel,
  detectAgents,
  toProbeMap,
  updateAvailable,
  hydrateModelListings,
  refreshModelLists,
  UPDATE_COMMANDS,
} from "@/lib/detect"
import { agentDef } from "@/lib/agents"
import { reloadActiveProposals } from "@/lib/modelCurator"
import { getModelsCatalog } from "@/lib/catalog"
import { runDailyModelMaintenance } from "@/lib/modelRound"
import { BROWSER_DEMO_PROJECTS } from "@/lib/demoProjects"
import {
  conversationScalePercent,
  scaleFromShortcut,
} from "@/lib/conversationScale"

/** Intervalo mínimo entre checagens de update dos agents (1x/dia). */
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

const queryClient = new QueryClient()



export default function App() {
  const setProjects = useApp((s) => s.setProjects)
  const setReady = useApp((s) => s.setReady)
  useSystemTheme()
  const theme = useApp((s) => s.theme)
  const onboarded = useApp((s) => s.settings.onboarded)
  const keepInTrayOnClose = useApp((s) => s.settings.keepInTrayOnClose)
  const trayCloseHintShown = useApp((s) => s.settings.trayCloseHintShown)
  const hudEnabled = useApp((s) => s.settings.hudEnabled)
  const hudPosition = useApp((s) => s.settings.hudPosition)
  const hudHoverExpand = useApp((s) => s.settings.hudHoverExpand)
  const hudFollowActiveScreen = useApp(
    (s) => s.settings.hudFollowActiveScreen,
  )
  const hudScreenId = useApp((s) => s.settings.hudScreenId)
  const activeProjectId = useApp((s) => s.activeProjectId)

  // Atalho de ditado: tap alterna, hold é push-to-talk. O combo vem de
  // settings.dictationHotkey (null = desligado), não dispara com modal aberto
  // e respeita o mesmo gate do MicButton (settings.dictationEnabled).
  useEffect(
    () =>
      startDictationHotkey({
        combo: () => useApp.getState().settings.dictationHotkey,
        enabled: () => useApp.getState().settings.dictationEnabled,
        blocked: () =>
          !!document.querySelector('[role="dialog"][data-state="open"]'),
        onNoTarget: () => avisar.nota("Abra uma conversa para ditar"),
      }),
    [],
  )

  // A preferência de sono é do front, mas quem segura é o Rust, que nasce no
  // default a cada boot: sem reaplicar aqui, "Nunca" voltaria a segurar.
  useEffect(() => {
    void aplicarKeepAwake(useApp.getState().settings.keepAwake)
  }, [])

  useEffect(iniciarVisto, [])

  // Zoom de leitura do fio com os atalhos de navegador. Em capture porque
  // ⌘+/⌘-/⌘0 são do chrome mesmo com o composer focado; `scaleFromShortcut`
  // consome o default do WebView para não ampliar o app inteiro.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const app = useApp.getState()
      const next = scaleFromShortcut(event, app.settings.conversationScale)
      if (next == null) return
      app.setSettings({ conversationScale: next })
      avisar.feito(`Fonte da conversa: ${conversationScalePercent(next)}`, {
        id: "conversation-scale",
        duracao: 1400,
      })
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

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
      // Banco vazio → tela vazia, inclusive em dev: projeto de exemplo não
      // pertence ao código. O onboarding guia a adição do primeiro.
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

  // Update dos agents: a detecção roda em todo boot (local e paralela), para o
  // snapshot não mentir depois de um upgrade feito fora do app. Só a rede
  // não essencial (preços, curador, rodada de modelos) fica no gate diário; a
  // notificação tem dedupe.
  useEffect(() => {
    if (!isTauri()) return
    // Modelos dos CLIs: a última lista de cada motor sai do banco na hora (o
    // seletor abre certo no primeiro frame) e a sonda confirma logo atrás. Todo
    // boot, porque a lista do OpenCode muda com a credencial.
    void hydrateModelListings().then(() => refreshModelLists())
    // modelos aprovados do curador → cache do picker (barato, todo boot).
    void reloadActiveProposals()
    // Catálogo em disco → janela de contexto por modelo. Leitura local: fica
    // fora do portão de 24h, senão o anel do composer passa o dia no palpite.
    void getModelsCatalog()
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
            `instalado ${t.version ?? "?"} → ${t.latest}, atualize em Configurações ▸ Motores ▸ ${label}`,
          projectId: useApp.getState().activeProjectId ?? "",
        })
        notified[t.id] = t.latest
        changed = true
      }
      if (changed)
        useApp.getState().setSettings({ lastNotifiedVersions: notified })
    })()
  }, [])

  // O anel de foco só acende quando você tabula (STYLEGUIDE §2.1): sem isto, o
  // foco que o Radix devolve por código acende o contorno depois de um clique.
  useEffect(() => rastrearModalidade(), [])

  useEffect(() => startTurnWatchdog(), [])
  // B6: queda do navegador do projeto e navegador que sobrou de sessão anterior.
  useEffect(() => startVigiaDoNavegador(), [])

  // Medidor de janela de uso: hidrata os snapshots e assina o push da
  // statusline. O poll do codex roda na passada do vigia, sem ticker novo.
  useEffect(() => startUsageWindow(), [])

  // H1 (hooks-plan) — sessões EXTERNAS: hidrata do backend e assina o push
  // dos hooks (hooks://sessions). Presença em memória, nada persistido.
  useEffect(() => startExternalSessions(), [])

  // Automações agendadas: tick imediato no boot (com o catch-up dos perdidos
  // >5min) e a cada 60s; o reload mantém badge, view e tray frescos. Só Tauri.
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

  // Tray: status da frota e próxima agendada. Os seletores devolvem
  // primitivos, que só mudam em transição de estado, nunca a cada delta.
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
  // Pedidos bloqueantes entram nas "decisões" da tray, que é o sinal que te
  // alcança com a janela fechada. Conta CONVERSAS, não pedidos: 20 `Bash`
  // idênticos são uma decisão só ("Aprovar todas"). Regra pura em
  // store/interactions (awaitingDecisionCount).
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
  const lastTurnTrayKey = useLastTurnTrayKey()
  const arquivosSujos = useEdicao((s) => Object.keys(s.sujos).length)
  useEffect(() => {
    if (!isTauri()) return
    // O QUE a bandeja mostra mora em lib/traySnapshot; aqui fica o QUANDO.
    const send = () => enviarSnapshotDaTray(decisionsPending, pendingInteractions)
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
    lastTurnTrayKey,
    arquivosSujos,
  ])

  // Preferências persistidas do ciclo de vida → backend (que recebe o evento
  // de fechar antes do React e, portanto, não pode consultar localStorage).
  useEffect(() => {
    setTrayPreferences(keepInTrayOnClose, trayCloseHintShown)
  }, [keepInTrayOnClose, trayCloseHintShown])

  // A intenção persiste no store, mas geometria, fallback e hit-testing são
  // nativos. O backend devolve o estado EFETIVO e o publica ao webview da tray.
  useEffect(() => {
    if (!isTauri()) return
    void setHudPreferences({
      enabled: hudEnabled,
      position: hudPosition,
      hoverExpand: hudHoverExpand,
      followActiveScreen: hudFollowActiveScreen,
      screenId: hudScreenId,
    }).catch((cause) => console.error("Falha ao aplicar o instrumento:", cause))
  }, [
    hudEnabled,
    hudPosition,
    hudHoverExpand,
    hudFollowActiveScreen,
    hudScreenId,
  ])

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
      if (visible) avisar.feito(message)
      else void nativeNotify("Frota", message)
    }
    listen<TrayAction>("tray://action", async ({ payload }) => {
      const app = useApp.getState()
      if (payload.action === "new-task") {
        const projectId = app.activeProjectId ?? app.projects[0]?.id
        if (!projectId) {
          avisar.nota("Adicione um projeto antes de criar uma tarefa")
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
          // Deixa o marco do corte da disputa no fio (ADR-180).
          void abortarDisputa(convId)
          void feedback("Disputa interrompida")
        } else if (fusion?.phase === "promoting") {
          // Promoção é one-shot (abort no-opa): não finge que parou.
          void feedback("Disputa promovendo o vencedor, aguarde concluir")
        } else {
          const disposition = await cancelLinearTurn(convId, "parada")
          void feedback(
            disposition === "idle" ? "Tarefa já não estava em execução" : "Tarefa interrompida",
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
      // A confirmação de saída é diálogo nativo no Rust (request_quit).
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

  // Resume nativo falhou e o run reiniciou do zero: zera a sessão morta (o
  // run novo grava a dele). O aviso já vem do motor; aqui é só estado.
  // Global: cobre runs em background.
  useEffect(() => {
    if (!isTauri()) return
    let un: UnlistenFn | null = null
    let disposed = false
    listen<{ conv_id: string; run_id: string; used_memory: boolean }>(
      "resume://fallback",
      (e) => {
        const { conv_id } = e.payload
        const chat = useChat.getState()
        if (!chat.byId[conv_id]) return
        chat.clearSession(conv_id)
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

  // O Rust anunciou o plano de MCPs no prompt deste run: carimba o
  // fingerprint no ledger da conversa. Ele volta como `mcpFingerprint` no
  // próximo envio, e o motor que anuncia só no 1º turno re-anuncia apenas
  // quando o plano muda. Global: cobre runs em background.
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

  // Config do projeto ativo (.frota/config.toml vence o cache do SQLite).
  useProjectConfig(activeProjectId)

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div className="grain relative flex h-screen w-screen flex-col overflow-hidden bg-rail text-foreground">
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
        <Toaster theme={theme} />
        <CommandMenu />
        {/* Host GLOBAL de interações (§6.1 item 4): approvals/perguntas têm
            card em QUALQUER viewMode (o ChatPanel não o monta mais). */}
        <GlobalInteractionHost />
        {/* Lightbox ÚNICO do fio (evidência de tool B1 + anexos do usuário):
            host global — MessageList existe em Linear e Painel e o
            overlay é um só. Fechado renderiza null. */}
        <LightboxOverlay />
        <SettingsDialog />
        <AddProjectDialog />
        <MarkdownViewerDialog />
        <ConfirmHost />
        {/* Onboarding: overlay full-screen no 1º run (onboarded=false), tour
            depois wizard. O boot de projetos segue por baixo; finish grava onboarded=true. */}
        {!onboarded && <OnboardingGate />}
        {/* Por cima de tudo: depois da confirmação de saída não há mais o que clicar. */}
        <TelaDeEncerramento />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
