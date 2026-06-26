import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { runClaude, cancelClaude } from "@/lib/agent"
import { isTauri, loadConversation, saveConversation } from "@/lib/db"

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

export function ChatPanel() {
  const project = useActiveProject()
  const items = useChat((s) => s.items)
  const running = useChat((s) => s.running)
  const resetFor = useChat((s) => s.resetFor)
  const hydrate = useChat((s) => s.hydrate)
  const start = useChat((s) => s.start)
  const handleEvent = useChat((s) => s.handleEvent)
  const finish = useChat((s) => s.finish)
  const scrollRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef<string | null>(null)

  // Reseta a conversa ao trocar de projeto (M4 persiste por projeto).
  const projectId = project?.id ?? null
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (projectId && isTauri()) {
        const conv = await loadConversation(projectId)
        if (cancelled) return
        if (conv) {
          hydrate(projectId, conv.items, conv.sessionId)
          return
        }
      }
      if (!cancelled) resetFor(projectId)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, resetFor, hydrate])

  // Autoscroll conforme a conversa cresce.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [items.length, running])

  async function handleSend(text: string) {
    if (!project) return
    if (!isTauri()) {
      toast("O dispatch do Claude Code roda no app (bun run tauri dev)")
      return
    }
    const runId = crypto.randomUUID()
    runIdRef.current = runId
    start(text)
    try {
      await runClaude(
        runId,
        text,
        project.path,
        useChat.getState().sessionId,
        project.permissionMode ?? "padrao",
        handleEvent,
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao executar o agent")
    } finally {
      runIdRef.current = null
      finish()
      const s = useChat.getState()
      void saveConversation(project.id, s.sessionId, s.items)
    }
  }

  function handleStop() {
    if (runIdRef.current) void cancelClaude(runIdRef.current)
  }

  const hasConversation = items.length > 0
  const greeting = greetingFor(new Date())

  return (
    <section className="relative flex h-full w-full min-w-0 flex-col bg-background">
      {!hasConversation && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(62%_80%_at_50%_100%,var(--brass-soft),transparent_72%)] opacity-70" />
      )}

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {hasConversation ? (
          <MessageList items={items} running={running} />
        ) : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 py-10">
            <div className="animate-cockpit-rise text-center">
              <Reticle className="mx-auto mb-6 size-8" />
              <h1 className="text-[38px] font-medium leading-[1.1] tracking-[-0.025em] text-foreground">
                {greeting}, Vinícius.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                {project
                  ? `Abra um chat e coloque seu time de agents para trabalhar em ${project.name}.`
                  : "Selecione ou adicione um projeto na barra lateral para começar."}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="relative z-10 shrink-0 px-6 pb-6">
        <div className="mx-auto max-w-[760px]">
          <CommandConsole
            onSend={handleSend}
            disabled={!project}
            running={running}
            onStop={handleStop}
          />
        </div>
      </div>
    </section>
  )
}
