import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject, useApp } from "@/store/app"
import { useChat, useActiveConv } from "@/store/chat"
import type { ChatItem } from "@/store/chat"
import { runAgent, cancelAgent, suggest } from "@/lib/agent"
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
  const conv = useActiveConv()
  const openProject = useChat((s) => s.openProject)
  const scrollRef = useRef<HTMLDivElement>(null)

  const items = conv.items
  const running = conv.running

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

  // ⌘K (ou outra UI) pode enfileirar um prompt → dispara aqui.
  const queuedPrompt = useChat((s) => s.queuedPrompt)
  useEffect(() => {
    if (!queuedPrompt) return
    const text = queuedPrompt
    useChat.getState().queuePrompt(null)
    void handleSend(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt])

  // destinationId = o agent escolhido no seletor (v0.2-α: o seam que descartava
  // o destino agora é threadado até o runAgent). Default 'claude-code'.
  async function handleSend(
    text: string,
    cfg?: { agent: string; model: string | null; effort: string | null },
  ) {
    if (!project) return
    if (!isTauri()) {
      toast("O dispatch dos agents roda no app (bun run tauri dev)")
      return
    }
    const convId = useChat.getState().activeId
    if (!convId) return
    const conv = useChat.getState().byId[convId]
    if (conv?.running) return // já rodando nesta conversa
    // conversa estabelecida trava no agent/modelo/effort do 1º run; nova usa o seletor
    const locked = conv != null && conv.items.length > 0
    const agent = locked ? conv!.agent : (cfg?.agent ?? "claude-code")
    const model = locked ? conv!.reqModel : (cfg?.model ?? null)
    const effort = locked ? conv!.effort : (cfg?.effort ?? null)
    const runId = crypto.randomUUID()
    const sessionId = conv?.sessionId ?? null
    // Sprint 4 — o run escreve em byId[convId] mesmo se o usuário trocar de aba.
    useChat.getState().start(convId, text, runId, agent, model, effort)
    try {
      await runAgent(
        runId,
        agent,
        model,
        effort,
        text,
        project.path,
        sessionId,
        project.permissionMode ?? "padrao",
        (e) => useChat.getState().handleEvent(convId, e),
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao executar o agent")
    } finally {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
      void generateSuggestions(convId)
    }
  }

  function handleStop() {
    const convId = useChat.getState().activeId
    const runId = convId ? useChat.getState().byId[convId]?.runId : null
    if (runId) void cancelAgent(runId)
  }

  // Gera sugestões contextuais após o turno (fire-and-forget; degrada pros chips).
  async function generateSuggestions(convId: string) {
    if (!isTauri()) return
    const c = useChat.getState().byId[convId]
    if (!c || !c.items.some((it) => it.kind === "text")) return
    const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
    if (!proj) {
      console.warn("[sugestões] projeto não encontrado p/ convId", convId, c.projectId)
      return
    }
    // modelo helper por projeto (.mycockpit/config.toml); default haiku, null = off
    const cfg = useApp.getState().mycockpit[c.projectId]
    const helperModel = cfg ? cfg.helper : "haiku"
    if (!helperModel) return
    useChat.getState().setSuggesting(convId, true)
    try {
      const raw = await suggest(
        helperModel,
        proj.path,
        `${SUGGEST_PROMPT}\n\nConversa recente:\n${buildContext(c.items)}`,
      )
      const list = parseSuggestions(raw)
      if (!list.length) {
        console.warn("[sugestões] resposta sem JSON parseável:", raw)
      }
      const after = useChat.getState().byId[convId]
      if (list.length && after && !after.running) {
        useChat.getState().setSuggestions(convId, list)
        // persiste p/ as sugestões sobreviverem a fechar/minimizar/reabrir
        void useChat.getState().persist(convId)
      }
    } catch (e) {
      console.warn("[sugestões] erro ao gerar:", e)
    } finally {
      useChat.getState().setSuggesting(convId, false)
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
          <MessageList
            items={items}
            running={running}
            startedAt={conv.startedAt}
            agent={conv.agent}
          />
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
