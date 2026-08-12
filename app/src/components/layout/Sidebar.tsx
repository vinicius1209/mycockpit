import { useEffect, useMemo, useRef, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  Plus,
  Moon,
  Sun,
  Folder,
  FolderGit2,
  X,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Clock,
  Loader2,
  Trash2,
  Pencil,
  Copy,
  Ban,
  Archive,
  ArchiveRestore,
  GitBranch,
  Rocket,
  Route,
  Search,
  Swords,
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
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu"
import { AgentMark } from "@/components/common/AgentMark"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useAwaiting } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { useSchedules } from "@/store/schedules"
import { fmtUntilShort, nextScheduled } from "@/lib/schedules"
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
  type ConversationMeta,
} from "@/lib/db"
import { shortVersion } from "@/lib/version"
import { createWorktree, removeWorktree } from "@/lib/git"
import { LABEL_COLORS } from "@/lib/labelColors"
import { cn } from "@/lib/utils"
import type { AgentStatus, Project } from "@/lib/types"

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

/** Submenu de cor reusado (conversa + projeto): swatches + remover. */
function ColorSubmenu({
  current,
  onPick,
}: {
  current?: string | null
  onPick: (color: string | null) => void
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span
          className="size-3.5 rounded-full border"
          style={current ? { background: current } : undefined}
        />
        Cor
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <div className="grid grid-cols-3 gap-1 p-1">
          {LABEL_COLORS.map((c) => (
            <ContextMenuItem
              key={c.id}
              title={c.name}
              onSelect={() => onPick(c.hex)}
              className="justify-center p-1.5"
            >
              <span
                className={cn(
                  "size-4 rounded-full",
                  current === c.hex &&
                    "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
                )}
                style={{ background: c.hex }}
              />
            </ContextMenuItem>
          ))}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPick(null)}>
          <Ban /> Remover cor
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** Ícone do projeto: pasta TINGIDA da cor-rótulo (cinza se sem cor), com um
 *  pulso no canto quando o projeto tem um turno rodando. Marcador do container. */
function ProjectFolder({
  color,
  status,
  awaiting = false,
}: {
  color?: string | null
  status: AgentStatus
  /** Alguma conversa do projeto está esperando você: permissão OU pergunta
   *  pendente (os dois param o turno). */
  awaiting?: boolean
}) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <Folder
        className={cn("size-[18px]", !color && "text-muted-foreground/70")}
        style={color ? { color } : undefined}
      />
      {/* Espera VENCE rodando no mesmo canto: um projeto que roda sozinho não
          precisa de você; um que parou pra te perguntar algo, sim. S3.2 —
          pulso SÓ no "esperando você" (o único evento que interrompe o
          humano); rodando é presença calma → dot estático. */}
      {awaiting ? (
        <span
          title="Este projeto parou esperando você"
          className="animate-cockpit-pulse absolute -top-0.5 -right-0.5 size-2 rounded-full bg-st-warning ring-2 ring-rail"
        />
      ) : (
        status === "running" && (
          <span
            title="Turno rodando neste projeto"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-st-running ring-2 ring-rail"
          />
        )
      )}
    </span>
  )
}

// S1.2 — tipo do payload de drag de PROJETO (HTML5 dnd; não há lib de dnd no
// repo). `types` é legível no dragover (getData não é), então o tipo é o
// discriminador do que se aceita soltar.
const PROJECT_DND = "application/x-mycockpit-project"

