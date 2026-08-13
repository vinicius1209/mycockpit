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
  deleteCard as dbDeleteCard,
  insertDelivery,
  isTauri,
  isTerminalCardState,
  linkCardConversation as dbLinkCardConversation,
  listCardCosts,
  listCards as dbListCards,
  setCardArchived as dbSetCardArchived,
  setCardAssignee as dbSetCardAssignee,
  setCardState as dbSetCardState,
  updateCard as dbUpdateCard,
  type CardRecord,
  type CardState,
} from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Card no STORE = registro do banco + sinais transitórios de sessão. O vigia
 *  (S2.2) marca `stalledSince` aqui, espelhando o `stalledSince` da conversa:
 *  NUNCA persiste no banco (episódio morre com o processo, como nos turnos). */
export type CardRow = CardRecord & {
  /** Início do silêncio (updated_at no momento do aviso). Transient. */
  stalledSince?: number
}

/** Cards com dispatch EM VOO (memória de módulo): guarda anti duplo-clique. */
const dispatching = new Set<string>()

/** Rascunho do composer a partir do card (dispatch leva a intenção junto):
 *  título na 1ª linha; body embaixo, separado por linha em branco. Formato
 *  natural de pedido, sem markup inventado. */
export function cardDraft(card: Pick<CardRecord, "title" | "body">): string {
  const body = card.body?.trim()
  return body ? `${card.title}\n\n${body}` : card.title
}

function groupByProject(all: CardRow[]): Record<string, CardRow[]> {
  const out: Record<string, CardRow[]> = {}
  for (const c of all) {
    ;(out[c.projectId] ??= []).push(c)
  }
  return out
}

interface CardsState {
  /** Cards ATIVOS (não-arquivados). É o que o board, o vigia, o companion e o
   *  BossCenter consomem — arquivar tira daqui, sem eles precisarem saber. */
  all: CardRow[]
  /** Cards ARQUIVADOS (fora do board, recuperáveis). Lista à parte pra seção
   *  "Arquivados" e pro Restaurar/Apagar; ninguém mais varre isto. */
  archived: CardRow[]
  /** Derivado de `all` (recalculado a cada mutação — refs novas juntas). */
  byProject: Record<string, CardRow[]>
  /** 1ª hidratação completa (skeleton → conteúdo; nunca volta a false). */
  loaded: boolean
  /** Card selecionado no board (S1.6: abrir card SEM conversa seleciona). */
  selectedId: string | null
  /** Hidrata do SQLite. Em falha MANTÉM o estado atual (não zera o board). */
  load: () => Promise<void>
  /** Cria um card no backlog do projeto. */
  create: (projectId: string, title: string, body?: string | null) => Promise<void>
  /** Arquiva o card (sai do board pra lista de arquivados, recuperável). */
  archive: (id: string) => Promise<void>
  /** Restaura um card arquivado de volta ao board (mesmo estado que tinha). */
  restore: (id: string) => Promise<void>
  /** Apaga o card DE VEZ (destrutivo). O caller confirma antes (dialog). */
  remove: (id: string) => Promise<void>
  /** Edita título/body (detalhe do card). Título vazio LANÇA (o caller mostra
   *  o toast); persiste e carimba o patch local com o MESMO relógio (F1). */
  update: (id: string, patch: { title?: string; body?: string }) => Promise<void>
  /** Move validando a máquina de estados. LANÇA em done/cancelled (terminais
   *  só via closeCard) e em transição inválida. */
  move: (id: string, state: CardState) => Promise<void>
  /** Fecha o card (done/cancelled) — o gate humano-only. */
  closeCard: (id: string, state: "done" | "cancelled") => Promise<void>
  /** Despacho por GESTO HUMANO (S1.4): cria uma conversa NOVA no projeto do
   *  card (nunca sequestra thread existente), liga o card a ela e vira
   *  working. Retorna o convId criado. Semântica de falha (review S4.6):
   *  LANÇA em card inexistente, fora do backlog ou projeto arquivado — null
   *  só nos casos benignos (dispatch já em voo; conversa não criada). */
  dispatch: (id: string) => Promise<string | null>
  select: (id: string | null) => void
  /** Carimbo do assignee (S1.4): chamado pelo chat quando um turno resolve o
   *  agent da conversa — espelha no card ligado (no-op sem card/mudança). */
  noteConversationAgent: (convId: string, agent: string) => void
  /** (vigia, S2.2) marca o card como estagnado. NÃO toca updated_at: o sinal
   *  de silêncio É o updated_at, e bumpar aqui fecharia o próprio episódio. */
  markCardStalled: (id: string, since: number) => void
  /** (vigia, S2.2) fecha o episódio (atividade/estado novo). No-op se limpo. */
  clearCardStalled: (id: string) => void
}

