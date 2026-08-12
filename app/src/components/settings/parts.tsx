// Peças compartilhadas das Configurações. Existem para que a hierarquia seja
// a MESMA em toda seção (o "bagunçado" do build 191 era, em parte, cada bloco
// inventando o próprio cabeçalho):
//
//   SectionHeader  — o que esta seção responde (+ 1 ação, no máximo)
//   BlockTitle     — divisão interna da seção (etiqueta de instrumento, 11px)
//   Field          — uma preferência: rótulo/hint à esquerda, controle à direita
//   Note           — prosa de rodapé (o porquê, a periodicidade, o preço)
//
// Elevação: a seção é E0 (plano). Linha de lista é E1 (bg-card/borda hairline)
// e NÃO ganha outro cartão dentro — detalhe interno se separa por hairline.

import type { ReactNode } from "react"

/** Cabeçalho da seção: título + a pergunta que ela responde + ação opcional.
 *  `pr-9` reserva o canto do X do dialog (regra do DialogCloseX). */
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string | null
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 pr-9">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** Divisão interna da seção. `hint` explica o bloco em uma linha. */
export function BlockTitle({
  children,
  hint,
}: {
  children: ReactNode
  hint?: string
}) {
  return (
    <div className="mb-1.5">
      <h3 className="label-mono">{children}</h3>
      {hint && (
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

/** Uma preferência: rótulo (+hint) à esquerda, controle à direita. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-foreground">{label}</div>
        {hint && (
          <div className="text-[12px] leading-snug text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Prosa de rodapé de um bloco (periodicidade, preço, ressalva). */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
      {children}
    </p>
  )
}

/** Espaçamento entre blocos dentro de uma seção. */
export function Block({ children }: { children: ReactNode }) {
  return <div className="mt-6">{children}</div>
}

export const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"
