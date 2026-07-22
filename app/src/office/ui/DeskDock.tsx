// Dock da mesa (§5.4) — painel direito OPACO (sem backdrop-blur sobre canvas
// vivo, §6), 380px, chrome do design system. Histórico + streaming chegam
// pelo próprio useChat (handleEvent do bridge/send.ts escreve em byId[convId]);
// aqui só se lê via bridge/hooks. Fechar aplica §5.4: draft ou turno ativo ⇒
// minimiza pro chip do HUD; senão fecha. Nunca descarta draft em silêncio.
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react"
import {
  ArrowRightLeft,
  ArrowUp,
  ClipboardList,
  Lock,
  Loader2,
  Mic,
  Minus,
  Square,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react"
import { Markdown } from "@/components/common/Markdown"
import { RichSelect } from "@/components/ui/RichSelect"
import { feedbackLesson } from "@/lib/learning"
import { cn } from "@/lib/utils"
import {
  MISSION_TABLE_ID,
  type DeskSnapshot,
  type OfficeAgentId,
  type RoomSnapshot,
} from "../engine/types"
import {
  agentCssColor,
  agentLabel,
  answerDeskGate,
  approveDeskPlan,
  availableAgents,
  defaultModelForAgent,
  discardDeskPlan,
  dockLeaveCtx,
  effortsFor,
  modelsFor,
  officeProjectById,
  setDeskDraft,
  useDeskConvChrome,
  useDeskDraft,
  useDeskItems,
  useDeskGate,
  useDeskMissionView,
  fmtCost,
  type ChatItem,
} from "../bridge/hooks"
import { abortTableMission } from "../bridge/mission"
import {
  DeskMissionPanel,
  GateCard,
  missionPanelSubtitle,
  showsMissionPanel,
} from "./missionPanel"
import {
  continueInAgent,
  ensureDeskConversation,
  sendFromDesk,
  cancelDeskTurn,
  type DeskSendArgs,
} from "../bridge/send"
import { pickRevezamento, revezamentoTargets } from "./recovery"
import {
  cancelDictation,
  onDictationEnded,
  onDictationPartial,
  startDictation,
  stopDictation,
} from "../bridge/voice"
import { DictationOverlay } from "@/components/chat/DictationOverlay"
import { formatHotkey, registerDictationTarget } from "@/lib/dictationHotkey"
import { useApp } from "@/store/app"
import { ElapsedSince } from "./DeskMenu"
import {
  activeDockWidth,
  dockItemsStart,
  officeEscape,
  useOfficeUi,
} from "./store"
import { perfSpan } from "../engine/perf"

// Larguras do painel (DOCK_W/DOCK_W_WIDE) moram no ./store (módulo puro) —
// o OfficeMode usa o mesmo valor pro screenOffset.
export { DOCK_W, DOCK_W_WIDE } from "./store"

/** `${projectId}::${agent}` → partes (lastIndexOf: id de projeto nunca tem
 *  "::" hoje, mas o agent é sempre o último segmento). */
function parseDeskId(deskId: string): { projectId: string; agent: OfficeAgentId } {
  const i = deskId.lastIndexOf("::")
  return {
    projectId: deskId.slice(0, i),
    agent: deskId.slice(i + 2) as OfficeAgentId,
  }
}

function findDeskSnapshot(
  rooms: RoomSnapshot[],
  deskId: string,
): { desk: DeskSnapshot; room: RoomSnapshot } | null {
  for (const room of rooms)
    for (const desk of room.desks) if (desk.id === deskId) return { desk, room }
  return null
}

/** Cor do beacon do cabeçalho por estado visual da mesa. */
function stateColor(state: DeskSnapshot["state"] | undefined): string {
  switch (state) {
    case "typing":
    case "thinking":
      return "var(--st-running)"
    case "hand":
      return "var(--st-queued)"
    case "off":
      return "color-mix(in srgb, var(--st-idle) 45%, transparent)"
    default:
      return "var(--st-idle)"
  }
}

/** Glifo do retrato (inicial distinta por agent — "C"/"C" colidiria). */
const AGENT_GLYPH: Record<OfficeAgentId, string> = {
  "claude-code": "C",
  codex: "X",
  agy: "A",
}

/** Retrato do agent no cabeçalho: círculo com ANEL na cor do agent + glifo em
 *  Geist (font-sans do app) — DOM puro, sem Pixi. O beacon de estado vira um
 *  pontinho no canto do retrato (mesma linguagem de semáforo). */
function AgentPortrait({
  agent,
  state,
}: {
  agent: OfficeAgentId
  state: DeskSnapshot["state"] | undefined
}) {
  const color = agentCssColor(agent)
  return (
    <span
      className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary"
      style={{ boxShadow: `inset 0 0 0 2px ${color}` }}
      aria-hidden="true"
    >
      <span className="font-sans text-[13px] font-bold" style={{ color }}>
        {AGENT_GLYPH[agent]}
      </span>
      <span
        className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card"
        style={{ background: stateColor(state) }}
      />
    </span>
  )
}

/** Chips de sugestão do vazio inicial — clicar preenche o composer (§5.6 v2). */
const SUGGESTION_CHIPS = [
  "Status do projeto",
  "O que você está fazendo agora?",
  "Continuar a última tarefa",
]

// --- revezamento (troca de provedor após limite/erro) -----------------------

/** Contexto do revezamento passado ao DockItem: agent atual da mesa + o gesto
 *  que dispara continueInAgent pro alvo. null = revezamento indisponível agora
 *  (turno em voo, corrupt, sem conversa) — o item só mostra a mensagem. */
type RevContext = { currentAgent: string; onPick: (targetAgent: string) => void }

/** Linha "Revezamento: [Continuar no X]" dentro do dock (espelho do ContinueRow
 *  do MessageList): só agents disponíveis != o atual, botões pill com
 *  ArrowRightLeft. Continua a MESMA conversa em outro PROVEDOR (o disco/worktree
 *  o novo agent herda; o contexto viaja por handoff — vive no send.ts). */
function RevezamentoRow({
  current,
  onPick,
}: {
  current: string
  onPick: (targetAgent: string) => void
}) {
  const targets = revezamentoTargets(current, availableAgents())
  if (targets.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">Revezamento:</span>
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.id)}
          className="flex items-center gap-1 rounded-full border border-brass/40 bg-brass/10 px-2.5 py-1 text-[11px] text-brass transition-colors hover:bg-brass/20"
        >
          <ArrowRightLeft className="size-3" /> Continuar no {t.label}
        </button>
      ))}
    </div>
  )
}