/** Arquivados primeiro os mais recentemente arquivados (lista de recuperação). */
function byArchivedDesc(a: CardRow, b: CardRow): number {
  return (b.archivedAt ?? 0) - (a.archivedAt ?? 0)
}

export const useCards = create<CardsState>((set, get) => {
  /** Substitui a lista de ATIVOS (mantém byProject coerente). Não toca em
   *  `archived` — as duas listas mudam por caminhos próprios. */
  const setAll = (all: CardRow[]) => set({ all, byProject: groupByProject(all) })

  /** Patch imutável de UM card (no-op se não existe). Toda mutação REAL passa
   *  por aqui: carimba updatedAt com o `now` da mutação (F1: o MESMO valor que
   *  foi pro banco — um relógio só, senão um reload chega com drift de ms e o
   *  vigia lê como atividade) e LIMPA o stalledSince transient (F3: mexeu no
   *  card = episódio de estagnação acabou; o badge não mente nem por 5s).
   *  Atua na lista ONDE o card vive (`all` OU `archived`) — sem isso, editar
   *  um arquivado (Salvar título/descrição) gravava no banco e divergia do
   *  store até o próximo load. */
  const patchCard = (
    id: string,
    patch: Partial<CardRow>,
    now: number = Date.now(),
  ) => {
    const bump = (c: CardRow): CardRow =>
      c.id === id ? { ...c, ...patch, stalledSince: undefined, updatedAt: now } : c
    if (get().all.some((c) => c.id === id)) {
      setAll(get().all.map(bump))
    } else if (get().archived.some((c) => c.id === id)) {
      set({ archived: get().archived.map(bump) })
    }
  }

  return {
    all: [],
    archived: [],
    byProject: {},
    loaded: false,
    selectedId: null,

    load: async () => {
      try {
        const rows = await dbListCards()
        // Particiona ativos × arquivados na hidratação: o board e os vigias só
        // veem `all`; arquivar/restaurar movem entre as listas depois.
        setAll(rows.filter((c) => c.archivedAt == null))
        set({
          archived: rows.filter((c) => c.archivedAt != null).sort(byArchivedDesc),
          loaded: true,
        })
      } catch (e) {
        // NÃO zera o board num erro transitório; loga e mantém o que há.
        console.warn("[cards] load falhou; mantendo o estado atual", e)
      }
    },

    create: async (projectId, title, body) => {
      const card = await dbCreateCard({ projectId, title, body: body ?? null })
      setAll([...get().all, card])
    },

    archive: async (id) => {
      const cur = get().all.find((c) => c.id === id)
      if (!cur) return
      const now = Date.now() // F1: banco e store carimbam o MESMO relógio
      await dbSetCardArchived(id, now, now)
      // sai de `all`, entra em `archived` (topo). Fecha episódio de estagnação.
      setAll(get().all.filter((c) => c.id !== id))
      set({
        archived: [
          { ...cur, archivedAt: now, updatedAt: now, stalledSince: undefined },
          ...get().archived,
        ],
      })
    },

    restore: async (id) => {
      const cur = get().archived.find((c) => c.id === id)
      if (!cur) return
      const now = Date.now()
      await dbSetCardArchived(id, null, now)
      set({ archived: get().archived.filter((c) => c.id !== id) })
      // volta pro board no MESMO estado; reinsere por ordem de criação.
      const restored = { ...cur, archivedAt: null, updatedAt: now }
      setAll(
        [...get().all, restored].sort((a, b) => a.createdAt - b.createdAt),
      )
    },

    remove: async (id) => {
      await dbDeleteCard(id)
      // some das DUAS listas (podia estar em qualquer uma).
      setAll(get().all.filter((c) => c.id !== id))
      set({ archived: get().archived.filter((c) => c.id !== id) })
      if (get().selectedId === id) set({ selectedId: null })
    },

    update: async (id, patch) => {
      const next: { title?: string; body?: string } = {}
      if (patch.title !== undefined) {
        const title = patch.title.trim()
        // título vazio não salva: a mensagem vaza pro toast do dialog.
        if (!title) throw new Error("O card precisa de um título")
        next.title = title
      }
      if (patch.body !== undefined) next.body = patch.body
      if (next.title === undefined && next.body === undefined) return
      const now = Date.now() // F1: banco e store carimbam o MESMO relógio
      await dbUpdateCard(id, next, now)
      patchCard(id, next, now)
    },

    move: async (id, state) => {
      if (isTerminalCardState(state)) {
        // mesma mensagem do gate no db.ts: pt-BR sem jargão, vaza pro toast.
        throw new Error(
          "Concluir ou cancelar um card é gesto humano: use a ação de fechar do card",
        )
      }
      // Fail-closed: card fora do board ativo (arquivado ou inexistente, ex.:
      // snapshot velho do celular) NÃO escreve no banco às cegas — sem esta
      // guarda, dbSetCardState revalidava só contra o banco e mutava um
      // arquivado, divergindo do store (achado da revisão).
      const cur = get().all.find((c) => c.id === id)
      if (!cur) throw new Error("Este card não está no board (restaure-o para agir)")
      assertCardTransition(cur.state, state) // valida ANTES do disco
      const now = Date.now() // F1: banco e store carimbam o MESMO relógio
      await dbSetCardState(id, state, now) // revalida contra o estado do banco
      patchCard(id, { state }, now)
    },

    closeCard: async (id, state) => {
      const cur = get().all.find((c) => c.id === id)
      // idem move: só o board ATIVO fecha um card (senão a entrega do "Concluir"
      // era descartada em silêncio, com cur undefined).
      if (!cur) throw new Error("Este card não está no board (restaure-o para agir)")
      assertCardTransition(cur.state, state)
      const now = Date.now()
      await dbCloseCard(id, state, now)
      patchCard(id, { state }, now)
      // ── S4.1: card fechado como done COM conversa ligada vira ENTREGA ──
      // O board é o 2º produtor de deliveries (o 1º é o Mission, mission.ts)
      // e alimenta o recall M1 de graça. Best-effort: nada aqui pode quebrar
      // o closeCard. Regras (decididas na story, documentadas aqui):
      //  - cancelled NÃO grava (intenção abortada não é entrega);
      //  - done SEM conversa NÃO grava: sem conversa não há evidência de
      //    execução dentro do app — gravar seria inventar par tarefa→resolução;
      //  - agent = assigneeAgent (carimbado quando o 1º turno resolveu o
      //    agent); se nunca resolveu, grava "" honesto — chutar "claude-code"
      //    envenenaria o ranking por agente do ledger;
      //  - filesTouched = [] no v1: conversa linear não tem diff de worktree
      //    rastreado (honesto, não inventa arquivos);
      //  - planSummary = 1ª linha não-vazia do body (o corpo pode ser longo);
      //  - custo = soma de turn_costs da conversa (mesma fonte do board);
      //    falha no custo degrada pra null, sem perder a entrega.
      if (state === "done" && cur?.conversationId) {
        try {
          let costUsd: number | null = null
          try {
            const costs = await listCardCosts([cur.conversationId])
            costUsd = costs[cur.conversationId]?.total ?? null
          } catch {
            costUsd = null // custo é sinal secundário; a entrega vale sozinha
          }
          const firstLine =
            (cur.body ?? "")
              .split("\n")
              .map((l) => l.trim())
              .find((l) => l.length > 0) ?? ""
          await insertDelivery({
            projectId: cur.projectId,
            task: cur.title,
            planSummary: firstLine,
            filesTouched: [],
            costUsd,
            agent: cur.assigneeAgent ?? "",
            model: null,
          })
        } catch (e) {
          console.warn(
            "[cards] entrega do card não gravada (o card segue fechado)",
            e,
          )
        }
      }
    },

    dispatch: async (id) => {
      // Guarda anti duplo-clique (D2): o check + add rodam SÍNCRONOS antes do
      // 1º await — a 2ª chamada em voo sai na hora, sem 2ª conversa órfã
      // (null aqui é benigno: o 1º clique já está fazendo o trabalho).
      if (dispatching.has(id)) return null
      const card = get().all.find((c) => c.id === id)
      // Card inexistente LANÇA (não null mudo): um caller com estado stale
      // (ex.: snapshot velho no celular) recebe motivo, não silêncio.
      if (!card) {
        throw new Error("Card não encontrado no board")
      }
      if (card.state !== "backlog") {
        throw new Error("Só um card no backlog pode ser iniciado")
      }
      // Guarda de projeto arquivado NO STORE (B1 do review S4.6): a F-E do
      // BoardLane (disabled) é só UX — a verdade mora aqui, e desktop, remoto
      // e qualquer caller futuro herdam de graça. Conversa nova em projeto
      // invisível é armadilha (o desktop se recusa a abri-la).
      if (!useApp.getState().projects.some((p) => p.id === card.projectId)) {
        throw new Error(
          "Projeto arquivado: restaure o projeto para iniciar este card",
        )
      }
      dispatching.add(id)
      try {
        // newConversation cria com agent: null, JÁ ABRE a conversa e RETORNA
        // o id (D2: nada de inferir via activeId, que outra navegação pode
        // trocar no meio) — o assignee é carimbado quando o 1º turno resolver
        // o agent (noteConversationAgent).
        const convId = await useChat.getState().newConversation(card.projectId)
        if (!convId) return null
        const now = Date.now() // F1: um relógio pra mutação inteira
        await dbLinkCardConversation(id, convId, now)
        await dbSetCardState(id, "working", now)
        patchCard(id, { conversationId: convId, state: "working" }, now)
        // O card É o pedido: a conversa nova nasce com título+body no COMPOSER
        // como RASCUNHO, nunca auto-send — despacho é gesto humano, o usuário
        // revisa/complementa e envia (auto-send dispararia um turno com
        // modelo/permissão default sem revisão). O rascunho mora no useChat
        // (drafts por conversa, memória de sessão): no caminho remoto
        // (dispatch_card via companion) ele espera no desktop enquanto o
        // processo viver; após restart se perde — drafts não são persistidos,
        // e tudo bem (o card segue inteiro no board).
        useChat.getState().setDraft(convId, cardDraft(card))
        return convId
      } finally {
        dispatching.delete(id)
      }
    },

    select: (id) => set({ selectedId: id }),

    noteConversationAgent: (convId, agent) => {
      // busca nas DUAS listas: um card arquivado com conversa em execução
      // também merece o carimbo do agent (patchCard atua na lista certa).
      const card =
        get().all.find((c) => c.conversationId === convId) ??
        get().archived.find((c) => c.conversationId === convId)
      // terminal fica fora: histórico fechado não é recarimbado.
      if (!card || isTerminalCardState(card.state) || card.assigneeAgent === agent)
        return
      const now = Date.now()
      patchCard(card.id, { assigneeAgent: agent }, now)
      dbSetCardAssignee(card.id, agent, now).catch((e) => {
        console.warn("[cards] falha ao gravar o assignee do card", e)
      })
    },

    markCardStalled: (id, since) => {
      const cur = get().all.find((c) => c.id === id)
      if (!cur || cur.stalledSince === since) return
      // patch direto (SEM patchCard): updated_at intocado, ver doc da action.
      setAll(get().all.map((c) => (c.id === id ? { ...c, stalledSince: since } : c)))
    },

    clearCardStalled: (id) => {
      const cur = get().all.find((c) => c.id === id)
      if (cur?.stalledSince == null) return
      setAll(
        get().all.map((c) => (c.id === id ? { ...c, stalledSince: undefined } : c)),
      )
    },
  }
})

