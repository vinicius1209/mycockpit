"use client"

import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("group/scroll relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&>div]:!block"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      // Sutil por padrão, presente quando você precisa. A barra some do
      // caminho (fica em 0 de opacidade) e acende no hover da área ou enquanto
      // a rolagem acontece — o `data-state=visible` do Radix é quem sabe disso.
      // Antes ela era um filete permanente de 10px com `bg-border` cheio: peso
      // de cromo numa lista que a pessoa lê, não opera.
      className={cn(
        "flex touch-none p-0.5 opacity-0 transition-opacity duration-200 select-none",
        "hover:opacity-100 data-[state=visible]:opacity-100",
        "group-hover/scroll:opacity-60",
        orientation === "vertical" && "h-full w-2",
        orientation === "horizontal" && "h-2 flex-col",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-foreground/20 transition-colors hover:bg-foreground/35"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  )
}

export { ScrollArea, ScrollBar }
