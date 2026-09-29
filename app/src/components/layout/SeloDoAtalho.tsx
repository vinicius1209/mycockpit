// O número do ⌘1–9 no lugar do ícone da aba, enquanto o modificador está
// seguro. Mesma caixa de 14px do ícone: o nome da aba não anda.

import type { ReactNode } from "react"
import { useSeloDasAbas } from "@/components/layout/seloDasAbas"

export function IconeOuSelo({ n, children }: { n: number | null; children: ReactNode }) {
  const visivel = useSeloDasAbas()
  if (!visivel || n == null) return <>{children}</>
  return (
    <span
      aria-hidden
      className="grid size-3.5 shrink-0 place-items-center rounded-[3px] bg-foreground font-mono text-[11px] leading-none text-background"
    >
      {n}
    </span>
  )
}