// --- itens do histórico -----------------------------------------------------

/** 👍/👎 do turno concluído (P6) — o MESMO caminho do onThumbUp do ChatPanel:
 *  feedbackLesson (lib/learning) reforça as lições injetadas no último envio
 *  da mesa (registro do sendFromDesk). O 👎 é sinal leve: como no ChatPanel,
 *  sozinho ele não grava nada (o fluxo de propor regra, com nota + gate
 *  humano, vive no Linear). */
function ResultFeedback({ convId }: { convId: string }) {
  const [verdict, setVerdict] = useState<"up" | "down" | null>(null)
  function give(v: "up" | "down") {
    if (verdict) return
    setVerdict(v)
    void feedbackLesson(convId, v)
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        title="Boa resposta (reforça as lições usadas)"
        aria-label="Boa resposta"
        onClick={() => give("up")}
        className={cn(
          "rounded p-0.5 text-muted-foreground transition-colors hover:text-st-success",
          verdict === "up" && "text-st-success",
          verdict === "down" && "opacity-40",
        )}
      >
        <ThumbsUp className="size-3" />
      </button>
      <button
        type="button"
        title="Faltou algo / estava errado"
        aria-label="Feedback negativo"
        onClick={() => give("down")}
        className={cn(
          "rounded p-0.5 text-muted-foreground transition-colors hover:text-st-error",
          verdict === "down" && "text-st-error",
          verdict === "up" && "opacity-40",
        )}
      >
        <ThumbsDown className="size-3" />
      </button>
    </span>
  )
}

