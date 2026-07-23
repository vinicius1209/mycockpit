// Vigia de turno mudo (P2): dispara após o limiar, UMA vez por episódio,
// fecha com atividade/fim do turno, respeita 0=off e o cancelamento mata o
// run via cancelAgent. checkStalledTurns é determinística com `now` injetado.
// S2.2: checkStalledCards vigia cards review/blocked (esperando humano) pelo
// updated_at, com a mesma disciplina de episódio e o mesmo knob.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: vi.fn() }))
// notify importa o plugin nativo do Tauri — mock inteiro (só o spy interessa).
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
// cancelAgent invoca o Tauri — mocado p/ não vazar (padrão mission.*.test).
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { toast } from "sonner"
import { cancelAgent } from "@/lib/agent"
import { notifyCardStalled, notifyTurnStalled } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useCards, type CardRow } from "@/store/cards"
import { useChat, type ChatItem, type ConvState } from "@/store/chat"
import {
  _resetWatchdogState,
  cancelStalledTurn,
  checkStalledCards,
  checkStalledTurns,
  stalledTurnEpisodeOpen,
} from "./watchdog"

const T0 = 1_700_000_000_000
const MIN = 60_000

let n = 0
function textItem(text = "trabalhando…"): ChatItem {
  return { kind: "text", id: `t${n++}`, text }
}

function card(over: Partial<CardRow> = {}): CardRow {
  return {
    id: "k1",
    projectId: "p1",
    title: "Revisar o parser",
    body: null,
    state: "review",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: T0 - 60 * MIN,
    updatedAt: T0,
    archivedAt: null,
    ...over,
  }
}

/** Patch de teste direto no store (simula a mutação real, que sempre bumpa
 *  updated_at via patchCard). */
function patchStoreCard(id: string, over: Partial<CardRow>): void {
  useCards.setState({
    all: useCards.getState().all.map((c) => (c.id === id ? { ...c, ...over } : c)),
  })
}

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [textItem()],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: "r1",
    startedAt: T0,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetWatchdogState()
  useChat.setState({ byId: {} })
  useCards.setState({ all: [], byProject: {}, selectedId: null })
  useApp.getState().setSettings({ stalledAfterMin: 10 })
})

