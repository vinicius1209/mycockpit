// O encerramento da Frota visto por dentro (ADR-235): o que o Rust disse que
// está aberto e o estado de cada item, que só muda quando o registro dono dele
// confirma. A tela só desenha isto.

import { create } from "zustand"

export type EstadoDoItem = "encerrando" | "encerrado" | "forcado"

export interface ItemDoEncerramento {
  id: string
  tipo: "run" | "processo" | "plugin" | "ditado" | "analise" | "atualizacao" | "companion"
  rotulo: string
  runId?: string
  convId?: string
  estado: EstadoDoItem
}

interface EncerramentoState {
  /** `null` = a Frota não está encerrando. */
  itens: ItemDoEncerramento[] | null
  pronto: boolean
  comecar: (itens: Omit<ItemDoEncerramento, "estado">[]) => void
  marcar: (id: string, estado: Exclude<EstadoDoItem, "encerrando">) => void
  concluir: () => void
}

export const useEncerramento = create<EncerramentoState>((set) => ({
  itens: null,
  pronto: false,
  comecar: (itens) =>
    set({ itens: itens.map((item) => ({ ...item, estado: "encerrando" })), pronto: false }),
  marcar: (id, estado) =>
    set((s) => ({
      itens: s.itens?.map((item) => (item.id === id ? { ...item, estado } : item)) ?? null,
    })),
  concluir: () => set({ pronto: true }),
}))