/** memo (S2): ChatItem é imutável por identidade (o reducer sempre TROCA o
 *  objeto ao mudar) — durante o streaming só o item da bolha corrente troca de
 *  ref, então as demais linhas (Markdown incluso) pulam o re-render. `rev` é
 *  null estável fora do último item; `convId` é estável por conversa. */
const DockItem = memo(function DockItem({
  item,
  rev,
  convId,
}: {
  item: ChatItem
  rev?: RevContext | null
  convId?: string | null
}) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-8 rounded-lg rounded-br-sm bg-brass-soft px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
          {item.text}
        </div>
      )
    case "text":
      return <Markdown text={item.text} />
    case "tool":
      return (
        <div className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground">
          <Wrench className="size-3 shrink-0" />
          <span className="truncate">{item.name}</span>
          {item.result && (
            <span
              className={cn(
                "shrink-0",
                item.result.ok ? "text-st-success" : "text-st-error",
              )}
            >
              {item.result.ok ? "ok" : "falhou"}
            </span>
          )}
        </div>
      )
    case "result":
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            Turno concluído{item.costUsd ? ` · ${fmtCost(item.costUsd, item.costSource)}` : ""}
          </span>
          {item.ok && convId && <ResultFeedback convId={convId} />}
        </p>
      )
    case "error":
      return (
        <div className="flex flex-col">
          <p className="text-[12px] text-st-error">{item.message}</p>
          {rev && <RevezamentoRow current={rev.currentAgent} onPick={rev.onPick} />}
        </div>
      )
    case "cancelled":
      return <p className="text-[12px] text-muted-foreground italic">Cancelado.</p>
    case "notice":
      return <p className="text-[12px] text-muted-foreground">{item.message}</p>
    case "limit":
      return (
        <div className="flex flex-col">
          <p className="text-[12px] text-st-warning">{item.message}</p>
          {item.resetHint && (
            <p className="text-[11px] text-muted-foreground">
              volta em {item.resetHint}
            </p>
          )}
          {rev && <RevezamentoRow current={rev.currentAgent} onPick={rev.onPick} />}
        </div>
      )
  }
})

/** Lista do histórico (S2): componente próprio que assina `items` SOZINHO
 *  (useDeskItems) — cada text_delta re-renderiza só esta subárvore (janela de
 *  DOCK_ITEMS_WINDOW itens memoizados + a bolha corrente), nunca o chrome do
 *  dock (cabeçalho/RichSelect/composer, que leem useDeskConvChrome). */