describe("checkStalledTurns", () => {
  it("dispara UMA vez após o limiar de silêncio (nativa + toast + flag)", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0) // baseline
    checkStalledTurns(T0 + 9 * MIN) // ainda dentro do limiar
    expect(notifyTurnStalled).not.toHaveBeenCalled()

    checkStalledTurns(T0 + 10 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(notifyTurnStalled).toHaveBeenCalledWith("c1", "claude-code", 10)
    expect(toast).toHaveBeenCalledTimes(1)
    // flag transient aponta pra ÚLTIMA atividade (início do silêncio)
    expect(useChat.getState().byId.c1.stalledSince).toBe(T0)

    // silêncio continuado NÃO re-notifica (1 por episódio)
    checkStalledTurns(T0 + 15 * MIN)
    checkStalledTurns(T0 + 60 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it("atividade fecha o episódio; mudo de novo por OUTRO período re-notifica", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 10 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)

    // o agent voltou a produzir (itens mudaram)
    const c = useChat.getState().byId.c1
    useChat.setState({
      byId: { c1: { ...c, items: [...c.items, textItem("voltei")] } },
    })
    checkStalledTurns(T0 + 12 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()

    // silêncio parcial (9min) não dispara…
    checkStalledTurns(T0 + 21 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    // …outro período COMPLETO de silêncio dispara de novo
    checkStalledTurns(T0 + 22 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(2)
  })

  it("fim do turno limpa o episódio sem notificar de novo", () => {
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 10 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBe(T0)

    const c = useChat.getState().byId.c1
    useChat.setState({ byId: { c1: { ...c, running: false, runId: null } } })
    checkStalledTurns(T0 + 11 * MIN)
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
  })

  it("setting 0 desliga o vigia (nem aviso, nem flag)", () => {
    useApp.getState().setSettings({ stalledAfterMin: 0 })
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 120 * MIN)
    expect(notifyTurnStalled).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(useChat.getState().byId.c1.stalledSince).toBeUndefined()
  })

  it("conversa que não está rodando nunca é vigiada", () => {
    useChat.setState({ byId: { c1: conv({ running: false, runId: null }) } })
    checkStalledTurns(T0)
    checkStalledTurns(T0 + 30 * MIN)
    expect(notifyTurnStalled).not.toHaveBeenCalled()
  })
})

describe("cancelStalledTurn", () => {
  it("cancela o run corrente (cancelAgent com o runId)", async () => {
    useChat.setState({ byId: { c1: conv({ runId: "r9" }) } })
    await cancelStalledTurn("c1")
    expect(cancelAgent).toHaveBeenCalledWith("r9")
  })

  it("sem runId não invoca cancelAgent (turno já morreu sozinho)", async () => {
    useChat.setState({ byId: { c1: conv({ runId: null, running: false }) } })
    await cancelStalledTurn("c1")
    expect(cancelAgent).not.toHaveBeenCalled()
  })
})

describe("checkStalledCards (S2.2)", () => {
  it("card em review parado além do limiar dispara UMA vez (nativa + toast + flag)", () => {
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 9 * MIN) // ainda dentro do limiar
    expect(notifyCardStalled).not.toHaveBeenCalled()

    checkStalledCards(T0 + 10 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
    expect(notifyCardStalled).toHaveBeenCalledWith("Revisar o parser", "review", 10)
    expect(toast).toHaveBeenCalledTimes(1)
    // flag transient aponta pro início do silêncio (updated_at do card)
    expect(useCards.getState().all[0].stalledSince).toBe(T0)

    // silêncio continuado NÃO re-notifica (1 por episódio)
    checkStalledCards(T0 + 15 * MIN)
    checkStalledCards(T0 + 60 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it("card blocked também é vigiado (a outra sala de espera do humano)", () => {
    useCards.setState({ all: [card({ state: "blocked" })] })
    checkStalledCards(T0 + 10 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledWith("Revisar o parser", "blocked", 10)
  })

  it("atividade (updated_at avança) fecha o episódio; re-estagnar re-notifica", () => {
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 10 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)

    // alguém mexeu no card (toda mutação real bumpa updated_at)
    patchStoreCard("k1", { updatedAt: T0 + 12 * MIN })
    checkStalledCards(T0 + 13 * MIN)
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)

    // silêncio parcial (9min) não dispara…
    checkStalledCards(T0 + 21 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
    // …outro período COMPLETO de silêncio dispara de novo
    checkStalledCards(T0 + 22 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(2)
    expect(useCards.getState().all[0].stalledSince).toBe(T0 + 12 * MIN)
  })

  it("mudança de estado fecha o episódio (working sai da sala de espera)", () => {
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 10 * MIN)
    expect(useCards.getState().all[0].stalledSince).toBe(T0)

    // review → working (retrabalho): sai da vigilância de cards
    patchStoreCard("k1", { state: "working", updatedAt: T0 + 11 * MIN })
    checkStalledCards(T0 + 12 * MIN)
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
    // e por mais mudo que fique, checkStalledCards não avisa working
    checkStalledCards(T0 + 120 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
  })

  it("reload do store com drift de ms NÃO re-notifica (F1) e o badge sobrevive", () => {
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 10 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)

    // reload do banco (ex.: load() após deleteConversation): objeto NOVO,
    // updated_at com uns ms de diferença (linha antiga, pré fix do relógio
    // único) e o stalledSince transient perdido no caminho.
    useCards.setState({ all: [card({ updatedAt: T0 + 3 })] })
    checkStalledCards(T0 + 11 * MIN)
    // o MESMO silêncio não vira episódio novo…
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledTimes(1)
    // …e a flag transient é re-afirmada (o badge acompanha o episódio aberto)
    expect(useCards.getState().all[0].stalledSince).toBe(T0)
  })

  it("conversa ligada RODANDO segura o vigia de cards (F2): conta do fim do turno", () => {
    useCards.setState({ all: [card({ conversationId: "c1" })] })
    useChat.setState({ byId: { c1: conv() } })

    // agent trabalhando: por mais parado que o updated_at esteja, sem aviso
    checkStalledCards(T0 + 30 * MIN)
    checkStalledCards(T0 + 60 * MIN)
    expect(notifyCardStalled).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()

    // o turno acabou: o silêncio conta DALI (última passada com running),
    // não do updated_at velho do card
    const c = useChat.getState().byId.c1
    useChat.setState({ byId: { c1: { ...c, running: false, runId: null } } })
    checkStalledCards(T0 + 69 * MIN) // 9min desde a última passada running
    expect(notifyCardStalled).not.toHaveBeenCalled()
    checkStalledCards(T0 + 70 * MIN) // 10min: agora sim
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
  })

  it("setting 0 desliga o vigia de cards (nem aviso, nem flag)", () => {
    useApp.getState().setSettings({ stalledAfterMin: 0 })
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 120 * MIN)
    expect(notifyCardStalled).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
  })

  it("religar o knob re-avisa card ainda parado (F4: 0 limpa a memória de episódio)", () => {
    useCards.setState({ all: [card()] })
    checkStalledCards(T0 + 10 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)

    // desligou: flag some, memória de episódio some (simetria com os turnos)
    useApp.getState().setSettings({ stalledAfterMin: 0 })
    checkStalledCards(T0 + 20 * MIN)
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)

    // religou: o card segue parado além do limiar ⇒ re-avisa (baseline nova)
    useApp.getState().setSettings({ stalledAfterMin: 10 })
    checkStalledCards(T0 + 30 * MIN)
    expect(notifyCardStalled).toHaveBeenCalledTimes(2)
  })

  it("card working NUNCA é avisado aqui (dedupe: turno mudo é do checkStalledTurns)", () => {
    useCards.setState({
      all: [card({ state: "working", conversationId: "c1" })],
    })
    // mesmo com a conversa ligada rodando muda, o aviso de card não existe
    useChat.setState({ byId: { c1: conv() } })
    checkStalledCards(T0 + 120 * MIN)
    expect(notifyCardStalled).not.toHaveBeenCalled()
    expect(useCards.getState().all[0].stalledSince).toBeUndefined()
  })

  it("backlog, done e cancelled nunca são avisados", () => {
    useCards.setState({
      all: [
        card({ id: "a", state: "backlog" }),
        card({ id: "b", state: "done" }),
        card({ id: "c", state: "cancelled" }),
      ],
    })
    checkStalledCards(T0 + 120 * MIN)
    expect(notifyCardStalled).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})

describe("dedupe turno mudo × card da MESMA conversa (F-D)", () => {
  it("turno mudo já avisado ⇒ o card em review ligado à conversa NÃO avisa no mesmo ciclo", () => {
    useCards.setState({ all: [card({ conversationId: "c1" })] })
    useChat.setState({ byId: { c1: conv() } })

    // mesma ordem do ticker real: turnos primeiro, cards depois, MESMO now
    const cycle = (now: number) => {
      checkStalledTurns(now)
      checkStalledCards(now)
    }
    cycle(T0) // baseline
    cycle(T0 + 10 * MIN)
    // o humano foi cutucado UMA vez, pelo turno mudo — não duas
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(notifyCardStalled).not.toHaveBeenCalled()
    expect(stalledTurnEpisodeOpen("c1")).toBe(true)

    // silêncio continuado: segue 1 aviso só
    cycle(T0 + 60 * MIN)
    expect(notifyTurnStalled).toHaveBeenCalledTimes(1)
    expect(notifyCardStalled).not.toHaveBeenCalled()

    // o turno terminou (episódio de turno fecha); o card continua parado à
    // espera do humano ⇒ o AVISO DE CARD sai depois de um limiar completo
    // contado do fim do turno — silêncio novo, cutucada nova, sem dobra.
    const c = useChat.getState().byId.c1
    useChat.setState({ byId: { c1: { ...c, running: false, runId: null } } })
    cycle(T0 + 65 * MIN)
    expect(stalledTurnEpisodeOpen("c1")).toBe(false)
    expect(notifyCardStalled).not.toHaveBeenCalled() // 5min: ainda não
    cycle(T0 + 70 * MIN) // 10min desde o fim do turno
    expect(notifyCardStalled).toHaveBeenCalledTimes(1)
  })

  it("stalledTurnEpisodeOpen: só é aberto com turno rodando, marcado E avisado", () => {
    expect(stalledTurnEpisodeOpen("nao-existe")).toBe(false)
    useChat.setState({ byId: { c1: conv() } })
    checkStalledTurns(T0) // baseline, sem aviso ainda
    expect(stalledTurnEpisodeOpen("c1")).toBe(false)
    checkStalledTurns(T0 + 10 * MIN) // avisou
    expect(stalledTurnEpisodeOpen("c1")).toBe(true)
    // atividade fecha o episódio
    const c = useChat.getState().byId.c1
    useChat.setState({
      byId: { c1: { ...c, items: [...c.items, textItem("voltei")] } },
    })
    checkStalledTurns(T0 + 11 * MIN)
    expect(stalledTurnEpisodeOpen("c1")).toBe(false)
  })
})