function ProjectRow({
  project,
  active,
  expanded,
  status,
  awaiting = false,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggle,
  onDelete,
}: {
  project: Project
  active: boolean
  expanded: boolean
  status: AgentStatus
  /** Pedido pendente (permissão ou pergunta) em alguma conversa do projeto:
   *  ponto âmbar na pasta. */
  awaiting?: boolean
  /** S1.2 — bordas da lista (desabilita "Mover para cima/baixo" no menu). */
  canMoveUp: boolean
  canMoveDown: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const renameProject = useApp((s) => s.renameProject)
  const setProjectColor = useApp((s) => s.setProjectColor)
  const reorderProjects = useApp((s) => s.reorderProjects)
  const moveProject = useApp((s) => s.moveProject)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(project.name)

  function commit() {
    setEditing(false)
    const v = val.trim()
    if (v && v !== project.name) renameProject(project.id, v)
    else setVal(project.name)
  }

  // Cor-rótulo = DOT ao lado do nome (a tinta de linha inteira competia com o
  // bg-accent/barra de seleção — 3 sinais no mesmo canal). Seleção é dona do bg.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          // S1.2 — drag & drop reordena projetos (teclado cobre via context
          // menu). Draggable sai durante a edição pra não brigar com a seleção
          // de texto do input de renomear.
          draggable={!editing}
          onDragStart={(e) => {
            e.dataTransfer.setData(PROJECT_DND, project.id)
            e.dataTransfer.effectAllowed = "move"
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PROJECT_DND)) e.preventDefault()
          }}
          onDrop={(e) => {
            const dragId = e.dataTransfer.getData(PROJECT_DND)
            if (!dragId || dragId === project.id) return
            e.preventDefault()
            reorderProjects(dragId, project.id)
          }}
          className={cn(
            "group relative flex w-full items-center rounded-md transition-colors",
            active ? "bg-accent" : "hover:bg-accent/55",
          )}
        >
          {active && (
            <span className="absolute top-1/2 left-0 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
          )}
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 p-2">
              <ProjectFolder color={project.color} status={status} awaiting={awaiting} />
              <input
                autoFocus
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit()
                  if (e.key === "Escape") {
                    setVal(project.name)
                    setEditing(false)
                  }
                }}
                className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
              />
            </div>
          ) : (
            <button
              onClick={onSelect}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-1 pl-2 text-left"
            >
              {/* Pasta TINGIDA da cor do projeto (Codex-like): é o marcador do
                  container. Path saiu da linha → vira tooltip (menos ruído). */}
              <ProjectFolder color={project.color} status={status} awaiting={awaiting} />
              <span
                className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
                title={project.path}
              >
                {project.name}
              </span>
            </button>
          )}
          {/* S1.4 — arquivamento saiu da linha (mora SÓ no context menu): a
              lixeira materializava no hover COLADA no chevron e o caminho do
              cursor cruzava a zona de arquivar. O chevron fica sozinho na
              borda direita. */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            title={expanded ? "Retrair" : "Expandir"}
            aria-label={expanded ? "Retrair projeto" : "Expandir projeto"}
            aria-expanded={expanded}
            className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-muted-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem
          onSelect={() => {
            setVal(project.name)
            setEditing(true)
          }}
        >
          <Pencil /> Renomear
        </ContextMenuItem>
        <ColorSubmenu
          current={project.color}
          onPick={(c) => setProjectColor(project.id, c)}
        />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(project.path)
            toast.success("Caminho copiado")
          }}
        >
          <Copy /> Copiar caminho
        </ContextMenuItem>
        {/* S1.2 — reordenação por teclado (o drag não cobre acessibilidade). */}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!canMoveUp}
          onSelect={() => moveProject(project.id, -1)}
        >
          <ArrowUp /> Mover para cima
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canMoveDown}
          onSelect={() => moveProject(project.id, 1)}
        >
          <ArrowDown /> Mover para baixo
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete}>
          <Archive /> Arquivar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Ids das conversas rodando, como string estável (só muda em transição de run
 * , não a cada delta de streaming, evitando re-render da sidebar inteira). */
function useRunningConvIds(): Set<string> {
  const key = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id]) => id)
      .sort()
      .join(","),
  )
  return new Set(key ? key.split(",") : [])
}

