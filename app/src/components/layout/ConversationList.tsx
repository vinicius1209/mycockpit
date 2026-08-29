import { useEffect, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Copy,
  GitBranch,
  Pencil,
  Plus,
  Rocket,
  Swords,
  Timer,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { AgentMark } from "@/components/common/AgentMark"
import { ColorSubmenu } from "@/components/layout/ColorSubmenu"
import { ConversationSlot } from "@/components/layout/ConversationSlot"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { confirm } from "@/lib/confirm"
import { createWorktree, removeWorktree, worktreeRemovalNote } from "@/lib/git"
import { useWorktrees } from "@/store/worktrees"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useAwaiting } from "@/store/interactions"
import { useMission } from "@/store/mission"
import type { ConversationMeta } from "@/lib/db/conversations"
import { hasComposerDraft, useComposerDrafts } from "@/store/composerDrafts"

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

/** Conversas que TERMINARAM sem você ver. Só a falha ainda pinta a linha: o
 *  "concluído" virou tempo relativo no slot (ADR-043 · STYLEGUIDE §9 item 4,
 *  "dot ambiente cinza é a lei; quem precisa distinguir dois estados saudáveis
 *  usa texto"). Chave estável (só muda na transição), pelo mesmo motivo do
 *  useRunningConvIds. */
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

/** Conversas paradas num limite de uso: "pending" enquanto o auto-resume tem
 *  um reenvio agendado (calmo, automático — mesmo tom do Rocket de missão
 *  rodando), "stuck" quando o turno bateu limite e NINGUÉM vai reenviar
 *  sozinho (auto-resume desligado ou esgotou as tentativas — aí sim precisa
 *  de você). Chave estável, mesmo padrão dos hooks acima. */
