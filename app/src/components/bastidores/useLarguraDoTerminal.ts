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

/** Quadros que o efeito espera o painel entrar no layout do grupo. */
const QUADROS_DE_ESPERA = 8

/** O tamanho do painel, ou null enquanto o GRUPO ainda não o registrou. O ref
 *  aponta para o painel no mesmo commit em que ele monta, mas o layout do
 *  grupo só o conhece depois, e até lá a biblioteca LANÇA ("Layout not found
 *  for Panel context"). Visto em 21/09/2026: abrir o painel direito com o
 *  terminal dos Bastidores já aberto lançava dentro deste efeito e, sem
 *  fronteira de erro, a janela inteira ficava preta. */
function tamanhoDe(p: PanelImperativeHandle): number | null {
  try {
    return p.getSize().asPercentage
  } catch {
    return null
  }
}

export function useLarguraDoTerminal(painel: RefObject<PanelImperativeHandle | null>, aberto: boolean): void {
  const antes = useRef<number | null>(null)
  useEffect(() => {
    let quadro = 0
    let tentativas = 0
    // Efeito com pré-condição faltando não age (fail-closed): espera o painel
    // existir no layout por alguns quadros e, se não vier, desiste sem mexer.
    const aplicar = () => {
      const p = painel.current
      if (!p) return
      const atual = tamanhoDe(p)
      if (atual == null) {
        if (++tentativas <= QUADROS_DE_ESPERA) quadro = requestAnimationFrame(aplicar)
        return
      }
      if (aberto) {
        antes.current = atual
        if (atual < LARGURA_DO_TERMINAL) p.resize(`${LARGURA_DO_TERMINAL}%`)
      } else if (antes.current != null) {
        p.resize(`${antes.current}%`)
        antes.current = null
      }
    }
    aplicar()
    return () => cancelAnimationFrame(quadro)
  }, [painel, aberto])
}