/** Conversas que TERMINARAM sem você ver → selo de concluído/falhou na linha.
 *  O spinner some quando o turno acaba e, sem isto, o fim não deixava sinal
 *  NENHUM na navegação: você só descobria abrindo. Chave estável (só muda na
 *  transição), pelo mesmo motivo do useRunningConvIds. */
function useFinishedUnseen(): Map<string, "ok" | "error"> {
  const key = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.finishedUnseen)
      .map(([id, c]) => `${id}:${c.finishedUnseen}`)
      .sort()
      .join(","),
  )
  const m = new Map<string, "ok" | "error">()
  for (const par of key ? key.split(",") : []) {
    const [id, st] = par.split(":")
    m.set(id, st === "error" ? "error" : "ok")
  }
  return m
}

/** Ids das conversas com disputa de Fusion esperando DECISÃO (string estável). */
function useDecidingConvIds(): Set<string> {
  const key = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
      .map(([id]) => id)
      .sort()
      .join(","),
  )
  return new Set(key ? key.split(",") : [])
}

/** Ids das conversas com QUALQUER disputa de Fusion viva (string estável). */
function useFusionConvIds(): Set<string> {
  const key = useFusion((s) => Object.keys(s.byConv).sort().join(","))
  return new Set(key ? key.split(",") : [])
}

/** Ids das conversas com MISSÃO rodando (string estável, mesmo padrão acima). */
function useMissionRunningConvIds(): Set<string> {
  const key = useMission((s) =>
    Object.entries(s.byConv)
      .filter(([, m]) => m.status === "running")
      .map(([id]) => id)
      .sort()
      .join(","),
  )
  return new Set(key ? key.split(",") : [])
}

/** Lista de conversas (tarefas) de UM projeto (árvore independente: pode haver
 *  várias montadas ao mesmo tempo, cada uma lendo a lista do seu projectId). */
// Array vazio ESTÁVEL (module-level): o selector abaixo NÃO pode retornar um `[]`
// novo a cada chamada — o useSyncExternalStore do React 18 detecta referência
// nova a cada snapshot e entra em loop infinito ("getSnapshot should be cached"),
// que dava TELA PRETA quando o projeto ainda não tinha as conversas carregadas.
const EMPTY_CONVS: ConversationMeta[] = []