function DockItemsList({
  convId,
  rev,
  showAll,
  onShowAll,
  scrollRef,
}: {
  convId: string | null
  rev: RevContext | null
  showAll: boolean
  onShowAll: () => void
  /** Container rolável do dock (o autoscroll vive junto da lista). */
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const items = useDeskItems(convId)

  // Autoscroll pro fim quando o histórico muda (streaming incluso: cada
  // handleEvent troca a identidade de items).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, scrollRef])

  if (!items) return null
  // S2: custo de recriar a LISTA a cada text_delta com o dock aberto (a
  // renderização dos <Markdown> em si aparece no react:commit do <Profiler>
  // do OfficeMode). No-op sem mc.office.perf.
  const endSpan = perfSpan("dock:items")
  // Janela (S2): só a cauda renderiza; o botão expande sob demanda.
  const start = dockItemsStart(items.length, showAll)
  const rows: ReactNode[] = []
  if (start > 0)
    rows.push(
      <button
        key="dock-show-all"
        type="button"
        onClick={onShowAll}
        className="self-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brass/60 hover:text-foreground"
      >
        Ver conversa completa · {start}{" "}
        {start === 1 ? "item anterior" : "itens anteriores"}
      </button>,
    )
  for (let i = start; i < items.length; i++) {
    const item = items[i]
    rows.push(
      // Revezamento só no ÚLTIMO item (limit/error): continueInAgent age
      // sobre o último pedido pendente da conversa — uma linha de ação por
      // item histórico seria ruído (todas fariam o mesmo).
      <DockItem
        key={item.id}
        item={item}
        rev={i === items.length - 1 ? rev : null}
        convId={convId}
      />,
    )
  }
  endSpan()
  return <>{rows}</>
}

// --- plano pendente ---------------------------------------------------------

/** Card compacto do "Planejar primeiro" (espelho do PlanPendingCard do
 *  ChatPanel): o turno plan_first terminou e o plano está logo acima no fio.
 *  Aprovar/Descartar disparam as MESMAS ações do ChatPanel (via bridge/hooks +
 *  sendFromDesk) — sem ele o plano ficava invisível no office. */
function PlanCard({
  onApprove,
  onDiscard,
}: {
  onApprove: () => void
  onDiscard: () => void
}) {
  return (
    <div className="rounded-lg border border-brass/40 bg-brass/[0.07] p-3">
      <div className="flex items-center gap-1.5">
        <ClipboardList className="size-3.5 shrink-0 text-brass" />
        <p className="text-[12px] font-semibold text-foreground">
          Plano proposto — aguardando sua aprovação
        </p>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Revise o plano acima: o agent só executa depois do seu OK.
      </p>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-secondary"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-brass-foreground transition-opacity hover:opacity-90"
        >
          Aprovar e executar
        </button>
      </div>
    </div>
  )
}

// --- auto-resume ------------------------------------------------------------

/** Linha discreta quando um auto-resume está agendado nesta conversa (o banner
 *  completo, com Cancelar/Retomar agora, vive no ChatPanel — aqui só o aviso
 *  com countdown, pra retomada automática não pegar de surpresa no office). */
function AutoResumeLine({
  nextAt,
  tries,
  maxTries,
}: {
  nextAt: number
  tries: number
  maxTries: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.ceil((nextAt - now) / 1000))
  const restam = Math.max(0, maxTries - tries)
  return (
    <p className="mt-1 px-0.5 text-[11px] text-st-warning">
      Auto-retomada em {secs}s · {restam} {restam === 1 ? "tentativa restante" : "tentativas restantes"}
    </p>
  )
}

// --- dock -------------------------------------------------------------------

export function DeskDock() {
  const dockDeskId = useOfficeUi((s) => s.dockDeskId)
  const dockMinimized = useOfficeUi((s) => s.dockMinimized)
  const convId = useOfficeUi((s) => s.dockConvId)
  const snapshot = useOfficeUi((s) => s.snapshot)
  const recording = useOfficeUi((s) => s.recording)
  const recordingSince = useOfficeUi((s) => s.recordingSince)
  const partial = useOfficeUi((s) => s.dictationPartial)
  const hotkey = useApp((s) => s.settings.dictationHotkey)
  // Card de decisão (gate) montado ⇒ painel ALARGADO (560px), cena visível.
  const dockWide = useOfficeUi((s) => s.dockWide)

  // Visão DISCRETA da conversa (S2): o chrome do dock nunca re-renderiza por
  // text_delta — a lista (DockItemsList) assina os items por conta própria.
  const conv = useDeskConvChrome(convId)
  const draft = useDeskDraft(convId)
  const gate = useDeskGate(convId)

  const listRef = useRef<HTMLDivElement>(null)
  // "Ver tudo" da janela do histórico (S2) — volta à cauda ao trocar de conversa.
  const [showAllItems, setShowAllItems] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  // Modelo + esforço do PRÓXIMO envio. O agent continua sendo uma escolha
  // espacial (a mesa); a conversa trava a configuração no primeiro turno.
  const [modelChoice, setModelChoice] = useState<string>("default")
  const [effortChoice, setEffortChoice] = useState<string>("default")

  // Mesa de reunião (O-2) não é mesa de agent: o MissionDock assume — aqui o
  // parse viraria projectId "commons"/agent "mission" e o effect abaixo
  // registraria uma conversa órfã via ensureDeskConversation.
  const isMissionTable = dockDeskId === MISSION_TABLE_ID
  const desk = dockDeskId && !isMissionTable ? parseDeskId(dockDeskId) : null
  const snap = dockDeskId
    ? findDeskSnapshot(snapshot?.rooms ?? [], dockDeskId)
    : null
  const project = desk ? officeProjectById(desk.projectId) : undefined
  const turnActive = conv.running || conv.finalizing

  // MISSÃO NA MESA (task #14): durante uma fase de missão o derive carimba
  // desk.convId com a conversa DA MISSÃO (≠ dockConvId, a conversa da mesa).
  // Run ativo nela ⇒ o corpo do dock vira o painel de missão compacto — o
  // status real aparece aqui, não só na mesa de reunião.
  const missionConvId = snap?.desk.convId ?? null
  const missionView = useDeskMissionView(missionConvId)
  const missionGate = useDeskGate(missionConvId)
  const missionActive = showsMissionPanel(missionView)

  // Modelos do agent da mesa pro seletor do cabeçalho (vazio = agent sem flag
  // de modelo ⇒ sem seletor).
  const deskAgent = desk?.agent
  const models = deskAgent ? modelsFor(deskAgent) : []
  const efforts = deskAgent ? effortsFor(deskAgent) : []
  const configLocked = conv.locked
  const effectiveModel = configLocked ? (conv.reqModel ?? "default") : modelChoice
  const effectiveEffort = configLocked ? (conv.effort ?? "default") : effortChoice
  const modelLabel =
    models.find((m) => m.value === effectiveModel)?.pill ??
    models.find((m) => m.value === effectiveModel)?.label ??
    null
  // Re-semeia o modelo ao trocar de mesa (o agent muda) — cada mesa lembra o
  // default do seu agent até o usuário escolher outro.
  useEffect(() => {
    if (deskAgent) {
      setModelChoice(defaultModelForAgent(deskAgent))
      setEffortChoice("default")
    }
  }, [deskAgent])

  // Ao abrir a mesa: garante a conversa (mais recente do par projeto+agent ou
  // nova em background) e guarda o convId no store local.
  useEffect(() => {
    if (!dockDeskId || dockDeskId === MISSION_TABLE_ID || convId) return
    const d = parseDeskId(dockDeskId)
    let gone = false
    void ensureDeskConversation(d.projectId, d.agent).then((id) => {
      if (!gone && useOfficeUi.getState().dockDeskId === dockDeskId)
        useOfficeUi.getState().setDockConv(id)
    })
    return () => {
      gone = true
    }
  }, [dockDeskId, convId])

  // Ciclo de vida do ditado → store, num LUGAR SÓ: parciais viram legenda; o
  // FIM (stop, Esc ou sidecar morto — stt://ended) solta recording=false.
  // Nenhum outro ponto da ui/ seta recording=false na mão.
  useEffect(() => {
    const offPartial = onDictationPartial((t) =>
      useOfficeUi.getState().setDictationPartial(t),
    )
    const offEnded = onDictationEnded(() =>
      useOfficeUi.getState().setRecording(false),
    )
    return () => {
      offPartial()
      offEnded()
    }
  }, [])

  // Trocar de conversa fecha o "ver tudo" (a cauda é o modo padrão da janela).
  useEffect(() => {
    setShowAllItems(false)
  }, [convId])

  // Alvo do atalho de ditado enquanto o dock está ABERTO (registrado por último ⇒
  // vence o MicButton do Trabalho, que fica montado escondido). start/stop
  // reusam o toggleMic (hoisted) via ref — as guardas (convId, missão, busy)
  // são as mesmas do botão. Office escondido ⇒ offsetParent null ⇒ pulado.
  const micBtnRef = useRef<HTMLButtonElement | null>(null)
  const hotkeyRef = useRef({ toggle: () => Promise.resolve() })
  hotkeyRef.current = {
    toggle: () =>
      !convId || conv.corrupt || missionActive
        ? Promise.resolve()
        : toggleMic(),
  }
  const dockOpen = !!dockDeskId && !dockMinimized && !isMissionTable
  useEffect(() => {
    if (!dockOpen) return
    return registerDictationTarget({
      start: () => {
        if (!useOfficeUi.getState().recording) return hotkeyRef.current.toggle()
      },
      stop: () => {
        if (useOfficeUi.getState().recording) return hotkeyRef.current.toggle()
      },
      cancel: () => cancelDictation(),
      isRecording: () => useOfficeUi.getState().recording,
      isAvailable: () => micBtnRef.current?.offsetParent != null,
    })
  }, [dockOpen])

  if (!dockDeskId || dockMinimized || !desk) return null

  // Revezamento (entrega 1): só quando NÃO há turno em voo e a conversa está sã
  // — o último pedido pendente vira o prompt do novo provedor (continueInAgent,
  // send.ts). null ⇒ os itens limit/error só mostram a mensagem, sem ação.
  const rev: RevContext | null =
    !turnActive && convId && project && !conv.corrupt
      ? {
          currentAgent: desk.agent,
          onPick: (target) =>
            pickRevezamento(
              // continueInAgent tipa `agent` como OfficeAgentId; a costura
              // testável (recovery.ts) usa `string`. O valor real é sempre o
              // desk.agent (OfficeAgentId), então a ponte é segura.
              { continueInAgent: (a, t) => continueInAgent(a as DeskSendArgs, t) },
              {
                convId,
                projectId: desk.projectId,
                projectPath: project.path,
                agent: desk.agent,
                text: "",
              },
              target,
            ),
        }
      : null

  async function handleSend() {
    const text = draft.trim()
    // missionActive: UX espelha a guarda real do send.ts (missão manda na conv)
    if (!text || !convId || !desk || !project || conv.corrupt || missionActive)
      return
    // Modelo do seletor do cabeçalho: só vale na conversa DESTRAVADA (1º run);
    // "default" ⇒ null (default do agent). Conversa travada ignora (send.ts usa
    // o modelo do 1º run).
    await sendFromDesk({
      convId,
      projectId: desk.projectId,
      projectPath: project.path,
      agent: desk.agent,
      text,
      model: modelChoice === "default" ? null : modelChoice,
      effort: effortChoice === "default" ? null : effortChoice,
      onAccepted: () => {
        setDeskDraft(convId, "")
        useOfficeUi.getState().sayAsBoss(text)
      },
    })
  }

  async function toggleMic() {
    if (micBusy || !desk) return
    const ui = useOfficeUi.getState()
    setMicBusy(true)
    try {
      if (ui.recording) {
        // Texto FINAL cai no composer pra revisão — Enter envia (§5.5).
        // recording=false chega pelo onDictationEnded (stop emite sempre).
        const text = (await stopDictation()).trim()
        if (text && convId)
          setDeskDraft(convId, draft.trim() ? `${draft.replace(/\s+$/, "")} ${text}` : text)
      } else {
        const vocab = [agentLabel(desk.agent), project?.name].filter(
          (v): v is string => !!v,
        )
        await startDictation(vocab)
        ui.setRecording(true)
      }
    } catch {
      // start recusado (mic global/fora do Tauri): o store nunca ligou;
      // falha no stop já soltou o espelho via onDictationEnded.
    } finally {
      setMicBusy(false)
    }
  }

  function requestClose() {
    useOfficeUi.getState().closeOrMinimizeDock(dockLeaveCtx(convId))
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    } else if (e.key === "Escape") {
      e.preventDefault()
      // Padrão de chat de jogo: com o foco no composer, o 1º Esc só DEVOLVE o
      // teclado ao escritório (blur) — sem isso o foco fica preso na textarea
      // e WASD nunca volta a andar ("travado com o dock aberto"). Gravando,
      // Esc segue cancelando o ditado (officeEscape). O 2º Esc, já fora do
      // campo, cai no input.ts da engine → officeEscape minimiza/fecha.
      if (useOfficeUi.getState().recording) officeEscape()
      else e.currentTarget.blur()
    }
  }

  return (
    <aside
      className="pointer-events-auto absolute top-11 right-0 bottom-6 z-30 flex flex-col border-l border-border bg-card shadow-xl transition-[width] motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out"
      style={{ width: activeDockWidth(dockWide) }}
      aria-label={`Conversa com ${agentLabel(desk.agent)}`}
    >
      {/* cabeçalho: retrato do agent / projeto / ATIVIDADE ao vivo */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3">
        <AgentPortrait agent={desk.agent} state={snap?.desk.state} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {agentLabel(desk.agent)}
          </p>
          {missionActive && missionView ? (
            // Fase de missão nesta mesa ⇒ cabeçalho contextual da missão.
            <p className="truncate text-[11px] text-st-running">
              {missionPanelSubtitle(missionView)}
            </p>
          ) : turnActive && conv.startedAt ? (
            // Turno rodando ⇒ linha de estado vira ATIVIDADE viva: ferramenta
            // corrente (detail do snapshot) + tempo decorrido (tick de 1s).
            <p className="truncate text-[11px] text-st-running">
              ⚙ {snap?.desk.detail ?? snap?.desk.label ?? "Trabalhando"} ·{" "}
              <ElapsedSince since={conv.startedAt} />
            </p>
          ) : (
            <p className="truncate text-[11px] text-muted-foreground">
              {snap?.room.name ?? project?.name ?? desk.projectId}
              {" · "}
              {snap?.desk.detail ?? snap?.desk.label ?? "Disponível"}
              {modelLabel && ` · ${modelLabel}`}
            </p>
          )}
        </div>
        {turnActive && convId && (
          <button
            type="button"
            title="Parar o turno"
            aria-label="Parar o turno"
            onClick={() => void cancelDeskTurn(convId)}
            className="rounded-md p-1.5 text-st-error transition-colors hover:bg-secondary"
          >
            <Square className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Minimizar pro chip"
          aria-label="Minimizar conversa"
          onClick={() => useOfficeUi.getState().minimizeDock()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Fechar (com rascunho ou turno ativo, minimiza)"
          aria-label="Fechar conversa"
          onClick={requestClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>

      {/* seletor de próximo turno some em modo missão (envio bloqueado) */}
      {!missionActive && (
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3">
        <span className="label-mono mr-1">Próximo turno</span>
        {models.length > 0 && (
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground/70 uppercase">Modelo</span>
            <RichSelect
              value={effectiveModel}
              onValueChange={setModelChoice}
              options={models}
              disabled={configLocked}
              aria-label="Modelo do próximo turno"
              title={configLocked ? "Modelo fixado no primeiro envio" : "Modelo do próximo turno"}
              triggerClassName="h-7 max-w-[92px] px-1 text-muted-foreground"
            />
          </div>
        )}
        {efforts.length > 0 && (
          <div className="flex items-center gap-0.5">
            <span className="text-[9px] text-muted-foreground/70 uppercase">Raciocínio</span>
            <RichSelect
              value={effectiveEffort}
              onValueChange={setEffortChoice}
              options={efforts}
              disabled={configLocked}
              align="end"
              aria-label="Esforço de raciocínio do próximo turno"
              title={configLocked ? "Esforço fixado no primeiro envio" : "Esforço de raciocínio"}
              triggerClassName="h-7 max-w-[82px] px-1 text-muted-foreground"
            />
          </div>
        )}
        {configLocked && (
          <Lock
            className="ml-auto size-3 text-muted-foreground/60"
            aria-label="Modelo e esforço fixados nesta conversa"
          />
        )}
      </div>
      )}

      {/* histórico — ou o PAINEL DE MISSÃO quando a mesa executa uma fase */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {missionActive && missionView ? (
          <DeskMissionPanel
            view={missionView}
            gate={missionGate}
            onAnswerGate={(a) => answerDeskGate(missionView.convId, a)}
            // só missão LANÇADA DA MESA DE REUNIÃO abre lá (o MissionDock
            // rastreia missionTableConvId; para missões do Trabalho ele
            // mostraria o formulário vazio)
            onOpenTable={
              useOfficeUi.getState().missionTableConvId === missionView.convId
                ? () => useOfficeUi.getState().openDock(MISSION_TABLE_ID)
                : undefined
            }
            onStop={() => abortTableMission(missionView.convId)}
          />
        ) : (
        <>
        {!conv.exists && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            Abrindo a conversa da mesa…
          </div>
        )}
        {conv.corrupt && (
          <p className="mb-2 rounded-md border border-st-error/50 bg-st-error/10 px-2.5 py-1.5 text-[12px] text-st-error">
            Conversa corrompida no banco — envio bloqueado.
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          <DockItemsList
            convId={convId}
            rev={rev}
            showAll={showAllItems}
            onShowAll={() => setShowAllItems(true)}
            scrollRef={listRef}
          />
          {conv.empty && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] text-muted-foreground">
                Mesa de {agentLabel(desk.agent)}. Diga o que precisa — o turno
                roda de verdade no projeto.
              </p>
              {/* vazio inicial = chips de sugestão que PREENCHEM o composer */}
              <div className="flex flex-wrap gap-1.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                {SUGGESTION_CHIPS.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => convId && setDeskDraft(convId, sug)}
                    className="rounded-full border border-border bg-background px-2.5 py-1 text-[12px] text-foreground/80 transition-colors hover:border-brass/60 hover:text-foreground"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          )}
          {gate && convId && (
            <GateCard
              gate={gate}
              convId={convId}
              onAnswer={(a) => answerDeskGate(convId, a)}
            />
          )}
          {conv.pendingPlan && !turnActive && convId && (
            <PlanCard
              onApprove={() => {
                if (!desk || !project) return
                // Paridade com handleApprovePlan: prepara (limpa pendingPlan +
                // desliga plan_first) e ENVIA pelo caminho da mesa.
                const prompt = approveDeskPlan(convId)
                if (!prompt) return
                void sendFromDesk({
                  convId,
                  projectId: desk.projectId,
                  projectPath: project.path,
                  agent: desk.agent,
                  text: prompt,
                })
              }}
              onDiscard={() => discardDeskPlan(convId)}
            />
          )}
        </div>
        </>
        )}
      </div>

      {/* composer — o pill de gravação PAIRA acima (overlay absoluto, zero
          reflow: o composer não mexe um pixel durante o ditado) */}
      <div className="relative shrink-0 border-t border-border p-2">
        <DictationOverlay
          active={recording}
          partial={partial}
          since={recordingSince ?? Date.now()}
          className="absolute inset-x-2 bottom-full mb-2"
        />
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => convId && setDeskDraft(convId, e.target.value)}
            onKeyDown={onComposerKey}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            rows={2}
            disabled={!convId || conv.corrupt || missionActive}
            placeholder={
              missionActive
                ? "Missão em andamento…"
                : `Mensagem para ${agentLabel(desk.agent)}…`
            }
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
          />
          <button
            ref={micBtnRef}
            type="button"
            title={
              recording
                ? "Parar e revisar (Esc cancela)"
                : hotkey
                  ? `Ditar (${formatHotkey(hotkey)})`
                  : "Ditar"
            }
            onClick={() => void toggleMic()}
            disabled={!convId || micBusy || missionActive}
            className={cn(
              "rounded-md border border-border p-2 transition-colors hover:bg-secondary disabled:opacity-50",
              recording
                ? "text-st-error motion-safe:animate-pulse"
                : "text-muted-foreground",
            )}
          >
            {micBusy ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Mic className="size-4" />
            )}
          </button>
          <button
            type="button"
            title={turnActive ? "Enfileirar pro fim do turno" : "Enviar"}
            onClick={() => void handleSend()}
            disabled={!convId || !draft.trim() || conv.corrupt || missionActive}
            className="rounded-md bg-brass p-2 text-brass-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        {missionActive && (
          <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
            Missão em andamento — envie pela missão ou aguarde.
          </p>
        )}
        {turnActive && !missionActive && (
          <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
            Turno em andamento — Enter enfileira e envia quando terminar.
          </p>
        )}
        {composerFocused && (
          <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
            Esc devolve o teclado ao escritório (WASD anda) · Enter envia
          </p>
        )}
        {conv.autoResume && (
          <AutoResumeLine
            nextAt={conv.autoResume.nextAt}
            tries={conv.autoResume.tries}
            maxTries={conv.autoResume.maxTries}
          />
        )}
      </div>
    </aside>
  )
}
