// E1 — Board de intenção: o CARD é a unidade durável de intenção, ligada à
// conversa que a executa. Store zustand (padrão fusion.ts), hidratado no BOOT
// via side-effect import no App.tsx (padrão interactions.ts) — o vigia do
// Sprint 2 varre este store, e vigia só enxerga store hidratado. Nada de
// TanStack Query: o Painel segue store + efeito.

import { create } from "zustand"
import {
  assertCardTransition,
  closeCard as dbCloseCard,
  createCard as dbCreateCard,
  isTauri,
  isTerminalCardState,
  linkCardConversation as dbLinkCardConversation,
  listCards as dbListCards,
  setCardAssignee as dbSetCardAssignee,
  setCardState as dbSetCardState,
  type CardRecord,
  type CardState,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Cards com dispatch EM VOO (memória de módulo): guarda anti duplo-clique. */
const dispatching = new Set<string>()

function groupByProject(all: CardRecord[]): Record<string, CardRecord[]> {
  const out: Record<string, CardRecord[]> = {}
  for (const c of all) {
    ;(out[c.projectId] ??= []).push(c)
  }
  return out
}

interface CardsState {
  all: CardRecord[]
  /** Derivado de `all` (recalculado a cada mutação — refs novas juntas). */
  byProject: Record<string, CardRecord[]>
  /** 1ª hidratação completa (skeleton → conteúdo; nunca volta a false). */
  loaded: boolean
  /** Card selecionado no board (S1.6: abrir card SEM conversa seleciona). */
  selectedId: string | null
  /** Hidrata do SQLite. Em falha MANTÉM o estado atual (não zera o board). */
  load: () => Promise<void>
  /** Cria um card no backlog do projeto. */
  create: (projectId: string, title: string, body?: string | null) => Promise<void>
  /** Move validando a máquina de estados. LANÇA em done/cancelled (terminais
   *  só via closeCard) e em transição inválida. */
  move: (id: string, state: CardState) => Promise<void>
  /** Fecha o card (done/cancelled) — o gate humano-only. */
  closeCard: (id: string, state: "done" | "cancelled") => Promise<void>
  /** Despacho por GESTO HUMANO (S1.4): cria uma conversa NOVA no projeto do
   *  card (nunca sequestra thread existente), liga o card a ela e vira
   *  working. Retorna o convId criado (null se nada foi criado). */
  dispatch: (id: string) => Promise<string | null>
  select: (id: string | null) => void
  /** Carimbo do assignee (S1.4): chamado pelo chat quando um turno resolve o
   *  agent da conversa — espelha no card ligado (no-op sem card/mudança). */
  noteConversationAgent: (convId: string, agent: string) => void
}

export const useCards = create<CardsState>((set, get) => {
  /** Substitui a lista inteira (mantém byProject coerente). */
  const setAll = (all: CardRecord[]) => set({ all, byProject: groupByProject(all) })

  /** Patch imutável de UM card (no-op se não existe). */
  const patchCard = (id: string, patch: Partial<CardRecord>) => {
    const next = get().all.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
    )
    setAll(next)
  }

  return {
    all: [],
    byProject: {},
    loaded: false,
    selectedId: null,

    load: async () => {
      try {
        const rows = await dbListCards()
        setAll(rows)
        set({ loaded: true })
      } catch (e) {
        // NÃO zera o board num erro transitório; loga e mantém o que há.
        console.warn("[cards] load falhou; mantendo o estado atual", e)
      }
    },

    create: async (projectId, title, body) => {
      const card = await dbCreateCard({ projectId, title, body: body ?? null })
      setAll([...get().all, card])
    },

    move: async (id, state) => {
      if (isTerminalCardState(state)) {
        // mesma mensagem do gate no db.ts: pt-BR sem jargão, vaza pro toast.
        throw new Error(
          "Concluir ou cancelar um card é gesto humano: use a ação de fechar do card",
        )
      }
      const cur = get().all.find((c) => c.id === id)
      if (cur) assertCardTransition(cur.state, state) // valida ANTES do disco
      await dbSetCardState(id, state) // revalida contra o estado do banco
      patchCard(id, { state })
    },

    closeCard: async (id, state) => {
      const cur = get().all.find((c) => c.id === id)
      if (cur) assertCardTransition(cur.state, state)
      await dbCloseCard(id, state)
      patchCard(id, { state })
    },

    dispatch: async (id) => {
      // Guarda anti duplo-clique (D2): o check + add rodam SÍNCRONOS antes do
      // 1º await — a 2ª chamada em voo sai na hora, sem 2ª conversa órfã.
      if (dispatching.has(id)) return null
      const card = get().all.find((c) => c.id === id)
      if (!card) return null
      if (card.state !== "backlog") {
        throw new Error("Só um card no backlog pode ser iniciado")
      }
      dispatching.add(id)
      try {
        // newConversation cria com agent: null, JÁ ABRE a conversa e RETORNA
        // o id (D2: nada de inferir via activeId, que outra navegação pode
        // trocar no meio) — o assignee é carimbado quando o 1º turno resolver
        // o agent (noteConversationAgent).
        const convId = await useChat.getState().newConversation(card.projectId)
        if (!convId) return null
        await dbLinkCardConversation(id, convId)
        await dbSetCardState(id, "working")
        patchCard(id, { conversationId: convId, state: "working" })
        return convId
      } finally {
        dispatching.delete(id)
      }
    },

    select: (id) => set({ selectedId: id }),

    noteConversationAgent: (convId, agent) => {
      const card = get().all.find((c) => c.conversationId === convId)
      // terminal fica fora: histórico fechado não é recarimbado.
      if (!card || isTerminalCardState(card.state) || card.assigneeAgent === agent)
        return
      patchCard(card.id, { assigneeAgent: agent })
      dbSetCardAssignee(card.id, agent).catch((e) => {
        console.warn("[cards] falha ao gravar o assignee do card", e)
      })
    },
  }
})

/** Abre um card a partir da fila "Precisam de você" (S1.6): com conversa
 *  ligada, navega até ela (espelha openStalledConv do watchdog); sem conversa,
 *  seleciona o card no board do Painel. */
export async function openCardConversation(cardId: string): Promise<void> {
  const card = useCards.getState().all.find((c) => c.id === cardId)
  if (!card) return
  const app = useApp.getState()
  if (card.conversationId) {
    app.setActiveProject(card.projectId)
    await useChat.getState().openProject(card.projectId)
    await useChat.getState().switchConversation(card.conversationId)
    app.setViewMode("linear")
  } else {
    useCards.getState().select(card.id)
    app.setViewMode("painel")
  }
}

// Hidratação no BOOT (padrão interactions.ts): o App.tsx importa este módulo
// como side-effect — cards ficam no store antes da 1ª visita ao Painel, e o
// vigia do Sprint 2 nunca varre um board vazio por acidente. Fora do Tauri é
// no-op barato (listCards devolve []).
if (isTauri()) {
  void useCards.getState().load()
}
