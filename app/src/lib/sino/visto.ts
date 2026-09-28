// Visto quando você vê (ADR-271): a conversa na tela, com a janela em foco,
// marca como vistos os avisos dela no sino. Vale por qualquer caminho que leve
// até ela (sidebar, bandeja, ⌘K, o próprio sino) e para o aviso que nasce
// enquanto você olha, que é o turno que você acabou de assistir.

import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { conversaVisivel } from "@/store/interactions/split"
import { useNotifs } from "@/store/notifications"

/** A conversa cujos avisos viram vistos agora, ou null. Pura. */
export function conversaAMarcar(
  visivel: string | null,
  focada: boolean,
  items: readonly { convId?: string; read: boolean }[],
): string | null {
  if (!visivel || !focada) return null
  return items.some((n) => n.convId === visivel && !n.read) ? visivel : null
}

/** Liga a marcação. Devolve quem desliga. */
export function iniciarVisto(): () => void {
  const marcar = () => {
    const convId = conversaAMarcar(
      conversaVisivel(),
      document.hasFocus(),
      useNotifs.getState().items,
    )
    if (convId) useNotifs.getState().markConvRead(convId)
  }
  // O chat avisa a cada token; só a troca de conversa na tela interessa.
  let naTela = conversaVisivel()
  const aoTrocarDeTela = () => {
    const agora = conversaVisivel()
    if (agora === naTela) return
    naTela = agora
    marcar()
  }
  const soltar = [
    useChat.subscribe(aoTrocarDeTela),
    useApp.subscribe(aoTrocarDeTela),
    useNotifs.subscribe(marcar),
  ]
  window.addEventListener("focus", marcar)
  marcar()
  return () => {
    for (const s of soltar) s()
    window.removeEventListener("focus", marcar)
  }
}
