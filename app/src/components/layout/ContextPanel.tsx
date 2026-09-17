// O painel direito do Trabalho: a tira de abas e o roteamento entre elas, mais
// a entrega (P3) e a contagem de alterações que a tira anuncia. O conteúdo de
// cada aba mora no componente dela (a aba Contexto em `ContextoDoProjeto`).

import { ContextPanelTabs } from "@/components/layout/contextPanelChrome"
import { ContextoDoProjeto } from "@/components/layout/ContextoDoProjeto"
import { BastidoresNoPainel } from "@/components/bastidores/BastidoresNoPainel"
import { useBastidoresDaConversa } from "@/components/bastidores/useBastidoresDaConversa"
import { DiffIndex } from "@/components/layout/DiffIndex"
import { ActiveConversationMapPanel } from "@/components/layout/ActiveConversationMapPanel"
import { ProjectFilesPanel } from "@/components/layout/ProjectFilesPanel"
import { useContextPanelTab } from "@/components/layout/useContextPanelTab"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import { fixPrefill } from "@/lib/deliveryDiff"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { useGitChangedCount } from "@/hooks/useGitChangedCount"

export function ContextPanel() {
  const project = useActiveProject()
  // diff atribuído à conversa ativa: worktree isolado dela, senão a pasta do projeto.
  const activeWorktree = useChat(
    (s) =>
      (s.projectId
        ? s.conversationsByProject[s.projectId]
        : undefined
      )?.find((c) => c.id === s.activeId)?.worktreePath ?? null,
  )
  // P3: Entrega→diff só vale enquanto a conversa dela é a ativa.
  const activeConvId = useChat((s) => s.activeId)
  const activeTitle = useChat((s) => {
    if (!s.activeId || !s.projectId) return null
    return (
      s.conversationsByProject[s.projectId]?.find((c) => c.id === s.activeId)
        ?.title ?? null
    )
  })
  const deliveryDiff = useApp((s) => s.deliveryDiff)
  const delivery =
    deliveryDiff && deliveryDiff.convId === activeConvId ? deliveryDiff : null

  // Prefill + foco de “Pedir correção” (P3) e dos comentários do diff.
  function prefillComposer(convId: string, text: string) {
    useComposerDrafts.getState().setText(convId, text)
    setTimeout(focusConsoleComposer, 120)
  }

  function requestDeliveryFix() {
    if (!delivery) return
    prefillComposer(delivery.convId, fixPrefill(delivery.text))
    useApp.getState().clearDeliveryDiff()
  }

  function closeDeliveryDiff() {
    useApp.getState().clearDeliveryDiff()
    // Fechar a entrega é você saindo de Alterações de propósito: passa pelo
    // gesto (`selectTab`), senão o próximo run te arrastaria de volta pra lá.
    selectTab("contexto")
  }
  // running da conversa ativa: quando o turno termina, recarrega a contagem de
  // arquivos alterados (o diff mudou) → badge na aba Alterações.
  const running = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.running ?? false) : false,
  )
  // Agent da conversa ATIVA — a régua de quem lê o quê. Conversa nova já vem
  // carimbada (setConversationAgent), então isto reflete a escolha do composer.
  const defaultAgent = useApp((s) => s.settings.defaultAgent)
  const convAgent = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.agent ?? null) : null,
  )
  const readerAgent = convAgent ?? defaultAgent ?? null
  const changedCount = useGitChangedCount(
    activeWorktree ?? project?.path,
    // O turno que termina mudou o diff: recontar.
    String(running),
  )
  // Quem manda na aba (e por que) mora em useContextPanelTab: é regra com
  // estado próprio e incidente atrás, não render.
  const { tab, selectTab } = useContextPanelTab(running, delivery != null)
  // O contador da aba Bastidores é o único dado dela que muda sozinho (ADR-200).
  const liveCount = useBastidoresDaConversa().lista.filter((b) => b.estado === "vivo").length
  return (
    // CARTÃO FLUTUANTE (E1): superfície própria (`bg-card` + raio + `--shadow-sm`,
    // sem borda) — a proibição do §4 é de borda aninhada, não de raio, mas em
    // troca fica mais forte: nada aqui dentro pode ter hairline de largura total.
    <aside className="reveal-right flex h-full w-full flex-col overflow-hidden rounded-xl bg-card shadow-[var(--shadow-sm),var(--lift)]">
      <ContextPanelTabs
        tab={tab}
        changedCount={changedCount}
        liveCount={liveCount}
        onSelect={selectTab}
      />

      {!project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nenhum projeto selecionado.
          </p>
        </div>
      ) : tab === "arquivos" ? (
        <ProjectFilesPanel root={activeWorktree ?? project.path} />
      ) : tab === "conversa" ? (
        <ActiveConversationMapPanel
          conversationId={activeConvId}
          projectId={project.id}
          title={activeTitle}
        />
      ) : tab === "bastidores" ? (
        <BastidoresNoPainel />
      ) : tab === "alteracoes" ? (
        <DiffIndex
          cwd={activeWorktree ?? project.path}
          delivery={delivery}
          onRequestFix={requestDeliveryFix}
          onCloseDelivery={closeDeliveryDiff}
        />
      ) : (
        <ContextoDoProjeto project={project} readerAgent={readerAgent} />
      )}

    </aside>
  )
}
