// A PORTA DOS ESPECIALISTAS, aberta de qualquer lugar.
//
// O marketplace já tem lista e detalhe; o que faltava era poder chegar ao
// detalhe de UMA persona a partir de onde o nome dela aparece (o `@Aline` no
// fio). Store minúscula porque a alternativa era passar `open`/`onOpenChange`
// do `ChatPanel` até dentro da bolha, e a bolha não é dona dessa decisão.
//
// Uma superfície só para o mesmo gesto: nada de painel novo de detalhe.

import { create } from "zustand"

interface EspecialistasState {
  aberto: boolean
  /** Persona a mostrar ao abrir. `null` = a lista, como o atalho do composer. */
  id: string | null
  abrir: (id?: string) => void
  fechar: () => void
}

export const useEspecialistas = create<EspecialistasState>((set) => ({
  aberto: false,
  id: null,
  abrir: (id) => set({ aberto: true, id: id ?? null }),
  fechar: () => set({ aberto: false, id: null }),
}))