function ConversationList({ projectId }: { projectId: string }) {
  // default FORA do selector (?? numa constante estável): selector devolve o
  // array do store (ref estável) ou undefined (estável) — nunca um `[]` novo.
  const conversations =
    useChat((s) => s.conversationsByProject[projectId]) ?? EMPTY_CONVS
  const activeId = useChat((s) => s.activeId)
  const newConversation = useChat((s) => s.newConversation)
  const switchConversation = useChat((s) => s.switchConversation)
  const removeConversation = useChat((s) => s.removeConversation)
  const renameConversation = useChat((s) => s.renameConversation)
  const setConversationColor = useChat((s) => s.setConversationColor)
  const duplicateConversation = useChat((s) => s.duplicateConversation)
  const setWorktree = useChat((s) => s.setWorktree)
  const reorderConversations = useChat((s) => s.reorderConversations)
  const moveConversation = useChat((s) => s.moveConversation)
  // S1.2 — payload de drag de CONVERSA, escopado pelo projeto: o dragover de
  // uma lista só aceita conversa DA MESMA lista (mover entre projetos está
  // fora de escopo). O tipo é lowercased pelo browser — ids uuid já são.
  const convDnd = `application/x-mycockpit-conv-${projectId.toLowerCase()}`
  // Projeto DESTA lista (não o ativo): worktree/isolamento usam o path certo,
  // mesmo numa árvore de projeto não-ativo.
  const project = useApp((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const setActiveProject = useApp((s) => s.setActiveProject)
  // F1 — a seleção só DIRIGE o detalhe no modo linear; nos demais, o item ativo
  // renderiza dimmed (memória preservada, ênfase removida). String estável.
  const viewMode = useApp((s) => s.viewMode)
  const running = useRunningConvIds()
  const finished = useFinishedUnseen()
  const defaultAgent = useApp((s) => s.settings.defaultAgent)
  const deciding = useDecidingConvIds()
  const fusionAlive = useFusionConvIds()
  const missionRunning = useMissionRunningConvIds()
  // Pedido pendente (permissão ou pergunta do ask_user): o turno DESTA conversa
  // está parado esperando você.
  const awaiting = useAwaiting()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)

  // O ContextMenu desmonta e restaura foco depois do onSelect. `autoFocus` no
  // input acontece cedo demais e pode perder essa disputa. Focamos no próximo
  // frame, já com o menu fechado, e selecionamos o título para renomear direto.
  useEffect(() => {
    if (!editingId) return
    const frame = requestAnimationFrame(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [editingId])

  // Clicar numa conversa: torna o projeto DELA o ativo (abre no painel) e troca
  // a conversa. Funciona pra projeto não-ativo (setActive + switch pelo id único).
  function openConv(id: string) {
    if (projectId !== useApp.getState().activeProjectId) setActiveProject(projectId)
    // navegar pra uma conversa fecha a view global "Agendado" (se aberta) —
    // mesmo quando o projeto já é o ativo (setActiveProject não roda).
    useApp.getState().setScheduledOpen(false)
    // Clicar numa conversa NAVEGA até ela: estando no Painel/Features, troca pro
    // Trabalho (senão o clique só muda o store e a tela não reage = cara de bug).
    // Mesmo contrato dos outros caminhos (MissionControl, InboxBell, Agendado).
    useApp.getState().setViewMode("linear")
    void switchConversation(id)
  }

  function commitRename(id: string) {
    const v = editValue.trim()
    setEditingId(null)
    if (v) void renameConversation(id, v)
  }

  // conversa é HARD-DELETE (sem desfazer) → sempre confirma antes.
  async function askDeleteConv(id: string, title: string | null) {
    const ok = await confirm({
      title: "Excluir conversa?",
      description: `"${title ?? "Nova conversa"}": o histórico e os anexos são apagados. Não dá pra desfazer.`,
      confirmLabel: "Excluir",
      danger: true,
    })
    if (ok) void removeConversation(id)
  }

  // v2.5 — isola a conversa num worktree (o cockpit cria) ou volta pra o projeto.
  async function toggleWorktree(id: string, wt: string | null) {
    if (!project) return
    if (wt) {
      try {
        await removeWorktree(project.path, wt)
        setWorktree(id, null)
        toast.success("Isolamento removido")
      } catch (e) {
        // git recusa sem --force se houver mudança não-commitada (preserva o trabalho)
        toast.error(
          typeof e === "string" && e
            ? e
            : "Não removi; há mudanças não-commitadas no worktree?",
        )
      }
    } else {
      try {
        const info = await createWorktree(project.path, id)
        setWorktree(id, info.path)
        toast.success(`Isolado em ${info.branch}`)
      } catch (e) {
        toast.error(typeof e === "string" ? e : "Falha ao isolar")
      }
    }
  }

  return (
    // Sem border-l nem indentação de container: a hierarquia é só alinhamento.
    // Cada filho recebe ~40px de recuo → texto sob o texto do projeto. Na linha
    // de conversa, parte desse recuo é a marca do agent (esquerda), então o
    // padding cai para 18px e a soma continua batendo.
    <div className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px">
      {conversations.map((c, idx) => {
        const isActive = c.id === activeId
        // F1 — destaque PLENO (bg-accent + barra brass) só quando o Linear é a
        // superfície ativa; no SDD a ativa fica DIM (bg sutil, texto
        // muted): memória preservada, sem mentir que ela dirige o detalhe.
        const isFull = isActive && viewMode === "linear"
        const isDimmed = isActive && viewMode !== "linear"
        const isRunning = running.has(c.id)
        const doneUnseen = finished.get(c.id)
        const isDeciding = deciding.has(c.id)
        const hasFusion = fusionAlive.has(c.id)
        const hasMission = missionRunning.has(c.id)
        const isAwaiting = awaiting.convIds.has(c.id)
        const isEditing = editingId === c.id
        // Sinais discretos à direita (F2): escudo = pedido pendente, permissão
        // ou pergunta (turno PARADO, vem primeiro: é o único que te cobra ação);
        // spinner = run; foguete = missão; espadas = disputa (âmbar quando
        // espera decisão).
        // Estado do TURNO num slot fixo, sobre a marca do agent (padrão do
        // Warp): a posição não muda quando o estado muda, e o slot nunca fica
        // vazio porque a identidade do agent está sempre lá. Antes o ícone
        // aparecia/desaparecia à direita do título e empurrava o layout — e o
        // bloco inteiro virava null quando o turno acabava, que é por que o selo
        // de concluído nunca chegava a renderizar.
        const turnStatus = isAwaiting
          ? ("awaiting" as const)
          : isRunning
            ? ("running" as const)
            : doneUnseen === "error"
              ? ("error" as const)
              : doneUnseen === "ok"
                ? ("done" as const)
                : null
        // Título do estado, compartilhado pela marca (à esquerda).
        const statusTitle =
          turnStatus === "awaiting"
            ? "O turno parou esperando você (permissão ou pergunta)"
            : turnStatus === "running"
              ? "Turno rodando"
              : turnStatus === "error"
                ? "O turno terminou com erro, abra para ver"
                : turnStatus === "done"
                  ? "Turno concluído, abra para ver"
                  : undefined
        // À DIREITA sobram só missão e disputa: são TIPOS de execução, não
        // estado do turno. Estado mora na marca do agent, à esquerda.
        const statusEl =
          hasMission || hasFusion ? (
            <>
              {hasMission && (
                <span
                  className="grid size-3 shrink-0 place-items-center"
                  title="Missão rodando"
                >
                  {/* S3.2 — pulso só no "esperando você"; missão rodando é
                      presença calma. Brass sai (fica pra ativo + marca). */}
                  <Rocket
                    className="size-3 text-muted-foreground"
                    aria-label="missão rodando"
                  />
                </span>
              )}
              {hasFusion && (
                <span
                  className="grid size-3 shrink-0 place-items-center"
                  title={
                    isDeciding
                      ? "Disputa esperando sua decisão"
                      : "Disputa em andamento nesta conversa"
                  }
                >
                  <Swords
                    className={cn(
                      "size-3",
                      isDeciding
                        ? "text-st-warning"
                        : "text-muted-foreground/70",
                    )}
                    aria-label={
                      isDeciding ? "decisão pendente" : "disputa em curso"
                    }
                  />
                </span>
              )}
            </>
          ) : null
        // Cor-rótulo = DOT à direita do título (tinta de linha competia com a
        // seleção). Seleção é dona do background.
        return (
          <ContextMenu key={c.id}>
            <ContextMenuTrigger asChild>
              <div
                // S1.2 — drag reordena DENTRO do projeto (tipo escopado acima).
                draggable={!isEditing}
                onDragStart={(e) => {
                  e.dataTransfer.setData(convDnd, c.id)
                  e.dataTransfer.effectAllowed = "move"
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(convDnd)) e.preventDefault()
                }}
                onDrop={(e) => {
                  const dragId = e.dataTransfer.getData(convDnd)
                  if (!dragId || dragId === c.id) return
                  e.preventDefault()
                  reorderConversations(projectId, dragId, c.id)
                }}
                className={cn(
                  "group/c relative flex items-center rounded-md",
                  isFull
                    ? "bg-accent"
                    : isDimmed
                      ? "bg-accent/30"
                      : "hover:bg-accent/50",
                )}
                // Cor-rótulo tinge a LINHA INTEIRA, SEMPRE (pedido do usuário,
                // 04/08: a versão anterior degradava pra bolinha na linha ativa
                // e a cor "sumia" justo na conversa aberta, duplicando sinal).
                // Na ativa/dim a cor MISTURA com o fundo de seleção (a barra
                // brass segue sendo o sinal de seleção); fora delas, lavagem
                // sobre transparente. Sem bolinha em lugar nenhum.
                style={
                  c.color
                    ? {
                        background: `color-mix(in srgb, ${c.color} 12%, ${
                          isFull
                            ? "var(--accent)"
                            : isDimmed
                              ? "color-mix(in srgb, var(--accent) 30%, transparent)"
                              : "transparent"
                        })`,
                      }
                    : undefined
                }
              >
                {isFull && (
                  <span className="absolute top-1/2 left-0 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
                )}
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center py-2 pr-2 pl-10">
                    <input
                      ref={editInputRef}
                      aria-label="Renomear conversa"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(c.id)
                        if (e.key === "Escape") setEditingId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1 py-0.5 text-[12px] text-foreground outline-none"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => openConv(c.id)}
                    title={isDimmed ? "ativa no Linear" : undefined}
                    className={cn(
                      // pl-[18px] + marca (16px) + gap-2 (8px) = 42px ≈ o pl-10
                      // (40px) de antes: o TEXTO cai praticamente no mesmo x, então
                      // a hierarquia "texto sob o texto do projeto" se mantém. O
                      // modo edição segue em pl-10 (input não tem marca).
                      "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 pl-[18px] text-left text-[12px] font-normal",
                      // S3.6 — texto ativo em foreground: brass 12px sobre
                      // bg-accent no tema claro media 3.56:1 (< 4.5:1, reprova
                      // AA). Barra brass + bg-accent seguem donos do "ativo".
                      // dim = ativa noutra superfície (muted, sem destaque);
                      // inativo = cinza médio, clareia no hover.
                      isFull
                        ? "text-foreground"
                        : isDimmed
                          ? "text-muted-foreground"
                          : "text-muted-foreground group-hover/c:text-foreground",
                    )}
                  >
                    {/* Marca do agent + selo de estado À ESQUERDA, dentro da
                        indentação (pl-10 vira pl-4 + o slot): é a borda que você
                        varre descendo a lista, e é a mesma gramática das linhas
                        de projeto, que também têm ícone à esquerda. O texto NÃO
                        se desloca — o slot ocupa espaço que a indentação já
                        reservava e estava vazio.
                        Direita fica só com o que é SEU: a cor-rótulo e o
                        worktree. Cada borda com um dono. */}
                    <AgentMark
                      // sem carimbo ainda (conversa nova, nada enviado) → mostra
                      // o SEU default, não "claude-code" fixo: a linha não pode
                      // afirmar um agent que você não escolheu.
                      agent={c.agent ?? defaultAgent}
                      status={turnStatus}
                      title={statusTitle}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.title ?? "Nova conversa"}
                    </span>
                    {/* Cor-rótulo é SÓ a lavagem da linha (inclusive na ativa,
                        misturada à seleção) — bolinha nenhuma: duplicava sinal
                        com o dot de status da marca (pedido do usuário, 04/08). */}
                    {/* S3.2 — worktree é CONTEXTO, não seleção nem marca: sai
                        do brass (que fica pra ativo + marca) e vira muted. */}
                    {c.worktreePath && (
                      <GitBranch
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="isolado em worktree"
                      />
                    )}
                    {/* à direita sobram só os sinais de OUTRO tipo de execução
                        (missão/disputa), que não são estado de turno. */}
                    {statusEl && (
                      <span className="flex shrink-0 items-center gap-1">
                        {statusEl}
                      </span>
                    )}
                  </button>
                )}
                {/* S1.4 — o excluir saiu da linha (mora SÓ no context menu):
                    o X no hover ficava no caminho do cursor e um clique
                    impreciso abria um confirm destrutivo. */}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
              <ContextMenuItem
                onSelect={() => {
                  setEditValue(c.title ?? "")
                  setEditingId(c.id)
                }}
              >
                <Pencil /> Renomear
              </ContextMenuItem>
              <ColorSubmenu
                current={c.color}
                onPick={(col) => void setConversationColor(c.id, col)}
              />
              <ContextMenuItem onSelect={() => void duplicateConversation(c.id)}>
                <Copy /> Duplicar
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void toggleWorktree(c.id, c.worktreePath)}
              >
                <GitBranch />{" "}
                {c.worktreePath ? "Remover isolamento" : "Isolar em worktree"}
              </ContextMenuItem>
              {/* S1.2 — reordenação por teclado (o drag não cobre a11y). */}
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={idx === 0}
                onSelect={() => moveConversation(projectId, c.id, -1)}
              >
                <ArrowUp /> Mover para cima
              </ContextMenuItem>
              <ContextMenuItem
                disabled={idx === conversations.length - 1}
                onSelect={() => moveConversation(projectId, c.id, 1)}
              >
                <ArrowDown /> Mover para baixo
              </ContextMenuItem>
              <ContextMenuSeparator />
              {/* S1.4 — ícone honesto: excluir é LIXEIRA (o X dizia "fechar"). */}
              <ContextMenuItem
                variant="destructive"
                disabled={isRunning}
                onSelect={() => void askDeleteConv(c.id, c.title)}
              >
                <Trash2 /> Excluir
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <button
        onClick={() => {
          // Nova tarefa neste projeto → ativa o projeto, cria a conversa e ABRE
          // o Trabalho (criar e continuar olhando o Painel deixava o clique mudo).
          if (projectId !== useApp.getState().activeProjectId)
            setActiveProject(projectId)
          useApp.getState().setScheduledOpen(false)
          useApp.getState().setViewMode("linear")
          void newConversation(projectId)
        }}
        className="flex items-center gap-3 rounded-md p-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        {/* Plus ocupa a mesma coluna de ícone (20px) do projeto → "nova tarefa"
            alinha com as conversas, mantendo a leitura da coluna. */}
        <span className="grid size-5 shrink-0 place-items-center">
          <Plus className="size-3.5" />
        </span>
        Nova tarefa
      </button>
    </div>
  )
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
      className="flex items-center gap-3 rounded-md p-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
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
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground/60"
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
                "group/f relative flex items-center rounded-md",
                selected ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              {selected && (
                <span className="absolute top-1/2 left-0 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
              )}
              <button
                onClick={() => setSddFocus(plan.slug)}
                title={plan.slug}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 pl-10 text-left text-[12px] font-normal",
                  // S3.6 — mesmo motivo da lista de conversas: brass 12px sobre
                  // bg-accent reprova AA no claro (3.56:1); ativo = foreground.
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground group-hover/f:text-foreground",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                {/* Badge compacto do estágio EFETIVO. "done" é estado
                    ambiente permanente na sidebar, então é CINZA (STYLEGUIDE
                    §2: verde é marco, não decoração que fica na tela). */}
                <span
                  className={cn(
                    "shrink-0 rounded-sm px-1 py-px text-[9.5px] leading-4 tracking-wide uppercase",
                    stage === "done"
                      ? "bg-muted text-muted-foreground"
                      : "bg-brass/10 text-brass/80",
                  )}
                >
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

/** F7 — seção GLOBAL "Agendado" no topo da sidebar (acima de PROJETOS,
 *  discreta): coleção cross-projeto das automações do F6. Clique abre a view
 *  no lugar do conteúdo principal (useApp.scheduledOpen — estado próprio, não
 *  mexe no switcher). Badge = próxima execução ("2h"), refrescada a cada 60s. */
function ScheduledEntry() {
  // selector devolve PRIMITIVO (number|null) — estável entre snapshots.
  const nextAt = useSchedules(
    (s) => nextScheduled(s.schedules)?.nextRun ?? null,
  )
  const active = useApp((s) => s.scheduledOpen)
  const setScheduledOpen = useApp((s) => s.setScheduledOpen)
  // re-render de minuto SÓ quando há badge (o rótulo relativo não pode mofar).
  const [, setTick] = useState(0)
  useEffect(() => {
    if (nextAt == null) return
    const t = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [nextAt])
  return (
    <div>
      <button
        onClick={() => setScheduledOpen(true)}
        aria-label="Abrir Agendado"
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors",
          active ? "bg-accent" : "hover:bg-accent/55",
        )}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          <Clock
            className={cn(
              "size-4",
              active ? "text-brass" : "text-muted-foreground/70",
            )}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            // S3.6 — ativo em foreground (brass sobre accent reprova AA no claro)
            active
              ? "font-medium text-foreground"
              : "text-muted-foreground group-hover:text-foreground",
          )}
        >
          Agendado
        </span>
        {nextAt != null && (
          <span className="shrink-0 rounded bg-brass/10 px-1.5 py-px text-[10px] tabular-nums text-brass/80">
            {fmtUntilShort(nextAt - Date.now())}
          </span>
        )}
      </button>
    </div>
  )
}

