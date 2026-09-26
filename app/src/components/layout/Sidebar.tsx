import { conversaTrabalhando } from "@/lib/conversaTrabalhando"
import { useEffect, useRef, useState } from "react"
import {
  Plus,
  FolderGit2,
  ChevronRight,
  Trash2,
  Archive,
  ArchiveRestore,
} from "lucide-react"
import { avisar } from "@/lib/avisos"
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
import { abrirNovaConversa, ConversationList } from "@/components/layout/ConversationList"
import {
  PanelEntry,
  FleetEntry,
  FlightPlansEntry,
  ScheduledEntry,
} from "@/components/layout/Sidebar/globalEntries"
import { GLOBAL_NAVIGATION } from "@/components/layout/globalNavigation"
import { ProjectRow } from "@/components/layout/Sidebar/ProjectRow"
import { AccountMenu } from "@/components/layout/AccountMenu"
import { useReordenacaoFluida } from "@/lib/reordenacaoFluida"
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
      avisar.feito(`"${project.name}" removido`, {
        detalhe: "Arquivado. Dá pra restaurar.",
        acao: {
          rotulo: "Desfazer",
          fazer: () => {
            void (async () => {
              await restoreProject(project.id)
              const s = useApp.getState()
              if (!s.projects.some((p) => p.id === project.id)) {
                s.setProjects([project, ...s.projects])
              }
              s.setActiveProject(project.id)
              avisar.feito(`"${project.name}" restaurado`)
            })()
          },
        },
      })
    } catch {
      avisar.erro("Falha ao remover o projeto")
    }
  })()
}


/** A navegação global numa faixa de quatro ladrilhos (ADR-245): sem o rótulo
 *  "Geral" e sem quatro linhas, o espaço volta para as conversas. */
function GlobalEntries() {
  return (
    <nav aria-label="Vistas globais" className="grid grid-cols-4 gap-1 border-b border-border/40 px-2 pt-1 pb-2">
      {GLOBAL_NAVIGATION.map((entry) => {
        const Entry = { painel: PanelEntry, fleet: FleetEntry, scheduled: ScheduledEntry, flightPlans: FlightPlansEntry }[entry.id]
        return <Entry key={entry.id} />
      })}
    </nav>
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
      avisar.feito(`"${p.name}" desarquivado`)
    } catch {
      avisar.erro("Falha ao desarquivar o projeto")
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
      avisar.feito(`"${p.name}" excluído de vez`)
    } catch {
      avisar.erro("Falha ao excluir o projeto")
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
  const workVisible = useApp((s) => s.viewMode === "linear" && !s.scheduledOpen && !s.flightPlansOpen && !s.fleetOpen)
  const activeId = useApp((s) => s.activeProjectId)
  const setActive = useApp((s) => s.setActiveProject)


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
  // Reordenar projeto anima em vez de saltar, igual à lista de conversas. A
  // assinatura é a ORDEM: renomear ou mudar status não reposiciona nada.
  const listaDeProjetosRef = useRef<HTMLDivElement>(null)
  useReordenacaoFluida(listaDeProjetosRef, projects.map((p) => p.id).join(","))
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
  // Projetos com QUALQUER conversa trabalhando, turno ou parecer (ADR-267;
  // string estável → menos re-render).
  const runningProjectsKey = useChat((s) =>
    Array.from(
      new Set(
        Object.values(s.byId)
          .filter((c) => conversaTrabalhando(c))
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
          <header className="flex h-10 shrink-0 items-center justify-between px-3">
            <div className="flex items-center gap-2">
              {/* Rótulo em sans com peso, não mono em caixa alta (ADR-245):
                  rótulo técnico em todo lugar faz nada se destacar. */}
              <span className="text-[11px] font-medium text-faint">Projetos</span>
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
            <div ref={listaDeProjetosRef} className="flex flex-col gap-0.5 px-2 pb-2">
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
                  // Respiro antes e depois de projeto ABERTO (ADR-249): o grupo
                  // começa onde o peso começa. Recolhidos seguem juntos, na
                  // ordem que você deu.
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-col",
                      idx > 0 && (expanded.has(p.id) || expanded.has(projects[idx - 1].id)) && "mt-2.5",
                    )}
                  >
                    <ProjectRow
                      project={p}
                      active={workVisible && p.id === activeId}
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
                      onNovaConversa={() => abrirNovaConversa(p.id)}
                    />
                    {expanded.has(p.id) && <ConversationList projectId={p.id} />}
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
      <footer className="flex h-12 shrink-0 items-center gap-1.5 px-3">
        <AccountMenu />
      </footer>
    </aside>
  )
}
