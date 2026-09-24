// Cartão que aparece ao passar o mouse (ADR-240): a prévia do anexo no
// composer e na fila. Primitiva própria, na porta única de `components/ui`,
// com a MESMA superfície e o mesmo movimento do popover (E2): duas superfícies
// flutuantes não ganham dois idiomas.

import * as React from "react"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { SUPERFICIE_DO_PAINEL } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

const MOVIMENTO =
  "origin-(--radix-hover-card-content-transform-origin) data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"

function HoverCard({
  openDelay = 250,
  closeDelay = 80,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" openDelay={openDelay} closeDelay={closeDelay} {...props} />
}

function HoverCardTrigger(props: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  className,
  sideOffset = 8,
  collisionPadding = 8,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(SUPERFICIE_DO_PAINEL, MOVIMENTO, className)}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
