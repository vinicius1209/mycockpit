import { useEffect, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"
import { toast } from "sonner"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject } from "@/store/app"
import { useChat, useActiveConv } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { FusionBoard } from "@/components/fusion/FusionBoard"
import { runAgent, cancelAgent } from "@/lib/agent"
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

  // Abre o projeto ao trocar: carrega as conversas e a mais recente (Sprint 2).
  const projectId = project?.id ?? null
  useEffect(() => {
    void openProject(projectId)
  }, [projectId, openProject])

  // Autoscroll conforme a conversa cresce, MAS só se você já está no fim (senão
  // ler mensagens antigas seria interrompido a cada evento).
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [items.length, running, atBottom])

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
    // bloqueia se rodando OU finalizando, o processo do CLI precisa sair de fato
    // (flush da sessão) antes do próximo run, senão o resume não acha a sessão.
    if (conv?.running || conv?.finalizing) return
    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    useChat.getState().invalidateSuggestions(convId)
    // conversa estabelecida trava no agent/modelo/effort do 1º run; nova usa o seletor
    const locked = conv != null && conv.items.length > 0
    const agent = locked ? conv!.agent : (cfg?.agent ?? "claude-code")
    const model = locked ? conv!.reqModel : (cfg?.model ?? null)
    const effort = locked ? conv!.effort : (cfg?.effort ?? null)
    const runId = crypto.randomUUID()
    const sessionId = conv?.sessionId ?? null
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
        project.path,
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
      useChat.getState().scheduleSuggestions(convId)
    }
  }

  function handleStop() {
    const convId = useChat.getState().activeId
    const runId = convId ? useChat.getState().byId[convId]?.runId : null
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
        className="relative flex-1 overflow-y-auto"
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
