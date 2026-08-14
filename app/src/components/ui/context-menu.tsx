"use client"

import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import {
  ContextMenu as ContextMenuPrimitive,
  DropdownMenu as DropdownMenuPrimitive,
} from "radix-ui"

import { cn } from "@/lib/utils"

// ── A receita visual, uma vez só ────────────────────────────────────────────
// Este arquivo é a ÚNICA casa do menu de contexto do app (ADR-042): o menu
// ancorado num elemento (`ContextMenu*`, do Radix ContextMenu) e o menu
// ancorado no PONTO do cursor (`PointMenu*`, do Radix DropdownMenu, que é o
// que aceita `open` controlado) dividem as mesmas classes. Item, rótulo e
// divisor são literalmente a mesma constante; só a casca precisa de duas
// versões, porque o Radix injeta as variáveis de posicionamento com o nome da
// família (`--radix-context-menu-*` vs `--radix-dropdown-menu-*`) e o Tailwind
// só gera o utilitário se enxergar a string literal. Mexeu numa, mexa na outra.

const CASCA_CTX =
  "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[9rem] origin-(--radix-context-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

const CASCA_PONTO =
  "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[9rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

const ITEM =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-st-error data-[variant=destructive]:focus:bg-st-error/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground data-[variant=destructive]:*:[svg]:text-st-error"

const ROTULO =
  "px-2 py-1 text-[11px] tracking-wide text-muted-foreground uppercase data-[inset]:pl-8"

const DIVISOR_CLASSE = "-mx-1 my-1 h-px bg-border"

function ContextMenu({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  )
}

function ContextMenuGroup({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
}

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(CASCA_CTX, className)}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(ITEM, className)}
      {...props}
    />
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(ROTULO, className)}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn(DIVISOR_CLASSE, className)}
      {...props}
    />
  )
}

function ContextMenuSub({
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[inset]:pl-8 data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        "z-50 min-w-[8rem] origin-(--radix-context-menu-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-[var(--shadow-pop)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    />
  )
}

// ── Menu ancorado no PONTO do cursor ────────────────────────────────────────
// O `ContextMenu` do Radix ancora no elemento que serve de Trigger, e só abre
// pelo `contextmenu` DELE. O menu global do app (ADR-042) precisa abrir em
// qualquer lugar, inclusive dentro de portais (dialog, popover) que não são
// descendentes de trigger nenhum. Então a raiz aqui é o DropdownMenu, que
// aceita `open` controlado, e a âncora é um vão de 0×0 posicionado no cursor.
// A aparência é a mesma acima: as constantes são compartilhadas.

function PointMenu({
  x,
  y,
  open,
  onOpenChange,
  children,
}: {
  x: number
  y: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange} modal>
      <DropdownMenuPrimitive.Trigger asChild>
        {/* Âncora, não alvo: 0×0 e sem captar ponteiro, pra nunca comer um
            clique do usuário nem aparecer na navegação por teclado. */}
        <span
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed block h-0 w-0"
          style={{ left: x, top: y }}
        />
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          data-slot="point-menu-content"
          align="start"
          side="bottom"
          sideOffset={0}
          alignOffset={0}
          // O foco volta pro campo NA MÃO (o host guarda elemento e seleção
          // antes de abrir): devolver pra âncora tiraria o cursor de dentro do
          // campo que o usuário estava editando.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={CASCA_PONTO}
        >
          {children}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

function PointMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="point-menu-item"
      className={cn(ITEM, className)}
      {...props}
    />
  )
}

function PointMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="point-menu-separator"
      className={cn(DIVISOR_CLASSE, className)}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuGroup,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  PointMenu,
  PointMenuItem,
  PointMenuSeparator,
}
