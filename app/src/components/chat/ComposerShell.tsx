import { useRef, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { splitMentions } from "@/components/chat/mentions"
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
 * `mentionNames` (opt-in): destaca `@nome` AO VIVO enquanto digita. Textarea não
 * estiliza pedaço de texto, então usamos a técnica do OVERLAY — um espelho atrás
 * do textarea com o MESMO box (`textareaClassName`), mostrando o texto com os
 * `@nomes-conhecidos` em chip brass; o textarea fica com texto transparente e só
 * o cursor visível. Só o composer da conversa liga isso.
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
  mentionNames,
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
  /** Faixa no TOPO do cartão, acima dos chips: a linha de execução do console
   *  Linear (permissão, planejar, contexto, identidade). Separada de `chips` de
   *  propósito — se dividisse o slot, a ordem visual ficaria presa à presença de
   *  anexo. */
  header?: React.ReactNode
  footer: React.ReactNode
  /** Nomes de personas conhecidas — quando passado, `@nome` é destacado ao vivo. */
  mentionNames?: string[]
}) {
  const [focused, setFocused] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const highlight = !!mentionNames && mentionNames.length > 0

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
      onScroll={
        highlight
          ? (e) => {
              if (overlayRef.current)
                overlayRef.current.scrollTop = e.currentTarget.scrollTop
            }
          : undefined
      }
      onFocus={focusRing ? () => setFocused(true) : undefined}
      onBlur={focusRing ? () => setFocused(false) : undefined}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={cn(
        textareaClassName,
        // texto invisível (o overlay mostra o texto estilizado), cursor visível;
        // texto SELECIONADO volta a aparecer pra a seleção não ficar fantasma.
        highlight &&
          "relative z-10 text-transparent caret-[var(--foreground)] selection:text-foreground",
      )}
    />
  )

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
      {header}
      {chips}
      {highlight ? (
        <div className="relative">
          {/* espelho: MESMO box do textarea (textareaClassName) → alinha pixel a
              pixel. Mostra o texto; `@nome-conhecido` vira chip brass. */}
          <div
            ref={overlayRef}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap",
              textareaClassName,
            )}
          >
            {splitMentions(value, mentionNames!).map((seg, i) =>
              seg.type === "mention" ? (
                <span
                  key={i}
                  className="rounded bg-brass/[0.14] font-medium text-brass"
                >
                  {seg.text}
                </span>
              ) : (
                <span key={i} className="text-foreground">
                  {seg.text}
                </span>
              ),
            )}
            {/* garante a altura da última linha quando o texto termina em \n */}
            {"\n"}
          </div>
          {textarea}
        </div>
      ) : (
        textarea
      )}
      <div className={cn("flex items-center gap-2", footerClassName)}>{footer}</div>
    </div>
  )
}
