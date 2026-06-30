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
  footer,
}: {
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>
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
  footer: React.ReactNode
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div
      onClick={focusRing ? () => textareaRef?.current?.focus() : undefined}
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
      {chips}
      <Textarea
        ref={textareaRef}
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
      <div className={cn("flex items-center gap-2", footerClassName)}>{footer}</div>
    </div>
  )
}
