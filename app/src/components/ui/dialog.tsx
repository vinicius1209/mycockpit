"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      {/* CENTRALIZAÇÃO POR FLEX, não por translate(-50%,-50%). Duas razões,
          as duas MEDIDAS no navegador (e2e dialog-centralizado):

          1. TEXTO EMBAÇADO. Com `translate: -50% -50%`, metade de uma altura
             ÍMPAR vira offset FRACIONÁRIO (medido: altura 807,625 → -403,8125px),
             o elemento é rasterizado fora da grade de pixels e TODO o texto
             dentro dele sai borrado. Como a altura vem do conteúdo, o defeito
             ia e vinha conforme o formulário — parecia "bug de foco".
             (Em Tailwind v4 isso é a propriedade `translate`, não `transform`:
             `getComputedStyle().transform` diz "none" e esconde a pista.)

          2. DIALOG ALTO ERA CORTADO NOS DOIS LADOS, SEM SCROLL. Centrado por
             translate e sem `max-h`, um form de 807px numa janela de 720px
             ficava com `top: -43,8` e `bottom` além da tela: cabeçalho e botão
             de confirmar fora da vista, e `scrollHeight === clientHeight`, ou
             seja, nem rolando dava pra alcançar.

          O padrão abaixo (wrapper que rola + `min-h-full items-center`) resolve
          os dois: conteúdo baixo fica centrado; conteúdo alto empurra o wrapper
          e ROLA, em vez de ser cortado. O scroll fica no WRAPPER de propósito —
          `overflow` no próprio Content brigaria com o `overflow-hidden` que as
          Configurações declaram pra ter scroll interno próprio. */}
      <div
        data-slot="dialog-viewport"
        className="fixed inset-0 z-50 overflow-y-auto"
      >
        <div className="flex min-h-full items-center justify-center p-4">
          {/* `grid-cols-[minmax(0,1fr)]`: sem ele a coluna implícita do grid
              cresce até o min-content do filho, e texto `truncate` (caminho
              de pasta longo) tem min-content = o texto INTEIRO. Visto em
              22/09/2026 no "Adicionar projeto": o diálogo ficava com 448px e
              o formulário vazava pela direita. O `min-w-0` da linha flex não
              alcança essa conta; quem trava é a coluna. */}
          <DialogPrimitive.Content
            data-slot="dialog-content"
            className={cn(
              "relative grid w-full max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border bg-background p-6 shadow-[var(--shadow-pop)] duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
              className
            )}
            {...props}
          >
            {children}
            {showCloseButton && <DialogCloseX />}
          </DialogPrimitive.Content>
        </div>
      </div>
    </DialogPortal>
  )
}

/** PADRÃO ÚNICO do botão de fechar (X) — replicável e à prova de UI. Regras:
 *  - vive no canto SUP-DIREITO do DialogContent (não de containers internos:
 *    nada de X dentro de um `overflow-y-auto`, que era a fonte dos bugs);
 *  - z alto (fica ACIMA do conteúdo) + chip com hover → hit-area de 28px clara,
 *    visível sobre qualquer fundo;
 *  - qualquer conteúdo com ação no canto sup-direito reserva `pr-9` pra não
 *    passar por baixo do X.
 *  Dialogs com layout custom (p-0/scroll próprio) usam `showCloseButton={false}`
 *  e renderizam <DialogCloseX/> como filho DIRETO do DialogContent. */
function DialogCloseX({
  className,
  onClick,
}: {
  className?: string
  onClick?: () => void
}) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      onClick={onClick}
      aria-label="Fechar"
      className={cn(
        // CHIP de verdade (fundo + borda + blur): o X flutua sobre áreas de
        // scroll (regra do DialogCloseX) e sem fundo o conteúdo rolado colidia
        // visualmente com o glifo — era a "falha do X sobreposto" do modal de
        // Configurações. O blur mantém legível sobre qualquer card/texto.
        "absolute top-3 right-3 z-20 grid size-7 place-items-center rounded-md border border-border/50 bg-background/85 shadow-sm backdrop-blur-sm text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus:outline-none disabled:pointer-events-none [&_svg]:size-4",
        className,
      )}
    >
      <XIcon />
      <span className="sr-only">Fechar</span>
    </DialogPrimitive.Close>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogCloseX,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
