// A aba "Alterações" do painel PRINCIPAL: o diff com a largura que código pede.
//
// Container fino de propósito. Ele existe pra resolver UMA coisa que o
// `DiffPanel` não deve saber: qual é o `cwd` desta conversa — worktree isolado
// quando ela está isolada, pasta do projeto quando não. É a mesma conta que o
// `ContextPanel` faz pra coluna, e ela mora nos dois lugares porque cada um lê
// a store no seu próprio ciclo; extrair um hook só pra isso seria indireção
// sem ganho.
//
// Não recebe `delivery` nem `ShipBar`: entrega e commit/PR são decisão, e
// decisão ficou com a coluna (F1.3).

import { DiffPanel } from "@/components/layout/DiffPanel"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

export function DiffTab({
  focusPath,
  focusSeq,
  soArquivo,
}: {
  focusPath?: string
  focusSeq?: number
  /** A aba das alterações de UM arquivo (ADR-248): só ele. */
  soArquivo?: string
}) {
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
  const activeConvId = useChat((s) => s.activeId)
  // Seletor devolve string|null (primitivo estável), nunca objeto novo — objeto
  // aqui re-renderiza a aba a cada mudança da store.
  const worktree = useChat(
    (s) =>
      (s.conversationsByProject[s.projectId ?? ""] ?? s.conversations).find(
        (c) => c.id === s.activeId,
      )?.worktreePath ?? null,
  )

  if (!project) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        Nenhum projeto selecionado.
      </div>
    )
  }
  return (
    <DiffPanel
      cwd={worktree ?? project.path}
      focusPath={focusPath}
      focusSeq={focusSeq}
      soArquivo={soArquivo}
      // Mandar os comentários pro composer VOLTA para a Conversa: o texto foi
      // parar lá, e deixar você olhando o diff enquanto o rascunho espera do
      // outro lado é esconder o resultado do próprio gesto. A aba do arquivo
      // fica na tira (ADR-248).
      onSendToComposer={(text) => {
        if (!activeConvId) return
        useComposerDrafts.getState().appendText(activeConvId, text)
        useApp.getState().closeMainTab()
        setTimeout(focusConsoleComposer, 120)
      }}
    />
  )
}
