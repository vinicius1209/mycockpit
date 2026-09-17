// A aba Bastidores do painel direito (ADR-200): o terminal quando há vistas
// abertas, a lista quando não há ou quando você voltou para ela.

import { IndiceDeBastidores } from "@/components/bastidores/IndiceDeBastidores"
import { TerminalDeBastidores } from "@/components/bastidores/TerminalDeBastidores"
import { useBastidores, vistasDa } from "@/store/bastidores"
import { useChat } from "@/store/chat"

export function BastidoresNoPainel() {
  const convId = useChat((s) => s.activeId)
  const abertas = useBastidores((s) => vistasDa(s.vistas, convId).length)
  const indiceVisivel = useBastidores((s) => s.indiceVisivel)
  return abertas > 0 && !indiceVisivel ? <TerminalDeBastidores /> : <IndiceDeBastidores />
}
