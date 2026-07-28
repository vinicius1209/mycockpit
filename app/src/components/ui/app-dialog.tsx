// <AppDialog> — camada de conveniência SOBRE o dialog base shadcn
// (components/ui/dialog), não uma reescrita. Existe pra parar de remontar cada
// dialog na mão (header + X + footer soltos), que foi o que gerou o X custom
// deslocado. Regras que ela garante de graça:
//   - X SEMPRE o PADRÃO (DialogCloseX via `showCloseButton` do DialogContent),
//     filho DIRETO do DialogContent, nunca um X custom nem X dentro de container
//     com scroll;
//   - um DialogTitle acessível SEMPRE existe (o Radix exige) — visível quando
//     vem `title`, senão um header sr-only com título fallback;
//   - largura numa escala fixa (`size`); o corpo (`children`) controla o próprio
//     padding/scroll/altura quando precisar (ex.: p-0 + altura fixa + scroll
//     interno), passando isso via `className` (twMerge deixa o consumidor vencer
//     o padding base do DialogContent).
//
// Novos dialogs usam AppDialog. A migração dos 15 existentes é INCREMENTAL —
// nada aqui os toca.

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/** Escala de largura fixa. `xl` = o do marketplace (Especialistas). As classes
 *  usam `sm:` de propósito: passadas via className ao DialogContent, o twMerge
 *  do `cn` resolve o conflito com o `sm:max-w-lg` embutido do base (último
 *  vence), então a largura escolhida sempre ganha. */
export const APP_DIALOG_SIZE = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-[920px]",
} as const

export type AppDialogSize = keyof typeof APP_DIALOG_SIZE

// Nome acessível quando o dialog não tem título visível (a11y do Radix).
const FALLBACK_TITLE = "Diálogo"

export interface AppDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Título visível. Ausente → header sr-only só pra dar nome acessível. */
  title?: React.ReactNode
  /** Subtítulo. Com `title` → visível; sem `title` → sr-only (ainda acessível). */
  description?: React.ReactNode
  /** Largura (default `md`). */
  size?: AppDialogSize
  /** Rodapé; se vier, entra num <DialogFooter>. */
  footer?: React.ReactNode
  /** Classes extras no DialogContent — o corpo controla padding/altura/scroll
   *  aqui (ex.: `p-0` + altura fixa + `overflow-hidden`). */
  className?: string
  children?: React.ReactNode
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  size = "md",
  footer,
  className,
  children,
}: AppDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* X: o DialogCloseX PADRÃO (showCloseButton default true), filho direto
          do DialogContent — nunca custom, nunca dentro de scroll. */}
      <DialogContent className={cn(APP_DIALOG_SIZE[size], className)}>
        {title ? (
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        ) : (
          <DialogHeader className="sr-only">
            <DialogTitle>{FALLBACK_TITLE}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
