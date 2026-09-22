// Mais de um arquivo com o nome citado no fio: a pessoa escolhe ali mesmo,
// num menu no ponto do clique (`EscolhaDeArquivo`). Antes era um aviso que
// listava os caminhos sem deixar abrir nenhum e mandava ir ao explorador.
import { create } from "zustand"

export interface PedidoDeEscolha {
  x: number
  y: number
  nome: string
  /** Relativos ao projeto; os que a conversa usou vêm primeiro. */
  candidatos: string[]
}

interface EscolhaDeArquivoState {
  pedido: PedidoDeEscolha | null
  oferecer: (pedido: PedidoDeEscolha) => void
  fechar: () => void
}

export const useEscolhaDeArquivo = create<EscolhaDeArquivoState>((set) => ({
  pedido: null,
  oferecer: (pedido) => set({ pedido }),
  fechar: () => set({ pedido: null }),
}))
