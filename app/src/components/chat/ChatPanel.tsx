import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ChevronDown, ListChecks, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { deriveTasks } from "@/lib/tasks"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject } from "@/store/app"
import { useChat, useActiveConv } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { FusionBoard } from "@/components/fusion/FusionBoard"
import { runAgent, cancelAgent, agentLabel } from "@/lib/agent"
import { buildHandoff } from "@/lib/handoff"
import { notifyTurnEnd } from "@/lib/notify"
import type { Attachment } from "@/lib/attachments"
import { gcAttachments } from "@/lib/attachments"
import { BYTES_PER_MB } from "@/lib/format"
import type { AgentRunConfig } from "@/lib/types"
import { isTauri, listConvRefs } from "@/lib/db"

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

export function ChatPanel() {
  const project = useActiveProject()
  const conv = useActiveConv()
  const openProject = useChat((s) => s.openProject)
  const scrollRef = useRef<HTMLDivElement>(null)
  // segue o fim só quando você já está lá; se subiu pra ler, não puxa de volta.
  const [atBottom, setAtBottom] = useState(true)

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setAtBottom(true)
  }

  const items = conv.items
  const running = conv.running
  const finalizing = conv.finalizing
  const activeId = useChat((s) => s.activeId)
  const fusionActive = useFusion((s) => (activeId ? !!s.byConv[activeId] : false))

  // Checklist viva (P2): faixa fixa acima do composer enquanto o plano anda,
  // o olho já mora aqui embaixo durante o run. Colapsada mostra a task atual.
  const tasks = useMemo(() => deriveTasks(items), [items])
  const doneTasks = tasks.filter((t) => t.status === "completed").length
  const openTasks = tasks.length - doneTasks
  const currentTask =
    tasks.find((t) => t.status === "in_progress") ??
    tasks.find((t) => t.status === "pending")
  const [planOpen, setPlanOpen] = useState(false)
  const showPlan = tasks.length > 0 && (running || openTasks > 0)

  // Abre o projeto ao trocar: carrega as conversas e a mais recente (Sprint 2).
  const projectId = project?.id ?? null
  useEffect(() => {
    void openProject(projectId)
  }, [projectId, openProject])

  // Autoscroll conforme a conversa cresce, MAS só se você já está no fim (senão
  // ler mensagens antigas seria interrompido a cada evento). O "tick" do
  // streaming entra nas deps: items.length não muda a cada text_delta, sem ele
  // o follow morria em respostas longas (achado do aval).
  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
  }, [items.length, streamTick, running, atBottom])

  // Ao trocar de conversa, volta a seguir o fim (a nova abre no rodapé).
  useEffect(() => {
    setAtBottom(true)
  }, [activeId])

  // ⌘K (ou outra UI) pode enfileirar um prompt → dispara aqui.
  const queuedPrompt = useChat((s) => s.queuedPrompt)
  useEffect(() => {
    if (!queuedPrompt) return
    const text = queuedPrompt
    useChat.getState().queuePrompt(null)
    void handleSend(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt])

  // GC dos anexos no boot (throttled 1×/24h no backend). F1: só roda se as refs
  // vierem não-null (null = falha → não arrisca o orphan-sweep com lista vazia).
  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      const refs = await listConvRefs()
      if (!refs) return
      try {
        const r = await gcAttachments(refs)
        if (r.freed_bytes > 0) {
          toast(
            `Cache de anexos: ${(r.freed_bytes / BYTES_PER_MB).toFixed(1)} MB liberados`,
          )
        }
      } catch {
        // GC é best-effort
      }
    })()
  }, [])

  // Caso 2, restaura uma disputa de Fusion PENDENTE (esperando decisão) ao abrir
  // a conversa, pra não perder o que já rodou + foi pago.
  useEffect(() => {
    if (!activeId || !isTauri()) return
    void useFusion.getState().restorePending(activeId)
  }, [activeId])

  // destinationId = o agent escolhido no seletor (v0.2-α: o seam que descartava
  // o destino agora é threadado até o runAgent). Default 'claude-code'.
  async function handleSend(
    text: string,
    cfg?: AgentRunConfig,
    attachments: Attachment[] = [],
  ) {
    if (!project) return
    if (!isTauri()) {
      toast("O dispatch dos agents roda no app (bun run tauri dev)")
      return
    }
    const convId = useChat.getState().activeId
    if (!convId) return
    const conv = useChat.getState().byId[convId]
    // conversa ainda carregando do disco (janela do switch): enviar agora
    // criaria um estado vazio e o persist apagaria o histórico (achado 1 do aval).
    if (!conv) {
      toast("Conversa ainda carregando. Tenta de novo.")
      return
    }
    if (conv.corrupt) {
      toast.error("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
      return
    }
    // Rodando/finalizando: em vez de descartar, ENFILEIRA. O CLI precisa sair de
    // fato (flush da sessão) antes do próximo run; ao terminar, o finally junta as
    // pendentes num único envio (resume). Coalescer evita N resumes em sequência.
    if (conv?.running || conv?.finalizing) {
      useChat.getState().enqueue(convId, text)
      return
    }
    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    useChat.getState().invalidateSuggestions(convId)
    // conversa estabelecida trava no agent/modelo/effort do 1º run; nova usa o seletor
    const locked = conv != null && conv.items.length > 0
    const agent = locked ? conv!.agent : (cfg?.agent ?? "claude-code")
    const model = locked ? conv!.reqModel : (cfg?.model ?? null)
    const effort = locked ? conv!.effort : (cfg?.effort ?? null)
    const runId = crypto.randomUUID()
    const sessionId = conv?.sessionId ?? null
    // cwd = worktree isolado da conversa (v2.5), senão a pasta compartilhada do projeto.
    const cwd = conv?.worktreePath ?? project.path
    // Sprint 4, o run escreve em byId[convId] mesmo se o usuário trocar de aba.
    useChat.getState().start(convId, text, runId, agent, model, effort, attachments)
    setAtBottom(true) // ao enviar, pula pro fim (ver a própria mensagem)
    try {
      await runAgent(
        runId,
        convId,
        agent,
        model,
        effort,
        text,
        cwd,
        sessionId,
        project.permissionMode ?? "padrao",
        attachments,
        (e) => useChat.getState().handleEvent(convId, e),
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao executar o agent")
    } finally {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
      // Fila: junta as mensagens digitadas durante o turno num ÚNICO envio (resume).
      // Se há fila, o próximo turno já começa; senão, agenda as sugestões.
      const pending = useChat.getState().dequeueQueued(convId)
      if (pending.length > 0) {
        void handleSend(pending.join("\n\n"))
      } else {
        // turno (e a fila) concluídos → notifica + sugestões.
        notifyTurnEnd(convId, agent)
        useChat.getState().scheduleSuggestions(convId)
      }
    }
  }

  // Revezamento: continua a MESMA conversa em OUTRO agent (limite/erro do
  // atual). O contexto vai por preâmbulo determinístico (handoff, tail-biased);
  // o disco (cwd/worktree) o novo agent herda de graça; o pedido pendente (o
  // último prompt do usuário) é reenviado sem redigitar.
  async function handleContinueWith(target: string) {
    if (!project || !isTauri()) return
    const convId = useChat.getState().activeId
    if (!convId) return
    const conv = useChat.getState().byId[convId]
    if (!conv || conv.running || conv.finalizing || conv.corrupt) return
    let lastUserIdx = -1
    for (let i = conv.items.length - 1; i >= 0; i--) {
      if (conv.items[i].kind === "user") {
        lastUserIdx = i
        break
      }
    }
    const lastUser = lastUserIdx >= 0 ? conv.items[lastUserIdx] : null
    const pending = lastUser && lastUser.kind === "user" ? lastUser.text : ""
    if (!pending) return
    // o handoff exclui o pedido pendente (ele volta destacado no fim do prompt)
    const preamble = buildHandoff(conv.items.slice(0, lastUserIdx))
    const prompt = `${preamble}\n\n---\n\nPedido pendente (responda a ele agora):\n${pending}`
    const runId = crypto.randomUUID()
    useChat.getState().invalidateSuggestions(convId)
    useChat.getState().handleEvent(convId, {
      type: "notice",
      message: `revezamento: continuando no ${agentLabel(target)}`,
    })
    useChat.getState().beginTransplant(convId, runId, target)
    setAtBottom(true)
    const cwd = conv.worktreePath ?? project.path
    try {
      await runAgent(
        runId,
        convId,
        target,
        null,
        null,
        prompt,
        cwd,
        null, // sessão fresca no novo agent
        project.permissionMode ?? "padrao",
        [],
        (e) => useChat.getState().handleEvent(convId, e),
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no revezamento")
    } finally {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
      notifyTurnEnd(convId, target)
      useChat.getState().scheduleSuggestions(convId)
    }
  }

  function handleStop() {
    const convId = useChat.getState().activeId
    if (!convId) return
    // Disputa Fusion em voo: o Stop era no-op silencioso (runId null) enquanto
    // N candidatos queimavam dinheiro. Agora aborta a disputa de verdade.
    const fusion = useFusion.getState().byConv[convId]
    if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
      useFusion.getState().abort(convId)
      toast("Disputa cancelada")
      return
    }
    const runId = useChat.getState().byId[convId]?.runId
    if (runId) void cancelAgent(runId)
  }

  const hasConversation = items.length > 0
  const greeting = greetingFor(new Date())

  return (
    <section className="relative flex h-full w-full min-w-0 flex-col bg-background">
      {!hasConversation && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(62%_80%_at_50%_100%,var(--brass-soft),transparent_72%)] opacity-70" />
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-x-hidden overflow-y-auto"
      >
        {hasConversation ? (
          // key no activeId → o fade só replica ao TROCAR de conversa (não a cada
          // token do streaming, que mantém o mesmo activeId).
          <div
            key={activeId ?? "none"}
            className="animate-in fade-in-0 duration-300 ease-out"
          >
            <MessageList
              items={items}
              running={running}
              finalizing={finalizing}
              startedAt={conv.startedAt}
              agent={conv.agent}
              onContinueWith={(a) => void handleContinueWith(a)}
            />
          </div>
        ) : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 py-10">
            <div className="animate-cockpit-rise text-center">
              <Reticle className="mx-auto mb-6 size-8" />
              <h1 className="text-[38px] font-medium leading-[1.1] tracking-[-0.025em] text-foreground">
                {greeting}, Vinícius.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                {project
                  ? `Descreva uma tarefa para seu time de agents em ${project.name}.`
                  : "Selecione ou adicione um projeto na barra lateral para começar."}
              </p>
              <p className="mt-4 text-[12px] text-muted-foreground/70">
                <kbd className="rounded border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>{" "}
                para comandos e navegação
              </p>
            </div>
          </div>
        )}
        {activeId && fusionActive && <FusionBoard convId={activeId} />}
      </div>

      <div className="relative z-10 shrink-0 px-8 pb-7">
        {hasConversation && !atBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute -top-2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-[12px] text-foreground shadow-[var(--shadow-pop)] backdrop-blur transition-colors hover:bg-accent"
          >
            <ArrowDown className="size-3.5" /> Rolar pro fim
          </button>
        )}
        {showPlan && (
          <div className="mx-auto mb-2 max-w-[760px]">
            <div className="overflow-hidden rounded-lg border bg-card/95 shadow-[var(--shadow-pop)]">
              <button
                onClick={() => setPlanOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]"
              >
                {openTasks > 0 && running ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-brass" />
                ) : (
                  <ListChecks className="size-3.5 shrink-0 text-brass" />
                )}
                <span className="truncate text-foreground/85">
                  {currentTask
                    ? currentTask.status === "in_progress" && currentTask.active
                      ? currentTask.active
                      : currentTask.title
                    : "Plano concluído"}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {doneTasks}/{tasks.length}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    planOpen && "rotate-180",
                  )}
                />
              </button>
              {planOpen && (
                <div className="max-h-56 overflow-y-auto border-t px-3 py-2">
                  <TaskChecklist tasks={tasks} dense />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-[760px]">
          <CommandConsole
            onSend={handleSend}
            disabled={!project}
            running={running}
            finalizing={finalizing}
            onStop={handleStop}
          />
        </div>
      </div>
    </section>
  )
}