function FlightPlansEntry() {
  const active = useApp((s) => s.flightPlansOpen)
  const setFlightPlansOpen = useApp((s) => s.setFlightPlansOpen)
  const count = useApp((s) => s.settings.missionPresets.length)
  return (
    <button
      onClick={() => setFlightPlansOpen(true)}
      aria-label="Abrir Planos de voo"
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors",
        active ? "bg-accent" : "hover:bg-accent/55",
      )}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Route
          className={cn(
            "size-4",
            active ? "text-brass" : "text-muted-foreground/70",
          )}
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        Planos de voo
      </span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/65">
        {count}
      </span>
    </button>
  )
}

function GlobalEntries() {
  return (
    <div className="px-2 pt-2">
      <div className="px-1 pt-1 pb-1.5">
        <span className="label-mono">Geral</span>
      </div>
      <div className="space-y-0.5">
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
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-muted-foreground"
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
              <div className="group/a flex items-center rounded-md hover:bg-accent/40">
                <span
                  className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pl-2"
                  title={p.path}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <Archive className="size-[15px] text-muted-foreground/50" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
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

/** Rodapé: "local · vX.Y.Z". Nos builds de teste a versão vira 0.1.0-test.N,
 *  então você SEMPRE sabe qual build está rodando. S3.1 — a versão NUNCA
 *  trunca: formato curto ("v0.1.0-t177") na linha, string completa no tooltip
 *  (o truncate comia justamente o número que identifica o build). */
function AppVersion() {
  const [version, setVersion] = useState("")
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {}) // browser (vite dev): sem versão, só "local"
  }, [])
  return (
    <div
      title={version ? `v${version}` : undefined}
      className="label-mono whitespace-nowrap text-[10.5px] normal-case tracking-normal text-muted-foreground/80"
    >
      local{version ? ` · ${shortVersion(version)}` : ""}
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
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onAddProject}
              title="Adicionar projeto"
              aria-label="Adicionar projeto"
            >
              <Plus className="size-4" />
            </Button>
          </header>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5 px-2 pb-2">
              {projects.length === 0 ? (
                <div className="mt-10 flex flex-col items-center gap-3 px-4 text-center">
                  <FolderGit2 className="size-6 text-muted-foreground/60" />
                  <p className="text-[13px] text-muted-foreground">
                    Nenhum projeto ainda.
                  </p>
                  <Button variant="outline" size="sm" onClick={onAddProject}>
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

      <footer className="flex h-12 shrink-0 items-center gap-2.5 border-t px-3">
        <div className="grid size-6 place-items-center rounded-full bg-brass/15 text-[11px] font-semibold text-brass">
          V
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-foreground">
            Vinícius
          </div>
          <AppVersion />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
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
