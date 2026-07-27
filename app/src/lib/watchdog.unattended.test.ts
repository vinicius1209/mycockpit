// Vigia do pedido SEM RESPOSTA em run desassistido: automação que pede
// permissão às 18:30 (você fora) congelava pra sempre — o backend bloqueia
// esperando resposta sem timeout (src-tauri/approval.rs). Aqui se prova o
// desfecho: fail-closed com motivo honesto, pedido fora da fila, aviso no fio
// e no sino, sem re-cobrança, e SEM tocar em turno normal.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: vi.fn() }))
// notify puxa o plugin nativo do Tauri — mock inteiro. Inclui os avisos que o
// store/interactions importa (a fábrica substitui o módulo pra todo mundo).
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
// cancelAgent invoca o Tauri (padrão do watchdog.test.ts).
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})
// answerInteraction é o invoke que destrava o turno no backend: espionado.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})

import {
  answerInteraction,
  type ApprovalAnswer,
  type InteractionRequest,
  type QuestionAnswer,
} from "@/lib/interaction"
import { notifyUnattendedTimeout } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useNotifs } from "@/store/notifications"
import {
  _resetUnattendedRuns,
  markUnattendedRun,
  clearUnattendedRun,
} from "./unattendedRuns"
import {
  _resetWatchdogState,
  checkUnattendedInteractions,
  startTurnWatchdog,
} from "./watchdog"

const T0 = 1_700_000_000_000
const MIN = 60_000
/** TICK_MS do watchdog (não é exportado): o intervalo do ticker que É o timer. */
const TICK = 30_000
const RUN = "run-auto"
const CONV = "c-auto"

function conv(over: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: true,
    finalizing: false,
    runId: RUN,
    startedAt: T0,
    suggestions: [],
    suggesting: false,
    ...over,
  }
}

function aprovacao(id = "req-1", runId = RUN): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command: "rm -rf build", input: {} },
  }
}

function pergunta(id = "req-q", runId = RUN): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "question",
    data: {
      questions: [
        {
          header: "Deploy",
          question: "Subir agora?",
          multiSelect: false,
          options: [{ label: "sim", description: "" }],
        },
      ],
    },
  }
}

