import { retomadaAgendada } from "@/lib/autoResume"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { confirm } from "@/lib/confirm"
import { createWorktree, removeWorktree, worktreeRemovalNote } from "@/lib/git"
import { useWorktrees } from "@/store/worktrees"
import { useReordenacaoFluida } from "@/lib/reordenacaoFluida"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useAwaiting } from "@/store/interactions"
import { useMission } from "@/store/mission"
import type { ConversationMeta } from "@/lib/db/conversations"
import { hasComposerDraft, useComposerDrafts } from "@/store/composerDrafts"
import { ConversationRow } from "@/components/layout/ConversationRow"
import {
  EMPTY_CONVERSATIONS,
  groupConversationTree,
} from "@/components/layout/conversationTree"

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
      .filter(([, c]) => retomadaAgendada(c) || (c.limitHitThisTurn && !c.running))
      .map(([id, c]) => `${id}:${retomadaAgendada(c) ? "pending" : "stuck"}`)
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

/** Lista de conversas (tarefas) de UM projeto (árvore independente: pode haver
 *  várias montadas ao mesmo tempo, cada uma lendo a lista do seu projectId). */
/** Nova conversa no projeto: ativa o projeto, cria a conversa e ABRE o
 *  Trabalho (criar e continuar olhando o Painel deixava o clique mudo). Era a
 *  linha "Nova tarefa" no fim de cada projeto; desde a ADR-245 é o "+" que
 *  aparece no hover da linha do projeto. */
export function abrirNovaConversa(projectId: string): void {
  const app = useApp.getState()
  if (projectId !== app.activeProjectId) app.setActiveProject(projectId)
  app.setScheduledOpen(false)
  app.setViewMode("linear")
  void useChat.getState().newConversation(projectId)
}

export function ConversationList({ projectId }: { projectId: string }) {
  // default FORA do selector (?? numa constante estável): selector devolve o
  // array do store (ref estável) ou undefined (estável) — nunca um `[]` novo.
  const conversations =
    useChat((s) => s.conversationsByProject[projectId]) ?? EMPTY_CONVERSATIONS
  const activeId = useChat((s) => s.activeId)
  const switchConversation = useChat((s) => s.switchConversation)
  const removeConversation = useChat((s) => s.removeConversation)
  const renameConversation = useChat((s) => s.renameConversation)
  const setConversationColor = useChat((s) => s.setConversationColor)
  const duplicateConversation = useChat((s) => s.duplicateConversation)
  const setWorktree = useChat((s) => s.setWorktree)
  const moveConversation = useChat((s) => s.moveConversation)
  // S1.2 — payload de drag de CONVERSA, escopado pelo projeto: o dragover de
  // uma lista só aceita conversa DA MESMA lista (mover entre projetos está
  // fora de escopo). O tipo é lowercased pelo browser — ids uuid já são.
  // Projeto DESTA lista (não o ativo): worktree/isolamento usam o path certo,
  // mesmo numa árvore de projeto não-ativo.
  const project = useApp((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const setActiveProject = useApp((s) => s.setActiveProject)
  // F1 — a seleção só DIRIGE o detalhe no modo linear; nos demais, o item ativo
  // renderiza dimmed (memória preservada, ênfase removida). String estável.
  const viewMode = useApp((s) => s.scheduledOpen || s.flightPlansOpen || s.fleetOpen ? "global" : s.viewMode)
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

  // Clicar numa conversa: torna o projeto DELA o ativo (abre no painel) e troca
  // a conversa. Funciona pra projeto não-ativo (setActive + switch pelo id único).
  function openConv(id: string) {
    if (projectId !== useApp.getState().activeProjectId) setActiveProject(projectId)
    // navegar pra uma conversa fecha a view global "Agendado" (se aberta) —
    // mesmo quando o projeto já é o ativo (setActiveProject não roda).
    useApp.getState().setScheduledOpen(false)
    useApp.getState().setBranchSplitOpen(false)
    // Clicar numa conversa NAVEGA até ela: estando no Painel, troca pro
    // Trabalho (senão o clique só muda o store e a tela não reage = cara de bug).
    // Mesmo contrato dos outros caminhos (MissionControl, InboxBell, Agendado).
    useApp.getState().setViewMode("linear")
    void switchConversation(id)
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

  const tree = useMemo(() => groupConversationTree(conversations), [conversations])
  // Reordenar anima em vez de saltar. A assinatura é a ORDEM, não a lista: mudar
  // título ou estado de uma conversa não é reposicionamento e não move nada.
  const listaRef = useRef<HTMLDivElement>(null)
  useReordenacaoFluida(
    listaRef,
    useMemo(() => conversations.map((c) => c.id).join(","), [conversations]),
  )
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  return (
    // Sem border-l nem indentação de container: a hierarquia é só alinhamento.
    // Cada filho recebe ~40px de recuo → texto sob o texto do projeto. Na linha
    // de conversa, parte desse recuo é a marca do agent (esquerda), então o
    // padding cai para 18px e a soma continua batendo.
    <div
      ref={listaRef}
      className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px"
    >
      {tree.map((node, rootIdx) => {
        const hasChildren = node.children.length > 0
        const isChildActive = node.children.some((child) => child.id === activeId)
        const isRootActive = node.item.id === activeId
        const isGroupActive = isRootActive || isChildActive
        const isCollapsed = !!collapsed[node.item.id] && !isGroupActive

        const renderRow = (
          c: ConversationMeta,
          idx: number,
          isChild: boolean,
          branchCount?: number,
        ) => (
          <ConversationRow
            key={c.id}
            c={c}
            isChild={isChild}
            branchCount={branchCount}
            isCollapsed={isCollapsed}
            onToggleCollapse={
              hasChildren
                ? () =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [node.item.id]: !prev[node.item.id],
                    }))
                : undefined
            }
            idx={idx}
            totalCount={conversations.length}
            projectId={projectId}
            activeId={activeId}
            viewMode={viewMode}
            defaultAgent={defaultAgent}
            isRunning={running.has(c.id)}
            doneUnseen={finished.get(c.id)}
            isDeciding={deciding.has(c.id)}
            hasFusion={fusionAlive.has(c.id)}
            hasMission={missionRunning.has(c.id)}
            isAwaiting={awaiting.convIds.has(c.id)}
            limitStatus={limitState.get(c.id)}
            hasDraft={
              draftPresence.has(c.id)
                ? draftPresence.get(c.id)!
                : !!c.hasDraft
            }
            openConv={openConv}
            moveConversation={moveConversation}
            duplicateConversation={duplicateConversation}
            toggleWorktree={toggleWorktree}
            askDeleteConv={askDeleteConv}
            renameConversation={(id, t) => void renameConversation(id, t)}
            setConversationColor={(id, col) => void setConversationColor(id, col)}
          />
        )

        return (
          <div key={node.item.id} className="flex flex-col gap-px">
            {renderRow(node.item, rootIdx, false, hasChildren ? node.children.length + 1 : 0)}
            {hasChildren &&
              !isCollapsed &&
              node.children.map((child, childIdx) =>
                renderRow(child, rootIdx + childIdx + 1, true),
              )}
          </div>
        )
      })}
    </div>
  )
}
