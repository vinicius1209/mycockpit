import { useState } from "react"
import { cn } from "@/lib/utils"

/**
 * Casca compartilhada do composer: SÓ chrome. O cartão `rounded-2xl border
 * bg-card`, um slot de chips acima do editor, um header de execução e um footer
 * com os controles. A lógica (popovers, histórico, paste, submit) mora no
 * consumidor; aqui não há regra de negócio.
 *
 * `input` é o editor de verdade (o `LexicalComposer` da conversa) — a casca só
 * o embrulha mantendo cartão, header, chips, footer e o anel de foco. Desde o
 * cutover do composer (Lexical vira o único) NÃO há mais fallback de
 * `<textarea>`: o editor é sempre passado por `input`.
 *
 * `focusRing` liga o comportamento do console: cursor-text no cartão, clique no
 * cartão → `onCardClick` (foca o editor) e o anel brass quando focado. O anel
 * escuta o focus/blur que borbulha do contenteditable.
 */
export function ComposerShell({
  focusRing = false,
  cardClassName,
  footerClassName,
  chips,
  header,
  footer,
  input,
  onCardClick,
}: {
  /** Liga cursor-text + clique→foca + anel brass no foco (console Linear). */
  focusRing?: boolean
  cardClassName?: string
  footerClassName?: string
  /** Faixa acima do editor (chips de anexo / liga). Já vem com seu wrapper. */
  chips?: React.ReactNode
  /** Faixa no TOPO do cartão, acima dos chips: a linha de execução do console
   *  (permissão, planejar, contexto, identidade). Separada de `chips` de
   *  propósito — se dividisse o slot, a ordem visual ficaria presa à presença de
   *  anexo. */
  header?: React.ReactNode
  footer: React.ReactNode
  /** O editor (Lexical) que vive no lugar do input. */
  input: React.ReactNode
  /** Foco do clique no cartão (não há ref do editor aqui). */
  onCardClick?: () => void
}) {
  const [focused, setFocused] = useState(false)

  return (
    <div
      onClick={focusRing ? onCardClick : undefined}
      className={
        focusRing
          ? cn(
              "flex cursor-text flex-col rounded-2xl border bg-card transition-[box-shadow,border-color] duration-200",
              "shadow-[var(--shadow-pop)]",
              focused
                ? "border-foreground/25 shadow-[0_0_0_1px_rgba(255,255,255,0.06),var(--shadow-pop)]"
                : "hover:border-border-strong",
              cardClassName,
            )
          : cn("rounded-2xl border bg-card shadow-[var(--shadow-pop)]", cardClassName)
      }
    >
      {header}
      {chips}
      {/* o anel de foco escuta o focus/blur que borbulha do contenteditable
          (React delega focusin/focusout). */}
      <div
        onFocus={focusRing ? () => setFocused(true) : undefined}
        onBlur={focusRing ? () => setFocused(false) : undefined}
      >
        {input}
      </div>
      {/* `@container/composer`: o rodapé mede a PRÓPRIA largura (a conversa
          encolhe com Bastidores e painéis abertos) e os rótulos do despacho
          viram ícone antes de estourar o cartão. `flex-wrap` é a rede: se ainda
          assim não couber, o despacho desce de linha, nunca vaza (build #386). */}
      <div className={cn("@container/composer flex flex-wrap items-center gap-2", footerClassName)}>{footer}</div>
    </div>
  )
}
