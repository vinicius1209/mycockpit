import { useEffect, useMemo, useRef, useState } from "react"
import {
  Plus,
  Moon,
  Sun,
  FolderGit2,
  X,
  ChevronRight,
  Loader2,
  Trash2,
  Archive,
  ArchiveRestore,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { confirm } from "@/lib/confirm"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import { ConversationList } from "@/components/layout/ConversationList"
import {
  FleetEntry,
  FlightPlansEntry,
  ScheduledEntry,
} from "@/components/layout/Sidebar/globalEntries"
import { ProjectRow } from "@/components/layout/Sidebar/ProjectRow"
import { useApp } from "@/store/app"
import {
  COPY_DA_PASTA,
  conferirPastas,
  type PastasComProblema,
} from "@/lib/pastaDoProjeto"
import { useChat } from "@/store/chat"
import { useAwaiting } from "@/store/interactions"
import { useSchedules } from "@/store/schedules"
import {
  loadSddPlans,
  stageLabel,
  effectiveStage,
  type SddPlan,
} from "@/lib/sdd"
import {
  archiveProject,
  restoreProject,
  listArchivedProjects,
  hardDeleteProject,
  listProjects,
} from "@/lib/db"
import { SetupGuide } from "@/components/onboarding/SetupGuide"
import { cn } from "@/lib/utils"
import type { Project } from "@/lib/types"

/** Soft-remove do projeto (arquiva, conversas preservadas) com Desfazer. Disco intocado. */
function confirmDeleteProject(project: Project) {
  void (async () => {
    if (
      !(await confirm({
        title: `Arquivar "${project.name}"?`,
        description: "As conversas são preservadas e dá pra restaurar depois.",
        confirmLabel: "Arquivar",
      }))
    )
      return
    try {
      await archiveProject(project.id)
      const st = useApp.getState()
      const remaining = st.projects.filter((p) => p.id !== project.id)
      st.setProjects(remaining)
      if (st.activeProjectId === project.id) {
        st.setActiveProject(remaining[0]?.id ?? null)
      }
      toast(`"${project.name}" removido`, {
        description: "Arquivado. Dá pra restaurar.",
        action: {
          label: "Desfazer",
          onClick: () => {
            void (async () => {
              await restoreProject(project.id)
              const s = useApp.getState()
              if (!s.projects.some((p) => p.id === project.id)) {
                s.setProjects([project, ...s.projects])
              }
              s.setActiveProject(project.id)
              toast.success(`"${project.name}" restaurado`)
            })()
          },
        },
      })
    } catch {
      toast.error("Falha ao remover o projeto")
    }
  })()
}


/** F2 — modo SDD: no projeto ATIVO, a sidebar lista FEATURES (o objeto da
 *  superfície) no lugar das conversas. Carrega via loadSddPlans (async/invoke)
 *  em useEffect com cancelamento — NUNCA em selector — e cacheia em estado
 *  local, recarregando ao trocar de projeto (dep = project.path). */
function SddFeatureList({ project }: { project: Project }) {
  // Selectors devolvem primitivos/refs do store (estáveis) — nunca objeto novo.
  const focusSlug = useApp((s) => s.sddFocusSlug)
  const setSddFocus = useApp((s) => s.setSddFocus)
  const requestSddCreate = useApp((s) => s.requestSddCreate)
  // versão dos dados: o SddView bumpa ao criar/recarregar → esta lista recarrega.
  const dataVersion = useApp((s) => s.sddDataVersion)
  const [plans, setPlans] = useState<SddPlan[] | null>(null) // null = carregando
  const [query, setQuery] = useState("")

  // query só reseta ao TROCAR de projeto (não a cada bump de dados — senão a
  // busca digitada sumia quando uma etapa concluía no fundo).
  useEffect(() => {
    setQuery("")
    setPlans(null) // projeto novo → loader (bump de dados NÃO passa por aqui)
  }, [project.path])

  useEffect(() => {
    let cancelled = false
    // recarga por bump mantém a lista atual na tela (sem flash de loading);
    // só a PRIMEIRA carga do projeto mostra o loader (plans === null).
    loadSddPlans(project.path)
      .then((p) => {
        if (!cancelled) setPlans(p)
      })
      .catch(() => {
        if (!cancelled) setPlans([])
      })
    return () => {
      cancelled = true
    }
  }, [project.path, dataVersion])

  // Busca local (título/slug) + ordenação: em andamento primeiro, depois
  // concluídas; dentro de cada grupo, por título. Stage EFETIVO (sem PR aqui).
  const rows = useMemo(() => {
    if (!plans) return []
    const q = query.trim().toLowerCase()
    return plans
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q),
      )
      .map((p) => ({ plan: p, stage: effectiveStage(p, null) }))
      .sort((a, b) => {
        const ad = a.stage === "done" ? 1 : 0
        const bd = b.stage === "done" ? 1 : 0
        if (ad !== bd) return ad - bd
        return a.plan.title.localeCompare(b.plan.title)
      })
  }, [plans, query])

  const newFeatureBtn = (
    <button
      onClick={() => requestSddCreate()}
      className="flex items-center gap-3 rounded-md p-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-sel-hover hover:text-foreground"
    >
      {/* Mesmo padrão visual do "+ Nova tarefa": ação primária da superfície. */}
      <span className="grid size-5 shrink-0 place-items-center">
        <Plus className="size-3.5" />
      </span>
      Nova feature
    </button>
  )

  if (plans === null) {
    return (
      <div className="animate-reveal-down mt-0.5 mb-1 flex items-center gap-2 py-2 pl-10 text-[12px] text-muted-foreground/70">
        <Loader2 className="size-3 animate-spin" aria-label="carregando" />
        Carregando features…
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px">
        <p className="py-2 pl-10 text-[12px] text-muted-foreground/70">
          Nenhuma feature ainda
        </p>
        {newFeatureBtn}
      </div>
    )
  }

  return (
    <div className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px">
      {/* Busca compacta, alinhada à coluna de texto (pl-10) das linhas. */}
      <div className="mr-2 mb-0.5 ml-10 flex items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-1.5 py-1">
        <Search className="size-3 shrink-0 text-muted-foreground/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar feature…"
          aria-label="Buscar feature"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
            title="Limpar busca"
            aria-label="Limpar busca"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-2 pl-10 text-[12px] text-muted-foreground/70">
          Nenhuma feature encontrada
        </p>
      ) : (
        rows.map(({ plan, stage }) => {
          const selected = plan.slug === focusSlug
          return (
            <div
              key={plan.slug}
              className={cn(
                "group/f relative flex items-center rounded-md transition-colors",
                // Mesma receita única de "selecionado" (§2, ADR-043).
                selected ? "bg-sel" : "hover:bg-sel-hover",
              )}
            >
              <button
                onClick={() => setSddFocus(plan.slug)}
                title={plan.slug}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 pl-10 text-left text-[12px]",
                  // S3.6 — mesmo motivo da lista de conversas: brass 12px sobre
                  // a superfície de seleção reprova AA no claro (3.56:1). Ativo
                  // = foreground + peso 500 (o segundo canal da receita).
                  selected
                    ? "font-medium text-foreground"
                    : "font-normal text-muted-foreground group-hover/f:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                {/* Badge compacto do estágio EFETIVO. "done" é estado
                    ambiente permanente na sidebar, então é CINZA (STYLEGUIDE
                    §2: verde é marco, não decoração que fica na tela).
                    Sem uppercase+tracking à mão (§3 proíbe etiqueta de
                    instrumento improvisada): além de virar regra, o caixa-alta
                    espremia o título ao lado. "IMPLEMENTAÇÃO" com tracking
                    custava ~92px dos 142px úteis da sidebar no mínimo (190px);
                    "Implementação" custa ~74px, menos do que o badge gastava
                    ANTES da migração pra 11px. O rótulo canônico fica inteiro
                    (§7: não inventar sinônimo curto pra caber). */}
                {/* Cinza nos dois estados, igual ao `StageBadge` do painel:
                    estágio não é gesto nem status, e quem distingue "done" de
                    "discovery" é o TEXTO (§9 item 4). */}
                <span className="shrink-0 rounded-sm bg-muted px-1 py-px text-[11px] leading-4 text-muted-foreground">
                  {stageLabel(stage)}
                </span>
              </button>
            </div>
          )
        })
      )}
      {newFeatureBtn}
    </div>
  )
}