function itensDaConversa() {
  return useChat.getState().byId[CONV]?.items ?? []
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetWatchdogState()
  _resetUnattendedRuns()
  useApp.setState({
    projects: [{ id: "p1", name: "alpha", path: "/proj/alpha", createdAt: 1 }],
  })
  // os DOIS knobs a cada teste: o describe do ticker zera o de turno mudo pra
  // isolar a passada, e sem este baseline aquele 0 vazaria pros testes seguintes.
  useApp.getState().setSettings({
    unattendedAnswerAfterMin: 10,
    stalledAfterMin: 10,
  })
  useChat.setState({
    byId: { [CONV]: conv() },
    conversations: [],
    conversationsByProject: {
      p1: [
        {
          id: CONV,
          title: "⏰ varredura noturna",
          updatedAt: T0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
  })
  useInteractions.setState({ queue: [] })
  useNotifs.setState({ items: [] })
  markUnattendedRun(RUN, CONV)
})

describe("checkUnattendedInteractions", () => {
  it("permissão sem resposta além do limiar: nega fail-closed, com motivo honesto", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0) // 1ª vista: carimba o prazo
    checkUnattendedInteractions(T0 + 9 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()

    checkUnattendedInteractions(T0 + 10 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    const [id, resposta] = vi.mocked(answerInteraction).mock.calls[0]
    expect(id).toBe("req-1")
    const aprov = resposta as ApprovalAnswer
    expect(aprov.allow).toBe(false)
    // o modelo NÃO pode ouvir "dispensado pelo usuário": não havia usuário.
    expect(aprov.message).toContain("desassistida")
    expect(aprov.message).toContain("10 min")
    // saiu da fila (nenhum card fica pendurado sobre um turno já destravado)
    expect(useInteractions.getState().queue).toHaveLength(0)
  })

  it("deixa o desfecho VISÍVEL: notice no fio + item no sino", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)

    const ultimo = itensDaConversa().at(-1)
    expect(ultimo?.kind).toBe("notice")
    expect(ultimo?.kind === "notice" && ultimo.message).toContain(
      "negada automaticamente",
    )
    expect(notifyUnattendedTimeout).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyUnattendedTimeout).mock.calls[0][0]).toMatchObject({
      kind: "approval",
      convId: CONV,
      projectId: "p1",
      projectName: "alpha",
      convTitle: "⏰ varredura noturna",
      minutes: 10,
    })
  })

  it("não re-cobra o mesmo pedido depois de responder", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)
    checkUnattendedInteractions(T0 + 40 * MIN)
    checkUnattendedInteractions(T0 + 90 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    expect(notifyUnattendedTimeout).toHaveBeenCalledTimes(1)
  })

  it("pergunta (`ask_user`) volta sem respostas e explica no fio", () => {
    useInteractions.setState({ queue: [pergunta()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)

    const [, resposta] = vi.mocked(answerInteraction).mock.calls[0]
    expect((resposta as QuestionAnswer).answers).toEqual([])
    const ultimo = itensDaConversa().at(-1)
    expect(ultimo?.kind === "notice" && ultimo.message).toContain(
      "sem resposta",
    )
    expect(vi.mocked(notifyUnattendedTimeout).mock.calls[0][0]).toMatchObject({
      kind: "question",
    })
  })

  it("turno NORMAL (você digitando) nunca expira, nem depois de horas", () => {
    _resetUnattendedRuns() // nenhum run marcado: é conversa sua
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
    expect(useInteractions.getState().queue).toHaveLength(1)
  })

  it("run que termina antes do prazo não expira depois (clear = cancelar o timer)", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    clearUnattendedRun(RUN) // finally do dispatchSchedule
    checkUnattendedInteractions(T0 + 600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
  })

  it("limiar 0 desliga (o turno volta a esperar para sempre)", () => {
    useApp.getState().setSettings({ unattendedAnswerAfterMin: 0 })
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
  })

  it("pedido respondido por VOCÊ some da memória e não deixa marca órfã", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0) // carimba
    useInteractions.setState({ queue: [] }) // você respondeu no card
    checkUnattendedInteractions(T0 + 1 * MIN)
    // MESMO id reaparecendo (re-emit do backend) recomeça o prazo do zero
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0 + 2 * MIN)
    checkUnattendedInteractions(T0 + 11 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
    checkUnattendedInteractions(T0 + 12 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
  })

  it("prazo conta por PEDIDO: uma rajada não morre toda de uma vez", () => {
    useInteractions.setState({ queue: [aprovacao("req-a")] })
    checkUnattendedInteractions(T0)
    useInteractions.setState({
      queue: [aprovacao("req-a"), aprovacao("req-b")],
    })
    checkUnattendedInteractions(T0 + 5 * MIN) // req-b carimbado aqui

    checkUnattendedInteractions(T0 + 10 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(answerInteraction).mock.calls[0][0]).toBe("req-a")

    checkUnattendedInteractions(T0 + 15 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(2)
    expect(vi.mocked(answerInteraction).mock.calls[1][0]).toBe("req-b")
  })

  it("respondido por VOCÊ antes do limiar: o prazo não cobra nada depois", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0) // 1ª vista: prazo carimbado
    // você chegou a tempo e aprovou no card (caminho REAL do store: tira da
    // fila e manda a resposta) — o vigia não pode passar por cima disso.
    useInteractions.getState().answer("req-1", { allow: true })
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(answerInteraction).mock.calls[0][1]).toEqual({ allow: true })

    checkUnattendedInteractions(T0 + 10 * MIN)
    checkUnattendedInteractions(T0 + 600 * MIN)
    // sem RESPOSTA DUPLA: um deny automático em cima do seu "sim" mandaria pro
    // backend uma decisão contrária à que você tomou.
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    // e sem aviso de desfecho que nunca houve (nem no fio, nem no sino).
    expect(notifyUnattendedTimeout).not.toHaveBeenCalled()
    expect(itensDaConversa()).toHaveLength(0)
  })

  it("permissão E pergunta no mesmo run: os dois kinds param o turno, os dois expiram", () => {
    useInteractions.setState({ queue: [aprovacao("req-p"), pergunta("req-q")] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)

    expect(answerInteraction).toHaveBeenCalledTimes(2)
    const [idP, respP] = vi.mocked(answerInteraction).mock.calls[0]
    const [idQ, respQ] = vi.mocked(answerInteraction).mock.calls[1]
    expect(idP).toBe("req-p")
    expect((respP as ApprovalAnswer).allow).toBe(false)
    expect(idQ).toBe("req-q")
    expect((respQ as QuestionAnswer).answers).toEqual([])
    expect(useInteractions.getState().queue).toHaveLength(0)
    // um desfecho por pedido nas DUAS superfícies (o fio guarda, o sino alcança)
    expect(itensDaConversa().filter((i) => i.kind === "notice")).toHaveLength(2)
    expect(notifyUnattendedTimeout).toHaveBeenCalledTimes(2)
  })

  it("o motivo do deny não mente: não é o texto do dispensar manual", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)

    const msg =
      (vi.mocked(answerInteraction).mock.calls[0][1] as ApprovalAnswer).message ??
      ""
    // o default do failClosedAnswer descreve o DISMISS manual; reusá-lo aqui
    // contaria pro modelo uma história falsa num momento sem ninguém na tela.
    expect(msg).not.toContain("dispensado pelo usuário")
    expect(msg).toContain("automação")
  })

  it("envio que falha não vira descarte silencioso: o aviso sai do mesmo jeito", async () => {
    // run já morto do outro lado (o Drop do backend resolve por lá): o invoke
    // rejeita. O que NÃO pode acontecer é a automação terminar sem rastro.
    vi.mocked(answerInteraction).mockRejectedValueOnce(new Error("run morto"))
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)
    await Promise.resolve() // deixa o catch best-effort do store rodar

    expect(itensDaConversa().at(-1)?.kind).toBe("notice")
    expect(notifyUnattendedTimeout).toHaveBeenCalledTimes(1)
    expect(useInteractions.getState().queue).toHaveLength(0)
  })

  it("knob religado cobra quem já esperou demais (não zera o relógio)", () => {
    useApp.getState().setSettings({ unattendedAnswerAfterMin: 0 })
    useInteractions.setState({ queue: [aprovacao()] })
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()

    // ligar o prazo com um turno JÁ pendurado há 10h resolve na passada
    // seguinte — mesma régua do vigia de cards (religar re-avalia o presente,
    // não recomeça a espera de quem já está travado).
    useApp.getState().setSettings({ unattendedAnswerAfterMin: 10 })
    checkUnattendedInteractions(T0 + 601 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
  })
})

