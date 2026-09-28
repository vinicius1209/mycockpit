import { create } from "zustand"
import { wipeNoteAttachments } from "@/lib/attachments"
import { persist } from "zustand/middleware"
import {
  ALVO_QUALQUER,
  normalizarAlvo,
} from "@/components/notes/noteTargets"
import { comporNotasNoPrompt, type PromptComNotas } from "@/components/notes/noteMention"
import type { StickyNote, StickyNoteTarget } from "@/components/notes/types"

interface StickyNotesState {
  notes: StickyNote[]
  dockOpen: boolean
  /** Id do registry ou `ALVO_QUALQUER`. */
  activeFilter: StickyNoteTarget
  
  // Actions
  /** `abrir: false` cria sem abrir a gaveta (guardar do composer). */
  addNote: (draft?: Partial<StickyNote>, opcoes?: { abrir?: boolean }) => StickyNote
  updateNote: (id: string, patch: Partial<StickyNote>) => void
  deleteNote: (id: string) => void
  toggleDock: () => void
  setDockOpen: (open: boolean) => void
  setFilter: (filter: StickyNoteTarget) => void
  clearConversationNotes: (convId: string) => void
}

export const useStickyNotes = create<StickyNotesState>()(
  persist(
    (set) => ({
      notes: [],
      dockOpen: false,
      activeFilter: ALVO_QUALQUER,

      addNote: (draft = {}, opcoes = {}) => {
        const now = Date.now()
        const newNote: StickyNote = {
          // O id pode vir pronto: quem copia anexos para a nota precisa da
          // pasta dela ANTES de a nota existir.
          id: draft.id ?? crypto.randomUUID(),
          projectId: draft.projectId,
          convId: draft.convId,
          title: draft.title,
          content: draft.content ?? "",
          color: draft.color ?? "sand",
          targetAgent: draft.targetAgent ?? "all",
          ...(draft.attachments?.length ? { attachments: draft.attachments } : {}),
          ...(draft.origem ? { origem: draft.origem } : {}),
          collapsed: false,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({
          notes: [newNote, ...s.notes],
          // Abre a gaveta ao adicionar nova nota, salvo quem pede para não abrir.
          dockOpen: opcoes.abrir === false ? s.dockOpen : true,
        }))
        return newNote
      },

      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n,
          ),
        })),

      deleteNote: (id) => {
        // Blob morre com a nota, na hora — reclaim e privacidade imediatos,
        // sem depender do GC throttled do boot. Mesmo contrato do
        // `wipeAttachments` quando a conversa some.
        void wipeNoteAttachments(id).catch(() => {})
        set((s) => ({
          notes: s.notes.filter((n) => n.id !== id),
        }))
      },


      toggleDock: () => set((s) => ({ dockOpen: !s.dockOpen })),
      setDockOpen: (open) => set({ dockOpen: open }),
      setFilter: (activeFilter) => set({ activeFilter }),

      // Chamada por `store/chat/remove.ts` quando a conversa morre. A regra é
      // a mesma que rege a lista de lá: **nada pode continuar vivo e INVISÍVEL
      // depois que a conversa some**. Nota presa a um `convId` que não existe
      // mais não aparece em escopo nenhum e não tem como ser apagada pela UI —
      // ela só ocupa o `localStorage` pra sempre.
      clearConversationNotes: (convId) =>
        set((s) => {
          for (const n of s.notes) {
            if (n.convId === convId && n.attachments?.length) {
              void wipeNoteAttachments(n.id).catch(() => {})
            }
          }
          return { notes: s.notes.filter((n) => n.convId !== convId) }
        }),
    }),
    {
      name: "mycockpit:sticky_notes",
      // `dockOpen` NÃO vai pro disco, e a razão é de custo: sem `partialize` o
      // zustand serializa o estado INTEIRO a cada `set`, então abrir e fechar a
      // gaveta reescrevia o array de notas todo no localStorage — trabalho
      // síncrono na thread principal por um bool que nem faz falta entre
      // sessões (gaveta que reabre sozinha no boot é surpresa, não memória).
      partialize: (s) => ({ notes: s.notes, activeFilter: s.activeFilter }),
    },
  ),
)

/** O recorte de onde a nota MORA. Objeto e não posicional de propósito: são
 *  três dimensões, e `selectNotesFor(notes, undefined, "c1")` seria um convite
 *  a trocar projeto por conversa sem o tipo reclamar. */
export interface EscopoDeBusca {
  projectId?: string
  convId?: string
  /** Id do registry ou `ALVO_QUALQUER`. */
  filtro?: string
}

/**
 * As notas visíveis num escopo, fixadas no topo e o resto por data.
 *
 * **Projeto é filtro de verdade agora.** Antes só existia `convId`, e a nota
 * sem conversa era chamada de "Do projeto" enquanto aparecia em TODOS os
 * projetos — a tela afirmando um dono que ela não tinha. Nota sem `projectId`
 * continua aparecendo em todo lugar (é o que as antigas são, e é um escopo
 * legítimo), só que agora ela se chama pelo nome: "De todos os projetos".
 *
 * O alvo passa por `normalizarAlvo`: o valor gravado pode ser apelido antigo
 * (`claude`) ou de um agent que não existe mais.
 */
export function selectNotesFor(
  notes: readonly StickyNote[],
  escopo: EscopoDeBusca = {},
): StickyNote[] {
  const { projectId, convId, filtro = ALVO_QUALQUER } = escopo
  return notes
    .filter((n) => {
      const doProjeto = !n.projectId || n.projectId === projectId
      const daConversa = !n.convId || n.convId === convId
      const doAlvo = filtro === ALVO_QUALQUER || normalizarAlvo(n.targetAgent) === filtro
      return doProjeto && daConversa && doAlvo
    })
    // Só recência. O PIN saiu (ADR-117): numa gaveta pequena ele não comprava
    // nada — com ≤2 notas não tinha efeito nenhum, e com lista só criava uma
    // terceira seção pra ordenar o que a data já ordena.
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Resolve os endereços `@nota/…` do prompt (frente N5).
 *
 * Mora AQUI, e não em `lib/fleet/send.ts`, por camada: nenhum arquivo de `lib/`
 * importa de `components/` neste repo, e o núcleo da menção vive lá com o resto
 * das notas. A store já é a ponte natural (ela também importa de
 * `components/notes`), e o envio importa store desde sempre.
 *
 * Não existe estado de "já entregue": diferente da nota do fio — que se acumula
 * sozinha e por isso precisa de carimbo pra não voltar todo turno — esta só vai
 * quando você a endereça. Mencionar duas vezes é uma decisão, não um bug.
 */
export function withNotasDoBloco(
  texto: string,
  escopo: EscopoDeBusca,
): PromptComNotas {
  // Sem "@" no texto não há o que resolver: o caso comum (envio normal) sai
  // daqui sem tocar na lista de notas.
  if (!texto.includes("@nota/")) return { prompt: texto, ids: [], anexos: [] }
  const visiveis = selectNotesFor(useStickyNotes.getState().notes, escopo)
  return comporNotasNoPrompt(texto, visiveis)
}
