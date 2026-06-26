import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import type { ChatItem } from "@/store/chat"
import { runClaude, cancelClaude, suggest } from "@/lib/agent"
import { isTauri } from "@/lib/db"

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

// Sprint 3 — sugestões dinâmicas via modelo auxiliar.
const SUGGEST_PROMPT = `Você sugere as PRÓXIMAS AÇÕES úteis para o usuário continuar este trabalho de desenvolvimento, com base na conversa abaixo.

Responda APENAS com um array JSON de até 3 strings curtas (máx 6 palavras cada), em pt-BR, acionáveis e específicas ao contexto. Nada além do JSON.
Exemplo: ["Rodar os testes do módulo","Fazer o commit pendente","Documentar a função nova"]`

function buildContext(items: ChatItem[]): string {
  const lines: string[] = []
  for (const it of items.slice(-6)) {
    if (it.kind === "user") lines.push(`Usuário: ${it.text}`)
    else if (it.kind === "text")
      lines.push(`Assistente: ${it.text.slice(0, 1200)}`)
    else if (it.kind === "tool") lines.push(`(ferramenta: ${it.name})`)
  }
  return lines.join("\n").slice(-4000)
}

function parseSuggestions(raw: string): string[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr: unknown = JSON.parse(m[0])
    if (Array.isArray(arr)) {
      return arr.filter((x): x is string => typeof x === "string").slice(0, 3)
    }
  } catch {
    // resposta malformada → mantém os chips estáticos
  }
  return []
}

export function ChatPanel() {
  const project = useActiveProject()
  const items = useChat((s) => s.items)
  const running = useChat((s) => s.running)
  const openProject = useChat((s) => s.openProject)
  const start = useChat((s) => s.start)
  const handleEvent = useChat((s) => s.handleEvent)
  const finish = useChat((s) => s.finish)
  const scrollRef = useRef<HTMLDivElement>(null)
  const runIdRef = useRef<string | null>(null)

  // Abre o projeto ao trocar: carrega as conversas e a mais recente (Sprint 2).
  const projectId = project?.id ?? null
  useEffect(() => {
    void openProject(projectId)
  }, [projectId, openProject])

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
      void useChat.getState().persist()
      void generateSuggestions()
    }
  }

  function handleStop() {
    if (runIdRef.current) void cancelClaude(runIdRef.current)
  }

  // Gera sugestões contextuais após o turno (fire-and-forget; degrada pros chips).
  async function generateSuggestions() {
    const helperModel = useApp.getState().helperModel
    if (!helperModel || !project || !isTauri()) return
    const before = useChat.getState()
    if (!before.items.some((it) => it.kind === "text")) return
    const convId = before.conversationId
    before.setSuggesting(true)
    try {
      const raw = await suggest(
        helperModel,
        project.path,
        `${SUGGEST_PROMPT}\n\nConversa recente:\n${buildContext(before.items)}`,
      )
      const list = parseSuggestions(raw)
      const after = useChat.getState()
      if (list.length && !after.running && after.conversationId === convId) {
        after.setSuggestions(list)
      }
    } catch {
      // silencioso — mantém os chips estáticos
    } finally {
      useChat.getState().setSuggesting(false)
    }
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

      <div className="relative z-10 shrink-0 px-8 pb-7">
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