function GlobalEntries() {
  return (
    <div className="px-2 pt-2">
      <div className="px-1 pt-1 pb-1.5">
        <span className="label-mono">Geral</span>
      </div>
      <div className="space-y-0.5">
        <FleetEntry />
        <ScheduledEntry />
        <FlightPlansEntry />
      </div>
    </div>
  )
}

/** S1.3 — os arquivados EXISTEM: seção colapsada no fim da lista de projetos
 *  (só aparece quando N>0), com Desarquivar na linha e no context menu, e
 *  "Excluir de vez" (com confirm) SÓ no context menu. Antes, arquivar era um
 *  buraco negro: sem lista, sem volta fora do toast de Desfazer. */
function ArchivedSection() {
  const projects = useApp((s) => s.projects)
  const setProjects = useApp((s) => s.setProjects)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const [archived, setArchived] = useState<Project[]>([])
  const [open, setOpen] = useState(false)

  // A lista de VIVOS mudar (arquivar/restaurar/adicionar) é o sinal barato de
  // que o conjunto de arquivados pode ter mudado → recarrega do banco.
  useEffect(() => {
    let cancelled = false
    listArchivedProjects()
      .then((list) => {
        if (!cancelled && list) setArchived(list)
      })
      // falha de leitura não pode ser muda (a seção sumiria fingindo N=0),
      // mas também não pode virar toast em loop (o efeito reroda) → console.
      .catch((e) => console.error("listArchivedProjects falhou:", e))
    return () => {
      cancelled = true
    }
  }, [projects])

  async function unarchive(p: Project) {
    try {
      await restoreProject(p.id)
      // relê do banco: o restaurado volta com o sort_order que tinha (S1.2).
      const fresh = await listProjects()
      if (fresh) setProjects(fresh)
      setActiveProject(p.id)
      toast.success(`"${p.name}" desarquivado`)
    } catch {
      toast.error("Falha ao desarquivar o projeto")
    }
  }

  async function deleteForever(p: Project) {
    if (
      !(await confirm({
        title: `Excluir "${p.name}" de vez?`,
        description:
          "Apaga do cockpit o projeto, as conversas e os agendamentos dele. A pasta no disco fica intocada. Não dá pra desfazer.",
        confirmLabel: "Excluir de vez",
        danger: true,
      }))
    )
      return
    try {
      await hardDeleteProject(p.id)
      setArchived((l) => l.filter((x) => x.id !== p.id))
      // os agendamentos do projeto morreram no banco → re-hidrata a store
      // (senão a view Agendado seguiria listando automação de projeto morto).
      void useSchedules.getState().reload()
      toast(`"${p.name}" excluído de vez`)
    } catch {
      toast.error("Falha ao excluir o projeto")
    }
  }

  if (archived.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-0.5">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:bg-sel-hover hover:text-muted-foreground"
      >
        <ChevronRight
          className={cn(
            "size-3 transition-transform duration-200",
            open && "rotate-90",
          )}
        />
        Arquivados ({archived.length})
      </button>
      {open &&
        archived.map((p) => (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger asChild>
              <div className="group/a flex items-center rounded-md hover:bg-sel-hover">
                <span
                  className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-2"
                  title={p.path}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <Archive className="size-[15px] text-muted-foreground/50" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                    {p.name}
                  </span>
                </span>
                {/* Desarquivar na linha é ok (ação de RESGATE, não destrutiva);
                    o "Excluir de vez" fica só no context menu (S1.4). */}
                <button
                  onClick={() => void unarchive(p)}
                  className="mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover/a:opacity-100"
                  title="Desarquivar"
                  aria-label={`Desarquivar ${p.name}`}
                >
                  <ArchiveRestore className="size-3.5" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
              <ContextMenuItem onSelect={() => void unarchive(p)}>
                <ArchiveRestore /> Desarquivar
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => void deleteForever(p)}
              >
                <Trash2 /> Excluir de vez
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
    </div>
  )
}

export function Sidebar({ onAddProject }: { onAddProject: () => void }) {
  const projects = useApp((s) => s.projects)
  const activeId = useApp((s) => s.activeProjectId)
  const setActive = useApp((s) => s.setActiveProject)
  // Superfície ativa decide o OBJETO listado sob cada projeto (F2): linear =
  // conversas (as disputas ⚔️ ancoram nelas); sdd = features do projeto ATIVO
  // (não-ativos ficam só com a linha do projeto).
  const viewMode = useApp((s) => s.viewMode)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)

  // A pasta de cada projeto ainda existe? Confere no boot e quando a lista de
  // CAMINHOS muda (adicionar/arquivar) — não a cada render, e nunca em laço:
  // pasta não some sozinha enquanto você olha pra tela. Quem move pelo Finder
  // vê na próxima abertura, que é quando ele iria usar o projeto de novo.
  const [pastasComProblema, setPastasComProblema] = useState<PastasComProblema>({})
  const caminhos = projects.map((p) => p.path).join("|")
  useEffect(() => {
    const lista = caminhos ? caminhos.split("|") : []
    void conferirPastas(lista).then(setPastasComProblema)
  }, [caminhos])
  const loadProjectConversations = useChat((s) => s.loadProjectConversations)
  // Árvore INDEPENDENTE (Finder/VS Code): `expanded` guarda os projetos ABERTOS
  // — vários ao mesmo tempo, DESATRELADO do ativo. Em memória (ok no v1).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Projetos que o usuário COLAPSOU de propósito (chevron): o auto-expand do
  // ativo respeita a escolha e os pula. Expandir de novo (chevron/seleção)
  // tira do set. Ref (não re-renderiza; só o efeito abaixo lê).
  const userCollapsed = useRef<Set<string>>(new Set())
  // Abrir um projeto = adicionar ao set + carregar (lazy) as conversas dele.
  const openExpand = (id: string) => {
    userCollapsed.current.delete(id) // expandir desfaz o colapso deliberado
    void loadProjectConversations(id)
    setExpanded((s) => {
      if (s.has(id)) return s
      const n = new Set(s)
      n.add(id)
      return n
    })
  }
  // Chevron: alterna SÓ este projeto (não fecha os outros).
  function toggleExpand(id: string) {
    if (expanded.has(id)) {
      userCollapsed.current.add(id) // colapso DELIBERADO → auto-expand pula
      setExpanded((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    } else {
      openExpand(id)
    }
  }
  // Auto-expande o projeto ativo (seleção via ⌘K, boot etc. abre a árvore dele),
  // EXCETO se o usuário o colapsou de propósito (userCollapsed).
  useEffect(() => {
    if (activeId && !userCollapsed.current.has(activeId)) openExpand(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])
  // Projetos com QUALQUER conversa rodando (string estável → menos re-render).
  const runningProjectsKey = useChat((s) =>
    Array.from(
      new Set(
        Object.values(s.byId)
          .filter((c) => c.running)
          .map((c) => c.projectId),
      ),
    )
      .sort()
      .join(","),
  )
  const runningProjects = new Set(
    runningProjectsKey ? runningProjectsKey.split(",") : [],
  )
  // Projetos com pedido pendente (permissão ou pergunta): o ponto âmbar na pasta
  // é o que te leva ao pedido quando ele nasceu num projeto que você não está
  // olhando.
  const awaitingProjects = useAwaiting().projectIds

  return (
    <aside className="reveal-left flex h-full w-full flex-col bg-rail">
      {/* F7 — rail global (coleções cross-projeto) acima de Projetos. */}
      <GlobalEntries />
      <>
          <header className="flex h-11 shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-2">
              <span className="label-mono">Projetos</span>
              {/* S3.3 — contador é metadado, não conteúdo: um degrau abaixo. */}
              <span className="text-[11px] text-faint tabular-nums">
                {projects.length}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icone-padrao"
              className="text-muted-foreground hover:text-foreground"
              onClick={onAddProject}
              title="Adicionar projeto"
              aria-label="Adicionar projeto"
            >
              <Plus className="size-4" />
            </Button>
          </header>

          {/* `min-h-0` é o que prende o rodapé embaixo. Sem ele, um item de
              flex column não encolhe abaixo do próprio conteúdo (`min-height:
              auto`): a área de projetos crescia com a lista, empurrava o
              rodapé pra fora e o avatar descia junto com a rolagem. */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {projects.length === 0 ? (
                <div className="mt-10 flex flex-col items-center gap-3 px-4 text-center">
                  <FolderGit2 className="size-6 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">
                    Nenhum projeto ainda.
                  </p>
                  <Button variant="outline" size="padrao" onClick={onAddProject}>
                    <Plus className="size-4" />
                    Adicionar projeto
                  </Button>
                </div>
              ) : (
                projects.map((p, idx) => (
                  <div key={p.id} className="flex flex-col">
                    <ProjectRow
                      project={p}
                      active={p.id === activeId}
                      expanded={expanded.has(p.id)}
                      status={
                        runningProjects.has(p.id) ? "running" : (p.status ?? "idle")
                      }
                      awaiting={awaitingProjects.has(p.id)}
                      problemaNaPasta={
                        pastasComProblema[p.path]
                          ? COPY_DA_PASTA[pastasComProblema[p.path]]
                          : undefined
                      }
                      canMoveUp={idx > 0}
                      canMoveDown={idx < projects.length - 1}
                      onSelect={() => {
                        setActive(p.id)
                        openExpand(p.id) // selecionar auto-expande, sem fechar os outros
                      }}
                      onToggle={() => toggleExpand(p.id)}
                      onDelete={() => confirmDeleteProject(p)}
                    />
                    {expanded.has(p.id) &&
                      (viewMode === "sdd" ? (
                        p.id === activeId && <SddFeatureList project={p} />
                      ) : (
                        <ConversationList projectId={p.id} />
                      ))}
                  </div>
                ))
              )}
              {/* S1.3 — arquivados no FIM da lista (some quando N=0). */}
              <ArchivedSection />
            </div>
          </ScrollArea>
      </>

      {/* Guia de setup: some sozinho ao completar (renderiza null). */}
      <SetupGuide />

      {/* Sem `border-t` (build 202) e sem borda na faixa de status abaixo
          (ADR-043, Fase 3): o que separa é o espaço (o inset de 8px) e o peso.
          Duas linhas empilhadas a 24px foi o que o usuário leu como "cortado".
          O avatar saiu do brass junto: brass é gesto, avatar é identidade. */}
      <footer className="flex h-12 shrink-0 items-center gap-2.5 px-3">
        <div className="grid size-6 place-items-center rounded-full bg-foreground/10 text-[11px] font-semibold text-muted-foreground">
          V
        </div>
        {/* A VERSÃO saiu daqui pra faixa de status (StatusBar): saber qual
            build está rodando é ambiente e permanente, e no rodapé da sidebar
            sumia junto com a sidebar fechada. O que fica é o que NÃO é
            ambiente: quem está usando, e o gesto de trocar o tema. */}
        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          Vinícius
        </div>
        <Button
          variant="ghost"
          size="icone-padrao"
          className="text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
          title="Alternar tema"
          aria-label="Alternar tema"
        >
          {theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>
      </footer>
    </aside>
  )
}
