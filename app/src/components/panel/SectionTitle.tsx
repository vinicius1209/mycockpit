import type { ReactNode } from "react"

/** Título de seção do Painel — mesmo `etiqueta` das Sections do app. Mora
 *  num arquivo próprio porque a Retrospectiva deixou de ser um arquivo só: o
 *  mapa de calor saiu para `CostHeatmap.tsx` e os dois precisam do MESMO
 *  título (duplicar a marcação seria a primeira rachadura no etiqueta). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="etiqueta mb-2 px-1">{children}</h2>
}
