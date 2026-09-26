// Os turnos que têm o computador liberado agora (ADR-225, ADR-261), para o
// "Revogar" estar sempre à mão. Antes o único lugar dele era um toast sem
// prazo; agora é uma faixa na conversa dona (e no canto, se você está noutra).
//
// Quem alimenta é o `desktop_state` do backend: `granted` true ao liberar,
// false ao revogar ou quando o turno termina. Efêmero: turno vivo não
// sobrevive ao app, e a liberação também não.

import { create } from "zustand"

interface LiberacoesState {
  /** runId → conversa dona. */
  porRun: Record<string, string>
  liberar: (runId: string, convId: string) => void
  encerrar: (runId: string) => void
}

export const useLiberacoes = create<LiberacoesState>((set) => ({
  porRun: {},
  liberar: (runId, convId) => set((s) => ({ porRun: { ...s.porRun, [runId]: convId } })),
  encerrar: (runId) =>
    set((s) => {
      if (!(runId in s.porRun)) return s
      const { [runId]: _, ...resto } = s.porRun
      return { porRun: resto }
    }),
}))
