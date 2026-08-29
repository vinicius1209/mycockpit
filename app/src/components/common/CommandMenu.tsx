import { useEffect, useMemo, useRef, useState } from "react"
import { searchConversations, type ConvSearchHit } from "@/lib/db/conversations"
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
  Sparkles,
  StickyNote,
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
import { SkillDraftDialog } from "@/components/skills/SkillDraftDialog"
import { onOpenCommandMenu } from "@/lib/commandMenu"
import { draftSkill, type SkillDraft } from "@/lib/skills"
import {
  SETTINGS_SECTIONS,
  casaBusca,
  secoesDisponiveis,
} from "@/components/settings/sections"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useStickyNotes } from "@/store/stickyNotes"

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
  // Skill (M5): true se há conversa ativa com ≥1 turno (algum texto/usuário).
  const canSaveSkill = useChat((s) => {
    const c = s.activeId ? s.byId[s.activeId] : null
    return !!c && c.items.some((it) => it.kind === "text" || it.kind === "user")
  })
  const [skillOpen, setSkillOpen] = useState(false)
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null)
  const [skillPath, setSkillPath] = useState<string | null>(null)
  // Token anti-stale do draftSkill: dois disparos rápidos → só o resultado da
  // geração CORRENTE hidrata o dialog (a promise antiga é descartada).
  const skillGen = useRef(0)

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

  // Mesma paleta pelo mouse: o chip de busca e o nome do projeto (barra do topo)
  // pedem a abertura por aqui, sem duplicar estado nem criar busca nova.
  useEffect(() => onOpenCommandMenu(() => setOpen(true)), [])

  // Busca full-text no histórico (≥3 chars, debounce 250ms, cross-projeto).
  const [query, setQuery] = useState("")
  // Sem termo NÃO despeja as 17 seções na paleta: a lista de comandos vira
  // ruído e some o que a pessoa abriu a paleta pra fazer. Elas aparecem quando
  // alguém procura.
  const secoesComBusca = useMemo(() => {
    const termo = query.trim()
    if (termo.length < 2) return []
    const pool = new Set(secoesDisponiveis())
    return SETTINGS_SECTIONS.filter(
      (sec) => pool.has(sec.id) && casaBusca(sec, termo),
    )
  }, [query])
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

  // Promove a conversa ativa a uma skill: fecha o ⌘K, abre o dialog em loading
  // (draft null), e rascunha via Haiku. O SAVE fica no dialog (gate humano).
  async function startSaveSkill() {
    const chat = useChat.getState()
    const convId = chat.activeId
    const conv = convId ? chat.byId[convId] : null
    if (!conv) return
    const proj = useApp.getState().projects.find((p) => p.id === conv.projectId)
    if (!proj) return
    const cfg = useApp.getState().mycockpit[conv.projectId]
    const helperModel = cfg
      ? cfg.helper
      : useApp.getState().settings.helperModel
    setOpen(false)
    setSkillPath(proj.path)
    setSkillDraft(null)
    setSkillOpen(true)
    const gen = ++skillGen.current
    const d = await draftSkill(proj.path, helperModel, conv.items)
    if (gen !== skillGen.current) return // um disparo mais novo venceu → descarta
    setSkillDraft(d)
  }

  return (
    <>
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
              className="h-10 text-[14px]"
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
              <CommandItem
                className={ITEM}
                onSelect={() =>
                  run(() => useStickyNotes.getState().toggleDock())
                }
              >
                <StickyNote aria-hidden />
                Bloco de notas
              </CommandItem>
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
              {canSaveSkill && (
                <CommandItem
                  className={ITEM}
                  onSelect={() => void startSaveSkill()}
                >
                  <Sparkles aria-hidden />
                  Salvar conversa como skill
                </CommandItem>
              )}
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
              <CommandItem
                className={ITEM}
                onSelect={() =>
                  run(() => useApp.getState().setAddProjectOpen(true))
                }
              >
                <Plus aria-hidden />
                Adicionar projeto
              </CommandItem>
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

            {/* Cada SEÇÃO de Configurações é um destino da paleta. Substitui a
                caixa de busca própria do concorrente: com 17 seções, busca
                dedicada é conforto; cair direto na seção pela paleta que já
                existe é quase todo o valor, sem tela nova.

                O casamento usa as palavras que a seção DECLARA (`busca`), não
                só o rótulo — digitar "microfone" tem que achar Ditado, e
                "microfone" não aparece em lugar nenhum do título. A lista de
                seções é a MESMA do rail (secoesDisponiveis): destino que o
                build não tem não vira resultado. */}
            {secoesComBusca.length > 0 && (
              <CommandGroup heading="Configurações">
                {secoesComBusca.map((sec) => (
                  <CommandItem
                    key={sec.id}
                    className={ITEM}
                    // O `query` entra no `value` — mesmo idioma do grupo de
                    // busca no histórico, logo acima. Quem já filtrou foi o
                    // `casaBusca`; sem o termo aqui, o filtro PRÓPRIO do cmdk
                    // derrubaria o item (ele não sabe das palavras declaradas,
                    // e "microfone" não aparece no rótulo "Ditado").
                    value={`${query} config:${sec.id}`}
                    onSelect={() => run(() => setSettingsOpen(true, sec.id))}
                  >
                    <sec.icon aria-hidden />
                    <span className="min-w-0 truncate">{sec.label}</span>
                    {sec.question && (
                      <span className="ml-auto hidden min-w-0 truncate pl-3 text-[12px] text-muted-foreground sm:block">
                        {sec.question}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
    <SkillDraftDialog
      open={skillOpen}
      onOpenChange={setSkillOpen}
      projectPath={skillPath}
      draft={skillDraft}
    />
    </>
  )
}
