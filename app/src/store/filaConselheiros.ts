// QUEM AINDA VAI SER OUVIDO nesta conversa (Especialistas E1).
//
// Store à parte, e não um campo da conversa, por duas razões. A primeira é
// natureza: isto vive entre o envio e o último parecer, não pertence ao
// transcript e não pode ser persistido junto com ele por acidente. A segunda é
// a catraca: `store/chat.ts` está no teto, e um campo novo lá exigiria dividir
// o arquivo por causa de um estado que nem é dele.
//
// As regras (quem está na fila, o que a bolha diz, quem vem depois) são puras e
// moram em `lib/filaDeConselheiros.ts`. Aqui é só a caixa.

import { create } from "zustand"
import { semEsse, type ConselheiroNaFila } from "@/lib/filaDeConselheiros"

interface FilaState {
  porConversa: Record<string, ConselheiroNaFila[]>
  /** No envio: todos os chamados, na ordem do texto. */
  definir: (convId: string, fila: ConselheiroNaFila[]) => void
  /** Quem começou (ou falhou) sai da espera. */
  tirar: (convId: string, personaId: string) => void
  limpar: (convId: string) => void
}

export const useFilaDeConselheiros = create<FilaState>((set) => ({
  porConversa: {},
  definir: (convId, fila) =>
    set((s) => ({ porConversa: { ...s.porConversa, [convId]: fila } })),
  tirar: (convId, personaId) =>
    set((s) => ({
      porConversa: {
        ...s.porConversa,
        [convId]: semEsse(s.porConversa[convId], personaId),
      },
    })),
  limpar: (convId) =>
    set((s) => {
      const { [convId]: _fora, ...resto } = s.porConversa
      return { porConversa: resto }
    }),
}))
