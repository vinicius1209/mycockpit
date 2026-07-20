// Dock da mesa (§5.4) — painel direito OPACO (sem backdrop-blur sobre canvas
// vivo, §6), 380px, chrome do design system. Histórico + streaming chegam
// pelo próprio useChat (handleEvent do bridge/send.ts escreve em byId[convId]);
// aqui só se lê via bridge/hooks. Fechar aplica §5.4: draft ou turno ativo ⇒
// minimiza pro chip do HUD; senão fecha. Nunca descarta draft em silêncio.
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import {
  ArrowRightLeft,
  ArrowUp,
  ClipboardList,
  Loader2,
  Mic,
  Minus,
  Square,
  Wrench,
  X,
} from "lucide-react"
import { Markdown } from "@/components/common/Markdown"
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
  modelsFor,
  officeProjectById,
  setDeskDraft,
  useDeskConversation,
  useDeskDraft,
  useDeskGate,
  fmtCost,
  type ChatItem,
  type MissionGate,
} from "../bridge/hooks"
import {
  continueInAgent,
  ensureDeskConversation,
  sendFromDesk,
  cancelDeskTurn,
  type DeskSendArgs,
} from "../bridge/send"
import { pickRevezamento, revezamentoTargets } from "./recovery"
import {
  onDictationEnded,
  onDictationPartial,
  startDictation,
  stopDictation,
} from "../bridge/voice"
import { ElapsedSince } from "./DeskMenu"
import { officeEscape, useOfficeUi } from "./store"

/** Largura do painel (o OfficeMode usa o mesmo valor pro screenOffset). */
export const DOCK_W = 380

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

function DockItem({ item, rev }: { item: ChatItem; rev?: RevContext | null }) {
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
        <p className="text-[11px] text-muted-foreground">
          Turno concluído{item.costUsd ? ` · ${fmtCost(item.costUsd, item.costSource)}` : ""}
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
}

// --- gate de missão ---------------------------------------------------------

/** Card de gate humano da missão — exportado: o MissionDock (mesa de reunião)
 *  reusa o MESMO card (fonte única de resposta = answerGate via bridge). */
