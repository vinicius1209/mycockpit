// Quais projetos estão com o navegador flutuando sobre a conversa e onde a
// janela fica em cada um (navegador PRD R2). Posição e tamanho são lembrados
// por projeto; a geometria é encaixada no cartão na hora de desenhar.

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Geometria } from "@/lib/navegadorFlutuante"

interface NavegadorFlutuanteState {
  flutuando: Record<string, true>
  geometria: Record<string, Geometria>
  flutuar: (projectId: string) => void
  recolher: (projectId: string) => void
  guardarGeometria: (projectId: string, g: Geometria) => void
}

export const useNavegadorFlutuante = create<NavegadorFlutuanteState>()(
  persist(
    (set) => ({
      flutuando: {},
      geometria: {},
      flutuar: (projectId) =>
        set((s) => ({ flutuando: { ...s.flutuando, [projectId]: true } })),
      recolher: (projectId) =>
        set((s) => {
          const { [projectId]: _, ...resto } = s.flutuando
          return { flutuando: resto }
        }),
      guardarGeometria: (projectId, g) =>
        set((s) => ({ geometria: { ...s.geometria, [projectId]: g } })),
    }),
    {
      name: "mc.navegadorFlutuante",
      version: 1,
      // Só onde a janela fica: flutuar é gesto da sessão, não preferência que
      // reabre sozinha no próximo boot.
      partialize: (s) => ({ geometria: s.geometria }),
    },
  ),
)