/** Abre um card a partir da fila "Precisam de você" (S1.6): com conversa
 *  ligada, navega até ela (espelha openStalledConv do watchdog).
 *
 *  Devolve **false quando não havia pra onde ir** (card sem conversa ligada, ou
 *  card que sumiu do store): quem chamou decide o que fazer com isso. Antes,
 *  este caminho selecionava o card e trocava pro Painel — desde o ADR-040 o
 *  Board não mora mais lá, então isso virou clique morto: o usuário era
 *  arrancado do Trabalho pra uma tela onde o card não existe, e a fila
 *  continuava acesa cobrando a mesma decisão. Navegar pra onde o alvo não
 *  existe é pior do que não navegar. */
export async function openCardConversation(cardId: string): Promise<boolean> {
  const card = useCards.getState().all.find((c) => c.id === cardId)
  if (!card?.conversationId) return false
  const app = useApp.getState()
  app.setActiveProject(card.projectId)
  await useChat.getState().openProject(card.projectId)
  await useChat.getState().switchConversation(card.conversationId)
  app.setViewMode("linear")
  return true
}

// Hidratação no BOOT (padrão interactions.ts): o App.tsx importa este módulo
// como side-effect — cards ficam no store antes da 1ª visita ao Painel, e o
// vigia do Sprint 2 nunca varre um board vazio por acidente. Fora do Tauri é
// no-op barato (listCards devolve []).
if (isTauri()) {
  void useCards.getState().load()
}
