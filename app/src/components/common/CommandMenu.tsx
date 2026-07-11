import { useEffect, useState } from "react"
import { searchConversations, type ConvSearchHit } from "@/lib/db"
import {
  FileText,
  FolderGit2,
  GitBranch,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Settings,
  SunMoon,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

const ACTIONS = [
  {
    label: "Explicar o projeto",
    icon: FileText,
    prompt: "Explique a arquitetura deste projeto em alto nível.",
  },
  {
    label: "Rodar os testes",
    icon: Play,
    prompt: "Rode a suíte de testes e me mostre o resultado.",
  },
  {
    label: "Criar uma branch",
    icon: GitBranch,
    prompt: "Crie uma branch nova a partir da main para esta tarefa.",
  },
]

const ITEM = "mx-2 rounded-lg py-2.5"

/** Paleta de comando ⌘K (blocks.so command-menu-02, re-tematizada). */
export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const conversations = useChat((s) => s.conversations)
  const switchConversation = useChat((s) => s.switchConversation)
  const newConversation = useChat((s) => s.newConversation)
  const queuePrompt = useChat((s) => s.queuePrompt)
  const activeRunning = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.running ?? false) : false,
  )

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  // Busca full-text no histórico (≥3 chars, debounce 250ms, cross-projeto).
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ConvSearchHit[]>([])
  useEffect(() => {
    if (!open) {
      setQuery("")
      setHits([])
    }
  }, [open])
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) {
      setHits([])
      return
    }
    const t = setTimeout(() => {
      void searchConversations(q).then(setHits).catch(() => setHits([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function goToHit(h: ConvSearchHit) {
    useApp.getState().setActiveProject(h.projectId)
    await useChat.getState().openProject(h.projectId)
    await useChat.getState().switchConversation(h.id)
    useApp.getState().setViewMode("linear")
  }

  function run(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-xl border-border/60 p-0 shadow-[var(--shadow-pop)] sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Comandos</DialogTitle>
          <DialogDescription>
            Navegue e dispare ações por teclado.
          </DialogDescription>
        </DialogHeader>
        <Command className="bg-popover **:data-[slot=command-input-wrapper]:h-auto **:data-[slot=command-input-wrapper]:grow **:data-[slot=command-input-wrapper]:border-0 **:data-[slot=command-input-wrapper]:px-0">
          <div className="flex h-12 items-center gap-2 border-b border-border/60 px-4">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="O que você quer fazer?  (3+ letras busca no histórico)"
              className="h-10 text-[15px]"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="shrink-0"
            >
              <Kbd>esc</Kbd>
            </button>
          </div>

          <CommandList className="max-h-[420px] py-2">
            <CommandEmpty>Nada encontrado.</CommandEmpty>

            <CommandGroup heading="Ações">
              {activeProjectId && (
                <CommandItem
                  className={ITEM}
                  onSelect={() =>
                    run(() => void newConversation(activeProjectId))
                  }
                >
                  <Plus aria-hidden />
                  Nova tarefa
                  <KbdGroup className="ml-auto">
                    <Kbd>⌘</Kbd>
                    <Kbd>N</Kbd>
                  </KbdGroup>
                </CommandItem>
              )}
              {ACTIONS.map((a) => (
                <CommandItem
                  key={a.label}
                  className={ITEM}
                  disabled={activeRunning || !activeProjectId}
                  onSelect={() => run(() => queuePrompt(a.prompt))}
                >
                  <a.icon aria-hidden />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>

            {conversations.length > 0 && (
              <CommandGroup heading="Conversas">
                {conversations.map((c) => (
                  <CommandItem
                    key={c.id}
                    className={ITEM}
                    onSelect={() => run(() => void switchConversation(c.id))}
                  >
                    <MessageSquare aria-hidden />
                    {c.title ?? "Nova conversa"}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {hits.length > 0 && (
              <CommandGroup heading="Busca no histórico">
                {hits.map((h) => (
                  <CommandItem
                    key={`hit-${h.id}`}
                    // value contém a query → o filtro do cmdk nunca esconde o hit
                    value={`${query} ${h.title ?? ""} ${h.id}`}
                    className={ITEM}
                    onSelect={() => run(() => void goToHit(h))}
                  >
                    <MessageSquare aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {h.title ?? "Nova conversa"}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {h.projectName}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading="Projetos">
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  className={ITEM}
                  onSelect={() => run(() => setActiveProject(p.id))}
                >
                  <FolderGit2 aria-hidden />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup heading="Visual">
              <CommandItem className={ITEM} onSelect={() => run(toggleTheme)}>
                <SunMoon aria-hidden />
                Alternar tema
              </CommandItem>
              <CommandItem className={ITEM} onSelect={() => run(toggleSidebar)}>
                <PanelLeft aria-hidden />
                Alternar projetos
              </CommandItem>
              <CommandItem className={ITEM} onSelect={() => run(toggleContext)}>
                <PanelRight aria-hidden />
                Alternar contexto
              </CommandItem>
              <CommandItem
                className={ITEM}
                onSelect={() => run(() => setSettingsOpen(true))}
              >
                <Settings aria-hidden />
                Configurações
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