export function GateCard({
  gate,
  onAnswer,
}: {
  gate: MissionGate
  onAnswer: (answers: string[]) => void
}) {
  const [answers, setAnswers] = useState<string[]>(() =>
    gate.questions.map(() => ""),
  )
  // Gate novo (outra fase) ⇒ zera as respostas.
  useEffect(() => setAnswers(gate.questions.map(() => "")), [gate])

  return (
    <div className="rounded-lg border border-st-warning/50 bg-st-warning/10 p-3">
      <p className="mb-2 text-[12px] font-semibold text-st-warning">
        A missão precisa de você (fase {gate.phase + 1})
      </p>
      <div className="flex flex-col gap-2">
        {gate.questions.map((q, i) => (
          <label key={i} className="flex flex-col gap-1">
            <span className="text-[12px] leading-snug text-foreground/90">{q}</span>
            <input
              value={answers[i] ?? ""}
              onChange={(e) =>
                setAnswers((cur) => cur.map((a, j) => (j === i ? e.target.value : a)))
              }
              placeholder="Em branco = o agente decide"
              className="rounded-md border border-input bg-background px-2 py-1.5 text-[13px] outline-none focus:border-ring"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onAnswer(answers)}
        className="mt-2.5 w-full rounded-md bg-brass px-3 py-1.5 text-[13px] font-medium text-brass-foreground transition-opacity hover:opacity-90"
      >
        Responder e retomar
      </button>
    </div>
  )
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
  const partial = useOfficeUi((s) => s.dictationPartial)

  const conv = useDeskConversation(convId)
  const draft = useDeskDraft(convId)
  const gate = useDeskGate(convId)

  const listRef = useRef<HTMLDivElement>(null)
  const [micBusy, setMicBusy] = useState(false)
  const [composerFocused, setComposerFocused] = useState(false)
  // Modelo escolhido pro PRÓXIMO envio (entrega 2). Vale só nesta mesa; trocar
  // de AGENT é via revezamento/andar até outra mesa (não há seletor de agent
  // aqui de propósito). Semente = default do agent; re-semeado ao trocar de
  // mesa (effect abaixo). NOTA: o envio ainda não consome — ver comentário no
  // handleSend (DeskSendArgs precisa do campo `model`, fase motor).
  const [modelChoice, setModelChoice] = useState<string>("default")

  // Mesa de reunião (O-2) não é mesa de agent: o MissionDock assume — aqui o
  // parse viraria projectId "commons"/agent "mission" e o effect abaixo
  // registraria uma conversa órfã via ensureDeskConversation.
  const isMissionTable = dockDeskId === MISSION_TABLE_ID
  const desk = dockDeskId && !isMissionTable ? parseDeskId(dockDeskId) : null
  const snap = dockDeskId
    ? findDeskSnapshot(snapshot?.rooms ?? [], dockDeskId)
    : null
  const project = desk ? officeProjectById(desk.projectId) : undefined
  const turnActive = !!conv && (conv.running || conv.finalizing)

  // Modelos do agent da mesa pro seletor do cabeçalho (vazio = agent sem flag
  // de modelo ⇒ sem seletor).
  const deskAgent = desk?.agent
  const models = deskAgent ? modelsFor(deskAgent) : []
  const modelLabel =
    models.find((m) => m.value === modelChoice)?.pill ??
    models.find((m) => m.value === modelChoice)?.label ??
    null
  // Re-semeia o modelo ao trocar de mesa (o agent muda) — cada mesa lembra o
  // default do seu agent até o usuário escolher outro.
  useEffect(() => {
    if (deskAgent) setModelChoice(defaultModelForAgent(deskAgent))
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

  // Autoscroll pro fim quando o histórico muda (streaming incluso: cada
  // handleEvent troca a identidade de items).
  const items = conv?.items
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  if (!dockDeskId || dockMinimized || !desk) return null

  // Revezamento (entrega 1): só quando NÃO há turno em voo e a conversa está sã
  // — o último pedido pendente vira o prompt do novo provedor (continueInAgent,
  // send.ts). null ⇒ os itens limit/error só mostram a mensagem, sem ação.
  const rev: RevContext | null =
    !turnActive && convId && project && !conv?.corrupt
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
    if (!text || !convId || !desk || !project || conv?.corrupt) return
    setDeskDraft(convId, "")
    // Fala na cena (§5.4 v2): a mensagem vira balão curto sobre o BOSS (~3s).
    // Só envios digitados aqui — fila/auto-resume/plano não são fala do boss.
    useOfficeUi.getState().sayAsBoss(text)
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
      className="pointer-events-auto absolute top-11 right-0 bottom-6 z-30 flex flex-col border-l border-border bg-card shadow-xl motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out"
      style={{ width: DOCK_W }}
      aria-label={`Conversa com ${agentLabel(desk.agent)}`}
    >
      {/* cabeçalho: retrato do agent / projeto / ATIVIDADE ao vivo */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3">
        <AgentPortrait agent={desk.agent} state={snap?.desk.state} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {agentLabel(desk.agent)}
          </p>
          {turnActive && conv?.startedAt ? (
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
        {/* seletor de MODELO (entrega 2): vale pro próximo envio nesta mesa.
            Habilitado sempre; trocar de AGENT é via revezamento/andar até outra
            mesa (não há seletor de agent aqui — daí o tooltip). */}
        {models.length > 0 && (
          <label
            className="shrink-0"
            title="Modelo do próximo envio nesta mesa. Para trocar de agente, use o revezamento (após um limite/erro) ou vá até a mesa de outro agente."
          >
            <span className="sr-only">Modelo do próximo envio</span>
            <select
              value={modelChoice}
              onChange={(e) => setModelChoice(e.target.value)}
              className="max-w-[92px] rounded-md border border-input bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus:border-ring"
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.pill ?? m.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {turnActive && convId && (
          <button
            type="button"
            title="Parar o turno"
            onClick={() => void cancelDeskTurn(convId)}
            className="rounded-md p-1.5 text-st-error transition-colors hover:bg-secondary"
          >
            <Square className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Minimizar pro chip"
          onClick={() => useOfficeUi.getState().minimizeDock()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Fechar (com rascunho ou turno ativo, minimiza)"
          onClick={requestClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>

      {/* histórico */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!conv && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            Abrindo a conversa da mesa…
          </div>
        )}
        {conv?.corrupt && (
          <p className="mb-2 rounded-md border border-st-error/50 bg-st-error/10 px-2.5 py-1.5 text-[12px] text-st-error">
            Conversa corrompida no banco — envio bloqueado.
          </p>
        )}
        <div className="flex flex-col gap-2.5">
          {conv?.items.map((item, i) => (
            // Revezamento só no ÚLTIMO item (limit/error): continueInAgent age
            // sobre o último pedido pendente da conversa — uma linha de ação
            // por item histórico seria ruído (todas fariam o mesmo).
            <DockItem
              key={item.id}
              item={item}
              rev={i === (conv.items.length - 1) ? rev : null}
            />
          ))}
          {conv && conv.items.length === 0 && (
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
            <GateCard gate={gate} onAnswer={(a) => answerDeskGate(convId, a)} />
          )}
          {conv?.pendingPlan && !turnActive && convId && (
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
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-border p-2">
        {recording && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-st-running/40 bg-background px-2.5 py-1.5 text-[12px]">
            <span className="size-1.5 shrink-0 rounded-full bg-st-error motion-safe:animate-pulse" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {partial?.trim() ? partial : "Ouvindo…"}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground uppercase">
              Esc cancela
            </span>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => convId && setDeskDraft(convId, e.target.value)}
            onKeyDown={onComposerKey}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            rows={2}
            disabled={!convId || conv?.corrupt}
            placeholder={`Mensagem para ${agentLabel(desk.agent)}…`}
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-input bg-background px-2.5 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-50"
          />
          <button
            type="button"
            title={recording ? "Parar e revisar" : "Ditar (pt-BR, local)"}
            onClick={() => void toggleMic()}
            disabled={!convId || micBusy}
            className={cn(
              "rounded-md border border-border p-2 transition-colors hover:bg-secondary disabled:opacity-50",
              recording ? "text-st-error" : "text-muted-foreground",
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
            disabled={!convId || !draft.trim() || conv?.corrupt}
            className="rounded-md bg-brass p-2 text-brass-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        {turnActive && (
          <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
            Turno em andamento — Enter enfileira e envia quando terminar.
          </p>
        )}
        {composerFocused && (
          <p className="mt-1 px-0.5 text-[11px] text-muted-foreground">
            Esc devolve o teclado ao escritório (WASD anda) · Enter envia
          </p>
        )}
        {conv?.autoResume && (
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
