// SPIKE — remover após validação.
//
// Prova de conceito de um composer baseado em Lexical com PILLS DE MENÇÃO
// ATÔMICAS de verdade: `@nome` vira um token que o cursor não entra, o
// Backspace apaga inteiro e as setas pulam por cima (estilo Slack/Linear/Claude
// Code CLI). NÃO substitui o composer de produção (CommandConsole/ComposerShell);
// é aditivo e isolado, montado num card rotulado acima do composer real pra o
// usuário validar o feel ANTES de qualquer migração.
//
// Lib de menção: `lexical-beautiful-mentions` (plugin pronto, pill atômico via
// DecoratorNode + menu de sugestões). Serialização Enter→texto reusa o
// getTextContent do nó (que devolve `@nome`).

import { useCallback } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, KEY_ENTER_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical"
import {
  BeautifulMentionsPlugin,
  BeautifulMentionNode,
  type BeautifulMentionsTheme,
} from "lexical-beautiful-mentions"
import { usePresets } from "@/store/presets"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { cn } from "@/lib/utils"

// Tema da menção: chip brass no tema escuro do app. As chaves são regex que
// casam o trigger (`@`); `Focused` aplica o estado selecionado do pill.
const mentionsTheme: BeautifulMentionsTheme = {
  "@": cn(
    "rounded bg-brass/[0.14] px-1 font-medium text-brass",
    "align-baseline transition-colors",
  ),
  "@Focused": cn(
    "rounded bg-brass/25 px-1 font-medium text-brass",
    "outline outline-1 outline-brass/50",
  ),
}

/** Enter (sem shift) serializa o conteúdo e "envia"; o texto sai com as menções
 *  como `@nome` (getTextContent do BeautifulMentionNode). Registrado como
 *  comando de alta prioridade pra vencer o insert-parágrafo padrão do RichText —
 *  mas só quando o menu de sugestões NÃO está aberto (aí o Enter escolhe o item).
 */
function EnterToSubmitPlugin({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const handle = useCallback(
    (event: KeyboardEvent | null): boolean => {
      // menu de menção aberto → deixa o plugin de menção consumir o Enter.
      const menuOpen = document.querySelector(
        "[data-beautiful-mention-menu], .beautiful-mentions-menu",
      )
      if (menuOpen) return false
      if (event?.shiftKey) return false // Shift+Enter = quebra de linha
      event?.preventDefault()
      const text = editor.getEditorState().read(() => $getRoot().getTextContent())
      onSubmit(text.trim())
      editor.update(() => {
        $getRoot().clear()
      })
      return true
    },
    [editor, onSubmit],
  )
  editor.registerCommand(KEY_ENTER_COMMAND, handle, COMMAND_PRIORITY_HIGH)
  return null
}

export function LexicalComposerSpike({
  onSubmit,
}: {
  onSubmit?: (text: string) => void
}) {
  // Personas conhecidas = a mesma lista do marketplace (fonte única).
  const personas = usePresets((s) => s.list)
  const mentionItems = {
    "@": personas.map((p) => p.name),
  }

  const initialConfig = {
    namespace: "LexicalComposerSpike",
    theme: { beautifulMentions: mentionsTheme },
    nodes: [BeautifulMentionNode],
    onError(error: Error) {
      // spike: não engolir em silêncio, mas também não derrubar o app real.
      console.error("[LexicalComposerSpike]", error)
    },
  }

  const submit = useCallback(
    (text: string) => {
      if (!text) return
      if (onSubmit) onSubmit(text)
      else console.info("[LexicalComposerSpike] enviar:", text)
    },
    [onSubmit],
  )

  return (
    <div className="rounded-xl border border-brass/40 bg-card/60 p-3">
      <p className="mb-2 text-[11px] font-medium tracking-wide text-brass/80">
        ⚗️ Spike Lexical · menção atômica (validar)
      </p>
      <div className="relative rounded-lg border bg-background/60 px-3 py-2 text-[14px]">
        <LexicalComposer initialConfig={initialConfig}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="min-h-[24px] w-full resize-none whitespace-pre-wrap break-words text-foreground outline-none"
                aria-label="Composer de teste (Lexical)"
              />
            }
            placeholder={
              <div className="pointer-events-none absolute left-3 top-2 text-[14px] text-muted-foreground/60">
                Experimente: digite @ e escolha um especialista…
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <BeautifulMentionsPlugin
            items={mentionItems}
            menuComponent={MentionsMenu}
            menuItemComponent={MentionsMenuItem}
          />
          <EnterToSubmitPlugin onSubmit={submit} />
        </LexicalComposer>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground/70">
        Enter envia (serializa com @nome) · Shift+Enter quebra linha · Backspace
        no fim de um pill apaga o pill inteiro
      </p>
    </div>
  )
}

// Menu de sugestões no NOSSO padrão (mesmo visual do AtPopover, ComposerParts):
// card popover da casa + cabeçalho de seção "Especialistas" + itens avatar+nome
// (sem o "@" na frente, o gatilho já foi digitado). Este menu é o que a migração
// real vai reusar, então segue a estrutura do AtPopover de perto.
//
// A lib porta o menu num anchor posicionado abaixo do cursor (LexicalTypeahead),
// então NÃO posicionamos aqui — só o chrome do card.
function MentionsMenu({
  loading,
  children,
  ...props
}: {
  loading?: boolean
  children?: React.ReactNode
} & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className="z-50 mt-1 max-h-72 w-[240px] overflow-auto rounded-xl border bg-popover p-1 shadow-[var(--shadow-pop)]"
      {...props}
    >
      {/* Cabeçalho de seção, como o AtPopover. Só especialistas por ora (arquivos
          ficam pra migração real). */}
      <li
        aria-hidden
        className="px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/80"
      >
        Especialistas
      </li>
      {loading ? (
        <li className="px-3 py-1.5 text-[12px] text-muted-foreground">
          Carregando…
        </li>
      ) : (
        children
      )}
    </ul>
  )
}

// Item: avatar da persona (resolvido pelo def) + nome. O def vem do usePresets
// casando por nome (mesma fonte única do marketplace) — assim o AgentAvatar pega
// a cara certa por categoria. Estilo idêntico ao item do AtPopover.
function MentionsMenuItem({
  selected,
  item,
  ...props
}: {
  selected: boolean
  item: { value: string }
} & React.LiHTMLAttributes<HTMLLIElement>) {
  const def = usePresets((s) => s.list.find((d) => d.name === item.value))
  return (
    <li
      className={cn(
        "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-left",
        selected ? "bg-accent" : "hover:bg-accent/50",
      )}
      {...props}
    >
      {def ? (
        <AgentAvatar def={def} size={20} rounded />
      ) : (
        <span className="size-5 shrink-0 rounded-full bg-brass/20" />
      )}
      <span className="truncate text-[13px] font-medium text-foreground">
        {item.value}
      </span>
    </li>
  )
}
