import { useEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical"
import { $serializeDraft } from "@/components/chat/lexicalDraft"
import { guardarRascunho } from "@/components/notes/notaGuardada"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

type SendShortcut = "enter" | "cmd-enter"
type EnterTarget = "submit" | "force" | "guardar" | null

export function enterTarget(
  shortcut: SendShortcut,
  modifiers: { command: boolean; shift: boolean; alt?: boolean },
  canForce: boolean,
): EnterTarget {
  // ⌥↵ guarda como nota desta conversa (docs/composer-vira-nota-prd.md D6),
  // nos dois atalhos de envio. Antes ele caía no Enter e enviava.
  if (modifiers.alt && !modifiers.command && !modifiers.shift) return "guardar"
  const triggers =
    shortcut === "cmd-enter" ? modifiers.command : !modifiers.shift
  if (!triggers) return null
  return canForce ? "force" : "submit"
}

/** Enter corrige o turno em voo; Tab guarda a mensagem para o próximo turno.
 *  O menu "/" registra as mesmas teclas em prioridade CRITICAL e continua
 *  vencendo este plugin quando está aberto. */
export function ComposerSubmitKeys({
  onSubmit,
  onForceSubmit,
  onQueueSubmit,
}: {
  onSubmit: (text: string) => void
  onForceSubmit?: (text: string) => void
  onQueueSubmit?: (text: string) => void
}) {
  const [editor] = useLexicalComposerContext()
  const callbacks = useRef({ onSubmit, onForceSubmit, onQueueSubmit })
  callbacks.current = { onSubmit, onForceSubmit, onQueueSubmit }
  const shortcut = useApp(
    (s) => s.settings.userPreferences?.composerSendShortcut ?? "enter",
  )

  useEffect(() => {
    const serialize = () => editor.getEditorState().read($serializeDraft).trim()
    const unregister = [
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event?.isComposing) return false
          if (document.querySelector("[data-beautiful-mention-menu]")) return false
          const target = enterTarget(
            shortcut,
            {
              command: !!(event?.metaKey || event?.ctrlKey),
              shift: !!event?.shiftKey,
              alt: !!event?.altKey,
            },
            !!callbacks.current.onForceSubmit,
          )
          if (!target) return false
          event?.preventDefault()
          const text = serialize()
          if (target === "guardar") {
            const convId = useChat.getState().activeId
            if (convId) void guardarRascunho(convId, "conversa", text)
            return true
          }
          if (target === "force") callbacks.current.onForceSubmit?.(text)
          else callbacks.current.onSubmit(text)
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          if (event?.isComposing || !callbacks.current.onQueueSubmit) return false
          if (document.querySelector("[data-beautiful-mention-menu]")) return false
          event?.preventDefault()
          callbacks.current.onQueueSubmit(serialize())
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    ]
    return () => unregister.forEach((remove) => remove())
  }, [editor, shortcut])
  return null
}
