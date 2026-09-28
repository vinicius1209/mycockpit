// "Guardar para depois" no menu do despacho (docs/composer-vira-nota-prd.md
// D1, D2): o mesmo rascunho de Enviar, Disputa e Missão, com um destino que não
// aciona motor nenhum. O escopo vai escrito no rótulo, nunca herdado.
//
// Lê a store porque só monta com o menu ABERTO: o despacho segue puro para os
// testes estáticos, e o `CommandConsole` (no teto de tamanho) não ganha prop.

import { FolderClosed, StickyNote } from "lucide-react"
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { guardarRascunho, type EscopoDoGuardar } from "@/components/notes/notaGuardada"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { hasComposerDraft, useComposerDrafts } from "@/store/composerDrafts"

export function ItensDeGuardar() {
  const convId = useChat((s) => s.activeId)
  const projectId = useChat((s) => (s.activeId ? (s.byId[s.activeId]?.projectId ?? null) : null))
  const projeto = useApp((s) => s.projects.find((p) => p.id === projectId)?.name ?? null)
  const temConteudo = useComposerDrafts((s) => (convId ? hasComposerDraft(s.byConv[convId]) : false))
  const guardar = (escopo: EscopoDoGuardar) => {
    if (convId) void guardarRascunho(convId, escopo)
  }
  return (
    <>
      <DropdownMenuLabel className="font-mono text-[11px] font-normal tracking-wide text-muted-foreground uppercase">
        Guardar para depois
      </DropdownMenuLabel>
      <DropdownMenuItem onClick={() => guardar("conversa")} disabled={!temConteudo}>
        <StickyNote className="size-4 text-muted-foreground" />
        <span className="flex-1">Nota desta conversa</span>
        <span className="font-mono text-[11px] text-muted-foreground">⌥⏎</span>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => guardar("projeto")} disabled={!temConteudo || !projectId}>
        <FolderClosed className="size-4 text-muted-foreground" />
        <span className="flex-1">Nota do projeto</span>
        {projeto && <span className="max-w-24 truncate text-[11px] text-muted-foreground">{projeto}</span>}
      </DropdownMenuItem>
    </>
  )
}
