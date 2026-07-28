// Composer Lexical da conversa (FASE 1 — núcleo). Promovido do spike validado.
//
// É o INPUT do console (substitui o <Textarea> via slot `input` do
// ComposerShell quando Settings → Comportamento liga o "Composer Lexical").
// O que ele entrega nesta fase:
//   - texto com Enter=envia / Shift+Enter=quebra linha (semântica do console);
//   - `@` menção ATÔMICA (pill via lexical-beautiful-mentions) com o nosso
//     menu (AgentAvatar + nome, seção "Especialistas");
//   - draft por conversa: a fonte da verdade segue a string em useChat.drafts —
//     o editor serializa a cada mudança e reconstrói quando o valor muda por
//     fora (troca de conversa, sugestão, limpeza pós-envio);
//   - serialização = a MESMA string que o handleSend espera (menção → `@nome`),
//     via lexicalDraft.ts;
//   - alvo de foco `data-composer="console"` (tray://new-task e afins).
//
// FASE 2 (ainda só no textarea): comandos "/" (SlashPopover), "@" de arquivos
// (AtPopover legado), paste → anexo, histórico ↑/↓ estilo shell.

import { useEffect, useMemo, useRef } from "react"
import { LexicalComposer as LexicalComposerBase } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getRoot,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from "lexical"
import {
  BeautifulMentionsPlugin,
  BeautifulMentionNode,
  type BeautifulMentionsTheme,
} from "lexical-beautiful-mentions"
import { $serializeDraft, $setDraft } from "@/components/chat/lexicalDraft"
import { usePresets } from "@/store/presets"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { cn } from "@/lib/utils"

// Tema da menção: chip brass no tema do app. As chaves casam o trigger (`@`);
// `Focused` aplica o estado selecionado do pill.
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

/** Enter (sem shift) serializa e envia; Shift+Enter deixa o RichText quebrar
 *  linha. Registrado em prioridade ALTA pra vencer o insert-parágrafo padrão —
 *  por isso as duas guardas são load-bearing:
 *  - menu de menção aberto (o nosso MentionsMenu carrega
 *    `data-beautiful-mention-menu`) → o Enter escolhe o item, não envia;
 *  - IME compondo (acento/CJK) → o Enter confirma a composição, não envia. */
function EnterToSubmitPlugin({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null): boolean => {
        if (event?.isComposing) return false
        if (document.querySelector("[data-beautiful-mention-menu]")) return false
        if (event?.shiftKey) return false
        event?.preventDefault()
        const text = editor.getEditorState().read($serializeDraft)
        onSubmitRef.current(text.trim())
        editor.update(() => {
          $getRoot().clear()
        })
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])
  return null
}

/** Mantém o editor espelhando o draft externo. `lastText` guarda o último
 *  texto que SAIU do editor (via OnChange) — se o valor externo divergir, foi
 *  mudança de fora (troca de conversa, sugestão, limpeza pós-envio) e o
 *  conteúdo é reconstruído, com o histórico de undo zerado (senão o ⌘Z traria
 *  de volta o texto de OUTRA conversa). */
function DraftSyncPlugin({
  value,
  mentionNames,
  lastText,
}: {
  value: string
  mentionNames: string[]
  lastText: React.RefObject<string | null>
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    if (value === lastText.current) return
    lastText.current = value
    editor.update(
      () => {
        $setDraft(value, mentionNames)
      },
      { discrete: true },
    )
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
    // mentionNames de propósito FORA das deps: a lista só importa na hora de
    // reconstruir; mudar a lista sozinha não deve reescrever o que o usuário
    // está digitando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value, lastText])
  return null
}

/** Expõe o foco programático do editor pro dono (submit refoca, clique no
 *  cartão foca — paridade com o textareaRef.focus() do console). */
function FocusBridgePlugin({
  registerFocus,
}: {
  registerFocus?: (fn: () => void) => void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    registerFocus?.(() => editor.focus())
  }, [editor, registerFocus])
  return null
}

export function LexicalComposer({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  mentionNames,
  className,
  registerFocus,
}: {
  /** Draft da conversa ativa (string com `@nome`) — fonte da verdade externa. */
  value: string
  /** Cada mudança no editor serializa e escreve aqui (vira o draft). */
  onChangeText: (text: string) => void
  /** Enter sem shift: recebe o texto serializado (menção → `@nome`). */
  onSubmit: (text: string) => void
  placeholder: string
  /** Personas conhecidas (mesma fonte do marketplace) → itens do menu `@`. */
  mentionNames: string[]
  /** Classes do box do input (as MESMAS do textarea, pra alinhar o cartão). */
  className?: string
  registerFocus?: (fn: () => void) => void
}) {
  // último texto emitido/recebido — evita loop OnChange ↔ DraftSync.
  const lastText = useRef<string | null>(null)
  const mentionItems = useMemo(() => ({ "@": mentionNames }), [mentionNames])

  const initialConfig = {
    namespace: "ChatComposer",
    theme: { beautifulMentions: mentionsTheme },
    nodes: [BeautifulMentionNode],
    onError(error: Error) {
      // não engolir em silêncio, mas também não derrubar a conversa.
      console.error("[LexicalComposer]", error)
    },
  }

  return (
    <div className="relative">
      <LexicalComposerBase initialConfig={initialConfig}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              // alvo estável p/ foco programático (tray://new-task) — mesmo
              // contrato do textarea do console.
              data-composer="console"
              aria-label="Mensagem"
              className={cn(
                "w-full overflow-y-auto break-words whitespace-pre-wrap text-foreground outline-none",
                className,
              )}
            />
          }
          placeholder={
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden text-muted-foreground",
                className,
              )}
            >
              {placeholder}
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
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState) => {
            const text = editorState.read($serializeDraft)
            if (text === lastText.current) return
            lastText.current = text
            onChangeText(text)
          }}
        />
        <EnterToSubmitPlugin onSubmit={onSubmit} />
        <DraftSyncPlugin
          value={value}
          mentionNames={mentionNames}
          lastText={lastText}
        />
        <FocusBridgePlugin registerFocus={registerFocus} />
      </LexicalComposerBase>
    </div>
  )
}

// Menu de sugestões no NOSSO padrão (mesmo visual do AtPopover, ComposerParts):
// card popover da casa + cabeçalho de seção "Especialistas" + itens avatar+nome
// (sem o "@" na frente, o gatilho já foi digitado).
//
// A lib porta o menu num anchor posicionado abaixo do cursor (LexicalTypeahead),
// então NÃO posicionamos aqui — só o chrome do card. O atributo
// `data-beautiful-mention-menu` é a guarda do EnterToSubmitPlugin (menu aberto
// → Enter escolhe, não envia); não remover.
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
      data-beautiful-mention-menu
      className="z-50 mt-1 max-h-72 w-[240px] overflow-auto rounded-xl border bg-popover p-1 shadow-[var(--shadow-pop)]"
      {...props}
    >
      {/* Cabeçalho de seção, como o AtPopover. Só especialistas por ora
          (arquivos/recursos do "@" legado ficam pra FASE 2). */}
      <li
        aria-hidden
        className="px-2 pt-1 pb-1 text-[10px] tracking-wide text-muted-foreground/80 uppercase"
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