function useLimitConvIds(): Map<string, "pending" | "stuck"> {
  const key = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.autoResume || (c.limitHitThisTurn && !c.running))
      .map(([id, c]) => `${id}:${c.autoResume ? "pending" : "stuck"}`)
      .sort()
      .join(","),
  )
  const m = new Map<string, "pending" | "stuck">()
  for (const par of key ? key.split(",") : []) {
    const [id, st] = par.split(":")
    m.set(id, st === "stuck" ? "stuck" : "pending")
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

/** Presença conhecida em sessão. Inclui `false` pra vencer a meta do boot
 * depois que um rascunho persistido é enviado/limpo. */
function useDraftPresence(): Map<string, boolean> {
  const key = useComposerDrafts((s) =>
    Object.keys(s.loaded)
      .map((id) => `${id}:${hasComposerDraft(s.byConv[id]) ? 1 : 0}`)
      .sort()
      .join(","),
  )
  const out = new Map<string, boolean>()
  for (const pair of key ? key.split(",") : [])
    out.set(pair.slice(0, -2), pair.endsWith(":1"))
  return out
}

// Array vazio ESTÁVEL (module-level): o selector abaixo NÃO pode retornar um `[]`
// novo a cada chamada — o useSyncExternalStore do React 18 detecta referência
// nova a cada snapshot e entra em loop infinito ("getSnapshot should be cached"),
// que dava TELA PRETA quando o projeto ainda não tinha as conversas carregadas.
const EMPTY_CONVS: ConversationMeta[] = []

/** Lista de conversas (tarefas) de UM projeto (árvore independente: pode haver
 *  várias montadas ao mesmo tempo, cada uma lendo a lista do seu projectId). */
export function ConversationList({ projectId }: { projectId: string }) {
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
  const limitState = useLimitConvIds()
  const draftPresence = useDraftPresence()
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
  // Conversa isolada leva o worktree junto (store/chat/remove.ts), e isso
  // aparece ANTES do clique: apagar uma conversa que também apaga um branch é
  // mais do que o usuário pediu se ele não foi avisado.
  async function askDeleteConv(id: string, title: string | null, wt: string | null) {
    const ok = await confirm({
      title: "Excluir conversa?",
      description: wt
        ? `"${title ?? "Nova conversa"}": o histórico e os anexos são apagados, e o worktree isolado volta pro repositório (o branch some junto se não tiver commit). Não dá pra desfazer.`
        : `"${title ?? "Nova conversa"}": o histórico e os anexos são apagados. Não dá pra desfazer.`,
      confirmLabel: "Excluir",
      danger: true,
    })
    if (ok) void removeConversation(id)
  }

  // v2.5 — isola a conversa num worktree (o cockpit cria) ou volta pra o projeto.
  // Nos dois sentidos relê a lista de worktrees: sem isso, um isolamento
  // removido continuaria na leitura antiga E sem conversa dona, ou seja,
  // apareceria na faixa como "solto" sendo que já não existe.
  async function toggleWorktree(id: string, wt: string | null) {
    if (!project) return
    const releitura = () =>
      void useWorktrees.getState().refresh(project.id, project.path)
    if (wt) {
      try {
        const nota = worktreeRemovalNote(await removeWorktree(project.path, wt))
        setWorktree(id, null)
        toast.success("Isolamento removido", nota ? { description: nota } : undefined)
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
    releitura()
  }

  return (
    // Sem border-l nem indentação de container: a hierarquia é só alinhamento.
    // Cada filho recebe ~40px de recuo → texto sob o texto do projeto. Na linha
    // de conversa, parte desse recuo é a marca do agent (esquerda), então o
    // padding cai para 18px e a soma continua batendo.
    <div className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px">
      {conversations.map((c, idx) => {
        const isActive = c.id === activeId
        // F1 — destaque PLENO (--sel + peso + pip) só quando o Linear é a
        // superfície ativa; no SDD a ativa fica DIM (preenchimento pela metade,
        // sem pip): memória preservada, sem mentir que ela dirige o detalhe.
        const isFull = isActive && viewMode === "linear"
        const isDimmed = isActive && viewMode !== "linear"
        const isRunning = running.has(c.id)
        const doneUnseen = finished.get(c.id)
        const isDeciding = deciding.has(c.id)
        const hasFusion = fusionAlive.has(c.id)
        const hasMission = missionRunning.has(c.id)
        const isAwaiting = awaiting.convIds.has(c.id)
        const limitStatus = limitState.get(c.id)
        const hasDraft = draftPresence.has(c.id)
          ? draftPresence.get(c.id)!
          : !!c.hasDraft
        const isEditing = editingId === c.id
        // À DIREITA do título, ANTES do slot: missão e disputa são TIPOS de
        // execução, não estado do turno. O estado do turno mora no slot, que
        // tem dono único (§6).
        const statusEl =
          hasMission || hasFusion || limitStatus ? (
            <>
              {limitStatus && (
                <span
                  className="grid size-3 shrink-0 place-items-center"
                  title={
                    limitStatus === "stuck"
                      ? "Parou num limite de uso, precisa de você"
                      : "Aguardando reset do limite, retomando automaticamente"
                  }
                >
                  <Timer
                    className={cn(
                      "size-3",
                      limitStatus === "stuck"
                        ? "text-st-warning"
                        : "text-muted-foreground/70",
                    )}
                    aria-label={
                      limitStatus === "stuck"
                        ? "limite atingido, precisa de você"
                        : "aguardando reset do limite"
                    }
                  />
                </span>
              )}
              {hasMission && (
                <span
                  className="grid size-3 shrink-0 place-items-center"
                  title="Missão rodando"
                >
                  {/* S3.2 — pulso só no "esperando você"; missão rodando é
                      presença calma. Brass sai (fica pra gesto e marca). */}
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
                  "group/c relative flex items-center rounded-md transition-colors",
                  // SELEÇÃO NÃO É COR (§2): preenchimento neutro, nada de tinta.
                  isFull
                    ? "bg-sel"
                    : isDimmed
                      ? "bg-sel-hover"
                      : "hover:bg-sel-hover",
                )}
                // Cor-rótulo tinge a LINHA INTEIRA, SEMPRE (pedido do usuário,
                // 04/08: a versão anterior degradava pra bolinha na linha ativa
                // e a cor "sumia" justo na conversa aberta, duplicando sinal).
                // Na ativa/dim a cor MISTURA com o preenchimento de seleção;
                // quem diz "você está aqui" é o preenchimento + o peso, que a
                // lavagem não apaga. Fora delas, lavagem sobre transparente.
                style={
                  c.color
                    ? {
                        background: `color-mix(in srgb, ${c.color} 12%, ${
                          isFull
                            ? "var(--sel)"
                            : isDimmed
                              ? "var(--sel-hover)"
                              : "transparent"
                        })`,
                      }
                    : undefined
                }
              >
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
                      "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 pl-[18px] text-left text-[12px]",
                      // S3.6 — texto ativo em foreground: brass 12px sobre a
                      // superfície de hover no tema claro media 3.56:1 (< 4.5:1,
                      // reprova AA). Peso 500 é o segundo canal da receita de
                      // seleção; dim = ativa noutra superfície (muted, sem
                      // peso); inativo = cinza médio, clareia no hover.
                      isFull
                        ? "font-medium text-foreground"
                        : isDimmed
                          ? "font-normal text-muted-foreground"
                          : "font-normal text-muted-foreground group-hover/c:text-foreground",
                    )}
                  >
                    {/* Marca do motor: IDENTIDADE, e só. Permanente nos quatro
                        estados, monocromática, sem selo grudado (o selo se mudou
                        pro slot direito, ADR-043). É o único lugar da árvore
                        onde o motor aparece num app agnóstico de propósito. */}
                    <AgentMark
                      // sem carimbo ainda (conversa nova, nada enviado) → mostra
                      // o SEU default, não "claude-code" fixo: a linha não pode
                      // afirmar um agent que você não escolheu.
                      agent={c.agent ?? defaultAgent}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {c.title ?? "Nova conversa"}
                    </span>
                    {hasDraft && (
                      <span
                        className="shrink-0 text-[11px] text-faint"
                        title="Há texto ou anexos não enviados nesta conversa"
                      >
                        Rascunho
                      </span>
                    )}
                    {/* S3.2 — worktree é CONTEXTO, não seleção nem marca: sai
                        do brass (que fica pra gesto e marca) e vira muted. */}
                    {c.worktreePath && (
                      <GitBranch
                        className="size-3 shrink-0 text-muted-foreground"
                        aria-label="isolado em worktree"
                      />
                    )}
                    {statusEl && (
                      <span className="flex shrink-0 items-center gap-1">
                        {statusEl}
                      </span>
                    )}
                    {/* Slot: dono único do "quando?", ordem fechada
                        pede > rodando > falhou > tempo relativo. */}
                    <ConversationSlot
                      pede={isAwaiting}
                      rodando={isRunning}
                      falhou={doneUnseen === "error"}
                      updatedAt={c.updatedAt}
                    />
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
                onSelect={() => void askDeleteConv(c.id, c.title, c.worktreePath)}
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
        className="flex items-center gap-3 rounded-md p-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-sel-hover hover:text-foreground"
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
