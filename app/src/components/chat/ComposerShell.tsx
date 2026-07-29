import { useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * Casca compartilhada dos composers (Linear `CommandConsole` + launch-pad da
 * Arena). É SÓ chrome: o cartão `rounded-2xl border bg-card`, um slot de chips
 * acima do <Textarea>, e um footer com os controles de cada lugar. A lógica
 * (popovers, histórico, paste, submit) fica nos consumidores, aqui não há
 * regra de negócio.
 *
 * `focusRing` liga o comportamento do console Linear: cursor-text no cartão,
 * clique no cartão → foca o textarea, e o anel brass quando focado. O launch-pad
 * da Arena passa `focusRing={false}` e seu próprio `cardClassName` ("p-3").
 *
 * `input` (opt-in, FASE 1 do Lexical): substitui o <Textarea> interno por um
 * editor próprio (o LexicalComposer da conversa) MANTENDO o cartão, o header
 * de execução, os chips, o footer e o anel brass. Quando passado, as props de
 * textarea (value/onChange/onKeyDown/onPaste/onSelect/mentionNames) são
 * ignoradas; o clique no cartão foca via `onCardClick` e o anel de foco segue
 * o focus/blur borbulhado do editor. Sem `input`, nada muda — o Textarea segue
 * sendo o default.
 */
export function ComposerShell({
  textareaRef,
  value,
  onChange,
  onKeyDown,
  onPaste,
  onSelect,
  placeholder,
  rows = 1,
  disabled,
  focusRing = false,
  cardClassName,
  textareaClassName,
  footerClassName,
  chips,
  header,
  footer,
  input,
  onCardClick,
}: {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  value?: string
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>
  onSelect?: React.ReactEventHandler<HTMLTextAreaElement>
  placeholder?: string
  rows?: number
  disabled?: boolean
  /** Liga cursor-text + clique→foca + anel brass no foco (console Linear). */
  focusRing?: boolean
  cardClassName?: string
  textareaClassName?: string
  footerClassName?: string
  /** Faixa acima do textarea (chips de anexo / liga). Já vem com seu wrapper. */
  chips?: React.ReactNode
  /** Faixa no TOPO do cartão, acima dos chips: a linha de execução do console
   *  Linear (permissão, planejar, contexto, identidade). Separada de `chips` de
   *  propósito — se dividisse o slot, a ordem visual ficaria presa à presença de
   *  anexo. */
  header?: React.ReactNode
  footer: React.ReactNode
  /** Input alternativo (editor Lexical) no lugar do <Textarea> interno. */
  input?: React.ReactNode
  /** Foco do clique no cartão quando `input` é usado (não há textareaRef). */
  onCardClick?: () => void
}) {
  const [focused, setFocused] = useState(false)

  const textarea = (
    <Textarea
      ref={textareaRef}
      // alvo estável p/ foco programático (tray://new-task): só o console
      // Linear (focusRing) ganha a marca — o launch-pad da Arena não.
      data-composer={focusRing ? "console" : undefined}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onSelect={onSelect}
      onFocus={focusRing ? () => setFocused(true) : undefined}
      onBlur={focusRing ? () => setFocused(false) : undefined}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={textareaClassName}
    />
  )

  return (
    <div
      onClick={
        focusRing
          ? (onCardClick ?? (() => textareaRef?.current?.focus()))
          : undefined
      }
      className={
        focusRing
          ? cn(
              "flex cursor-text flex-col rounded-2xl border bg-card transition-[box-shadow,border-color] duration-200",
              "shadow-[var(--shadow-pop)]",
              focused
                ? "border-brass/70 shadow-[0_0_0_3px_var(--brass-soft),var(--shadow-pop)]"
                : "hover:border-border-strong",
              cardClassName,
            )
          : cn("rounded-2xl border bg-card shadow-[var(--shadow-pop)]", cardClassName)
      }
    >
      {header}
      {chips}
      {input ? (
        // input alternativo (Lexical): o anel de foco escuta o focus/blur que
        // borbulha do contenteditable (React delega focusin/focusout).
        <div
          onFocus={focusRing ? () => setFocused(true) : undefined}
          onBlur={focusRing ? () => setFocused(false) : undefined}
        >
          {input}
        </div>
      ) : (
        textarea
      )}
      <div className={cn("flex items-center gap-2", footerClassName)}>{footer}</div>
    </div>
  )
}