// O TIMER de verdade. Nas provas acima o `now` é injetado (a decisão é pura);
// aqui quem tem que cobrar sozinho é o ticker do próprio vigia — com timers
// FALSOS do vitest (que também congelam o Date.now() lido lá dentro), nunca
// espera real. É onde se prova que não há vazamento: parar o vigia não deixa
// nem timer pendurado nem cobrança futura.
describe("startTurnWatchdog (o ticker É o timer, não há setTimeout por pedido)", () => {
  let parar: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    // isola a passada que interessa: o vigia de TURNO MUDO tem teste próprio e
    // aqui só somaria aviso no meio da medição (os dois knobs são independentes).
    useApp.getState().setSettings({ stalledAfterMin: 0 })
  })

  afterEach(() => {
    parar?.()
    parar = null
    vi.useRealTimers()
  })

  it("cobra o prazo sozinho, sem ninguém injetar `now`", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    parar = startTurnWatchdog() // baseline imediato: carimba a 1ª vista em T0

    vi.advanceTimersByTime(9 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    expect(useInteractions.getState().queue).toHaveLength(0)
  })

  it("parar o vigia não deixa timer pendurado nem cobrança futura", () => {
    const antes = vi.getTimerCount()
    useInteractions.setState({ queue: [aprovacao()] })
    const stop = startTurnWatchdog()
    // mexer na fila agenda o coalesce: são DOIS timers vivos (tick + coalesce).
    useInteractions.setState({ queue: [aprovacao(), aprovacao("req-2")] })
    expect(vi.getTimerCount()).toBeGreaterThan(antes)

    stop()
    expect(vi.getTimerCount()).toBe(antes)
    vi.advanceTimersByTime(600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
  })

  it("run que termina antes do prazo não é cobrado pelo ticker", () => {
    useInteractions.setState({ queue: [aprovacao()] })
    parar = startTurnWatchdog()
    vi.advanceTimersByTime(2 * MIN)
    clearUnattendedRun(RUN) // o `finally` do dispatchSchedule

    vi.advanceTimersByTime(600 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()
  })

  it("pedido que chega DEPOIS do start conta da 1ª vista, não do start do vigia", () => {
    parar = startTurnWatchdog() // fila vazia no baseline
    vi.advanceTimersByTime(1 * MIN)
    useInteractions.setState({ queue: [aprovacao()] })
    // o subscribe coalescido (5s) carimba a chegada bem antes do tick (30s)
    vi.advanceTimersByTime(TICK)

    // 10 min contados do START do vigia não bastam: o relógio DESTE pedido só
    // começou quando ele apareceu na fila.
    vi.advanceTimersByTime(9 * MIN - TICK)
    expect(answerInteraction).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
  })
})

// ── turno parado esperando VOCÊ não é turno mudo ────────────────────────────
// Sem esta guarda, uma automação bloqueada em aprovação dispara TRÊS avisos
// quase juntos: o "turno mudo" do vigia de silêncio (mesmo default de 10 min)
// mais o notice e o item do sino do timeout desassistido. O silêncio aqui tem
// causa conhecida, já avisada na chegada do pedido, e com card na tela.
describe("esperandoVoce — separa 'bloqueado' de 'mudo'", () => {
  it("conversa COM pedido pendente é 'esperando você'", async () => {
    const { esperandoVoce } = await import("./watchdog")
    const { useInteractions } = await import("@/store/interactions")
    useInteractions.setState({
      queue: [
        {
          id: "a1",
          run_id: RUN,
          kind: "approval",
          data: { tool_name: "Bash", command: "ls", input: {} },
        },
      ],
    })
    expect(esperandoVoce(CONV)).toBe(true)
  })

  it("sem pedido na fila, não é (o vigia de silêncio segue valendo)", async () => {
    const { esperandoVoce } = await import("./watchdog")
    const { useInteractions } = await import("@/store/interactions")
    useInteractions.setState({ queue: [] })
    expect(esperandoVoce(CONV)).toBe(false)
  })

  it("pedido de OUTRA conversa não silencia o vigia desta", async () => {
    const { esperandoVoce } = await import("./watchdog")
    const { useInteractions } = await import("@/store/interactions")
    useInteractions.setState({
      queue: [
        {
          id: "a1",
          run_id: "run-de-outra",
          kind: "approval",
          data: { tool_name: "Bash", command: "ls", input: {} },
        },
      ],
    })
    expect(esperandoVoce(CONV)).toBe(false)
  })
})
