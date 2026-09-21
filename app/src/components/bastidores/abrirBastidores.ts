// As portas de entrada dos Bastidores (ADR-200): a linha "N em segundo plano"
// do fio e o bloco de saída em disco de um trabalho diferido.

import { toast } from "sonner"
import { registrarEscolhaDeAba } from "@/components/layout/useContextPanelTab"
import { bastidoresDaConversa } from "@/lib/bastidores"
import { useApp } from "@/store/app"
import { chaveDaSaida, useBastidores } from "@/store/bastidores"
import { useChat } from "@/store/chat"

function prepararTela() {
  // Lista e terminal moram na aba Bastidores do painel direito; o centro fica
  // como está. Abrir é gesto seu: a aba passa pela régua de escolha humana, o
  // app não a troca depois.
  const app = useApp.getState()
  if (!app.contextOpen) app.toggleContext()
  registrarEscolhaDeAba()
  app.setContextPanelTab("bastidores")
}

/** Abre o item pedido ou, sem pedido, o trabalho vivo mais recente. */
export function abrirBastidores(convId?: string | null, itemId?: string): void {
  const id = convId ?? useChat.getState().activeId
  if (!id) return
  let alvo = itemId
  if (!alvo) {
    const items = useChat.getState().byId[id]?.items ?? []
    const prefixo = chaveDaSaida(id, "")
    const comStream = new Set(
      Object.keys(useBastidores.getState().saidas)
        .filter((k) => k.startsWith(prefixo))
        .map((k) => k.slice(prefixo.length)),
    )
    const lista = bastidoresDaConversa(items, comStream)
    alvo = (lista.find((b) => b.estado === "vivo") ?? lista[0])?.itemId
  }
  if (!alvo) {
    toast("Nada em segundo plano nesta conversa.")
    return
  }
  prepararTela()
  useBastidores.getState().abrir(id, alvo)
}

/** Abre o trabalho diferido dono deste arquivo de saída, na conversa ativa. */
export function abrirBastidorDoArquivo(caminho: string): void {
  const convId = useChat.getState().activeId
  if (!convId) return
  const item = useChat
    .getState()
    .byId[convId]?.items.find((it) => it.kind === "tool" && it.deferred?.outputFile === caminho)
  abrirBastidores(convId, item?.id)
}
