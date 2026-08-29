import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { GEOMETRIA_DE_CONTROLE as G } from "@/components/ui/controle"

const buttonVariants = cva(
  // Sem `gap`, `rounded` nem `text-` aqui: os três vêm do DEGRAU (§13). Deixá-los
  // na base criava conflito que só o twMerge resolvia, e classe que só sobrevive
  // por ordem de merge é classe que ninguém consegue ler.
  "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 disabled:saturate-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // Os quatro degraus do §13, e SÓ eles. Saíram `lg` (40px, "primária
      // porém maior", que não é papel) e os dois níveis de ícone que ninguém
      // usava. Quem precisar de um quinto degrau abre ADR, como quem precisa
      // de um tamanho de fonte novo (§3).
      size: {
        chip: `${G.chip.altura} ${G.chip.padding} ${G.chip.fonte} ${G.chip.gap} ${G.chip.raio} has-[>svg]:px-1.5 ${G.chip.icone_forcado}`,
        compacto: `${G.compacto.altura} ${G.compacto.padding} ${G.compacto.fonte} ${G.compacto.gap} ${G.compacto.raio} has-[>svg]:px-2 ${G.compacto.icone_forcado}`,
        padrao: `${G.padrao.altura} ${G.padrao.padding} ${G.padrao.fonte} ${G.padrao.gap} ${G.padrao.raio} has-[>svg]:px-2.5`,
        destaque: `${G.destaque.altura} ${G.destaque.padding} ${G.destaque.fonte} ${G.destaque.gap} ${G.destaque.raio} has-[>svg]:px-3`,
        "icone-chip": `${G.chip.quadrado} ${G.chip.raio} ${G.chip.icone_forcado}`,
        "icone-compacto": `${G.compacto.quadrado} ${G.compacto.raio} ${G.compacto.icone_forcado}`,
        "icone-padrao": `${G.padrao.quadrado} ${G.padrao.raio}`,
        "icone-destaque": `${G.destaque.quadrado} ${G.destaque.raio}`,
      },
    },
    defaultVariants: {
      variant: "default",
      size: "destaque",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "destaque",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
