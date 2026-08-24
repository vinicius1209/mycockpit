import { useEffect } from "react"
import { rastrearModalidade } from "@/lib/modalidade"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { toast } from "sonner"
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
import { ConfirmHost } from "@/components/common/confirm"
import { OnboardingGate } from "@/components/onboarding/OnboardingGate"
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
import {
  setTrayPreferences,
  type TrayAction,
} from "@/lib/tray"
import { nativeNotify } from "@/lib/notify"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { startTurnWatchdog } from "@/lib/watchdog"
import { startUsageWindow } from "@/lib/usageWindow"
import {
  externalSessionsKey,
  startExternalSessions,
  useExternalSessions,
  visibleSessions,
} from "@/lib/externalSessions"
import { cancelAgent } from "@/lib/agent"
import { enviarSnapshotDaTray } from "@/lib/traySnapshot"
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

  // Zoom de LEITURA do fio, com os atalhos de navegador. Listener em capture:
  // o composer pode estar focado, mas ⌘+/⌘-/⌘0 pertencem ao chrome, nunca ao
  // texto. `scaleFromShortcut` consome o default do WebView para ele não ampliar
  // sidebar, composer e dialogs junto com a conversa.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const app = useApp.getState()
      const conversationVisible =
        app.viewMode === "linear" &&
        app.mainTab.kind === "conversa" &&
        !app.scheduledOpen &&
        !app.flightPlansOpen &&
        !app.fleetOpen
      if (!conversationVisible) return
      const next = scaleFromShortcut(event, app.settings.conversationScale)
      if (next == null) return
      app.setSettings({ conversationScale: next })
      toast(`Fonte da conversa: ${conversationScalePercent(next)}`, {
        id: "conversation-scale",
        duration: 1400,
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
  // O anel de foco só acende quando você TABULA (docs/STYLEGUIDE.md §2.1).
  // Sem isto, o Radix devolvendo o foco por código acende o contorno dourado
  // depois de um clique — medido, e é o que faz o app parecer web.
  useEffect(() => rastrearModalidade(), [])

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
  // reiniciou fresh. Zera a sessão morta da conversa (o novo run emite
  // `session` e grava a nova). O aviso pro usuário (com ou sem memória do
  // Frota) já vem como Notice do próprio motor (agent.rs/codex_appserver.rs)
  // — este listener só cuida do estado, não duplica o aviso (antes mandava um
  // segundo notice + toast dizendo quase a mesma coisa, empilhado em cima do
  // que o motor já tinha avisado — achado real do usuário, 18/08/2026).
  // Listener global: cobre runs em background também.
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
        {/* Onboarding: overlay full-screen no 1º run (onboarded=false), tour
            depois wizard. O boot de projetos segue por baixo; finish grava onboarded=true. */}
        {!onboarded && <OnboardingGate />}
      </TooltipProvider>
    </QueryClientProvider>
  )
}
