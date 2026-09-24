// Os comentários soltos no diff, ainda não mandados ao composer (ADR-251).
//
// Eram estado local do `DiffPanel`: trocar de aba desmontava o painel e o que
// a pessoa tinha escrito sumia. Com uma aba de diff por arquivo (ADR-248),
// trocar de aba virou o gesto comum, e perder comentário, o desfecho comum.
//
// A chave é conversa + pasta de trabalho: duas conversas no mesmo projeto não
// misturam revisão, e a conversa que muda de worktree não manda ao agente
// "arquivo.ts:42" de outro repositório. Dentro dela, um slot por linha do diff
// (comentar de novo a mesma linha edita). Não persiste: é rascunho da sessão,
// e morre com a conversa (`store/chat/remove.ts`).

import { create } from "zustand"
import type { DiffComment } from "@/lib/deliveryDiff"

type Comentarios = Record<string, DiffComment>

const NENHUM: Comentarios = {}

interface ComentariosDoDiffState {
  porChave: Record<string, Comentarios>
  guardar: (chave: string, comentario: DiffComment) => void
  tirar: (chave: string, id: string) => void
  limpar: (chave: string) => void
  esquecerConversa: (convId: string) => void
}

export function chaveDosComentarios(convId: string | null, cwd: string): string {
  return `${convId ?? ""}\0${cwd}`
}

export function comentariosDa(s: Pick<ComentariosDoDiffState, "porChave">, chave: string): Comentarios {
  return s.porChave[chave] ?? NENHUM
}

export const useComentariosDoDiff = create<ComentariosDoDiffState>((set, get) => ({
  porChave: {},
  guardar: (chave, comentario) =>
    set((s) => ({
      porChave: { ...s.porChave, [chave]: { ...comentariosDa(s, chave), [comentario.id]: comentario } },
    })),
  tirar: (chave, id) => {
    const atuais = comentariosDa(get(), chave)
    if (!(id in atuais)) return
    const { [id]: _, ...resto } = atuais
    set((s) => ({ porChave: { ...s.porChave, [chave]: resto } }))
  },
  limpar: (chave) => {
    if (!(chave in get().porChave)) return
    const { [chave]: _, ...resto } = get().porChave
    set({ porChave: resto })
  },
  esquecerConversa: (convId) => {
    const prefixo = `${convId}\0`
    const chaves = Object.keys(get().porChave).filter((k) => k.startsWith(prefixo))
    if (chaves.length === 0) return
    const porChave = { ...get().porChave }
    for (const k of chaves) delete porChave[k]
    set({ porChave })
  },
}))
