import { cn } from "@/lib/utils"

type FrotaMarkProps = {
  className?: string
  title?: string
}

/** Marca do horizonte artificial. Mantida em SVG para permanecer nítida no
 *  titlebar, na tray e nas futuras exportações de ícone da Frota. */
export function FrotaMark({ className, title }: FrotaMarkProps) {
  return (
    <svg
      className={cn("fill-none", className)}
      viewBox="0 0 44 44"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <circle cx="22" cy="22" r="20" />
      <path d="M6.5 24.5 18 22l4 1 4-1 11.5 2.5" />
      <path d="M22 16v10" />
      <path d="M13 29h18" />
    </svg>
  )
}
