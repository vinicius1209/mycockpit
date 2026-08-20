// Dona ÚNICA da detecção de editores.
//
// Mesma doutrina de store/worktrees: um lugar lê a máquina, todas as
// superfícies leem a store. Detecção espalhada por efeito de componente daria
// N probes pro mesmo fato — e este roda `which` e stat de bundle.
//
// UMA vez por sessão, não por render nem por timer: editor instalado não
// aparece e some enquanto você trabalha. Quem instalar um no meio do caminho
// reabre o app, que é o gesto que a pessoa já faria de qualquer forma.

import { create } from "zustand"
import { detectEditors, type DetectedEditor } from "@/lib/editors"
import { isTauri } from "@/lib/db"

interface EditorsState {
  /** `null` = ainda não perguntou (≠ perguntou e não achou nada). */
  detected: DetectedEditor[] | null
  ensure: () => void
}

export const useEditors = create<EditorsState>((set, get) => ({
  detected: null,

  ensure: () => {
    if (get().detected != null) return
    if (!isTauri()) {
      set({ detected: [] }) // browser/dev: não há máquina pra perguntar
      return
    }
    // Marca ANTES do await: sem isto, duas superfícies montando no mesmo frame
    // disparam dois probes (o `!= null` acima ainda seria falso nas duas).
    set({ detected: [] })
    void detectEditors()
      .then((eds) => set({ detected: eds }))
      .catch(() => {}) // já ficou [], e a UI simplesmente não oferece o botão
  },
}))
