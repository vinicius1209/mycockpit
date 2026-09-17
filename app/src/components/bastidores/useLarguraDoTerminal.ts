// O painel direito alarga enquanto o terminal dos Bastidores está aberto e volta
// à largura que tinha quando ele fecha (ADR-200). Quem cede espaço é o painel,
// nunca a conversa por dentro: com as vistas no cartão central o composer
// quebrava em três linhas (build #389).

import { useEffect, useRef, type RefObject } from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"

/** Largura do painel com o terminal aberto, em % do grupo conteúdo + painel. */
export const LARGURA_DO_TERMINAL = 46
/** Teto de arrasto com o terminal aberto; sem ele, vale o teto normal. */
export const TETO_COM_TERMINAL = "58%"

export function useLarguraDoTerminal(painel: RefObject<PanelImperativeHandle | null>, aberto: boolean): void {
  const antes = useRef<number | null>(null)
  useEffect(() => {
    const p = painel.current
    if (!p) return
    if (aberto) {
      const atual = p.getSize().asPercentage
      antes.current = atual
      if (atual < LARGURA_DO_TERMINAL) p.resize(`${LARGURA_DO_TERMINAL}%`)
    } else if (antes.current != null) {
      p.resize(`${antes.current}%`)
      antes.current = null
    }
  }, [painel, aberto])
}
