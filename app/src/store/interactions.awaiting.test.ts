// Testes do ÍNDICE DE ESPERA no seam que a SIDEBAR realmente consome:
// `useAwaiting()` → { convIds, projectIds } (ela faz `.has()` na render de cada
// linha de conversa e de cada pasta de projeto).
//
// O `awaitingKey` (chave estável) já é testado em interactions.origin.test.ts;
// aqui o alvo é a DERIVAÇÃO em cima dela — os dois Sets e o cache de ref —, que
// é o que acende o ponto âmbar. Um teste só da chave não pegaria, por exemplo,
// um projectId vazio virando "projeto fantasma" aceso na sidebar.
//
// O buraco que isto guarda: o índice filtrava `approval`, então uma PERGUNTA do
// ask_user deixava o turno parado e a sidebar não acendia NADA — não havia como
// descobrir qual conversa estava esperando por você. O backend anexa `run_id` em
// todo pedido (approval.rs: o campo é `String`, não Option), então a pergunta tem
// dono tão resolvível quanto a permissão.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { answerInteraction, type InteractionRequest } from "@/lib/interaction"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import { useChat, type ConvState } from "@/store/chat"
import { useMission } from "@/store/mission"
import { useAwaiting, useInteractions } from "./interactions"

// `useAwaiting` é um `useSyncExternalStore(subscribe, snapshot)` — nada além de
// um par de funções puras. Não há DOM no ambiente de teste (vitest roda em node,
// sem jsdom), então trocamos o hook do React por "chama o snapshot": o que roda é
// a derivação REAL do módulo (Sets + cache), não uma reimplementação dela no
// teste. Sem isso, a única coisa testável seria a chave — e a chave não é o que a
// Sidebar consome. O `subscribe` (quais stores acordam o índice) fica de fora de
// propósito: é wiring sem lógica, e o que tinha bug era a régua do DONO.
vi.mock("react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react")>()
  return {
    ...mod,
    useSyncExternalStore: (_sub: unknown, snapshot: () => unknown) =>
      snapshot(),
  }
})

// Só o efeito (invoke Tauri) do `answer` é mocado; o resto de lib/interaction
// segue real.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})

// ── factories (mesmas dos vizinhos: cada suíte carrega as suas) ─────────────

function conversa(projectId: string, patch: Partial<ConvState> = {}): ConvState {
  return {
    projectId,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
    ...patch,
  }
}

function fase(persona: MissionPersona, agent: string): MissionPhaseDef {
  return {
    id: persona,
    label: persona,
    persona,
    agent,
    model: null,
    effort: null,
    maxRetries: 1,
  }
}

function faseRun(def: MissionPhaseDef): MissionPhaseRun {
  return { def, status: "queued", attempt: 1, costUsd: 0, startedAt: null }
}

function missao(convId: string, patch: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m1",
    convId,
    presetName: "Feature completa",
    dir: ".mycockpit/missions/test",
    task: "tarefa",
    phases: [
      faseRun(fase("planner", "claude-code")),
      faseRun(fase("executor", "codex")),
      faseRun(fase("reviewer", "claude-code")),
    ],
    current: 0,
    costTotal: 0,
    maxCostUsd: null,
    status: "running",
    startedAt: 0,
    ...patch,
  }
}

/** Aprovação no shape REAL do backend: `run_id` IRMÃO de `data`. */
function aprovacao(id: string, runId: string): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command: "ls", input: {} },
  }
}

/** Pergunta (ask_user) com `run_id` no topo, igual ao approval — é assim que o
 *  `handle_conn` serializa. `runId: null` = pedido órfão (nunca passar `undefined`
 *  explícito: em JS o argumento undefined ATIVA o default do parâmetro e o
 *  "órfão" chegaria com run preenchido, testando o caso errado). */
function pergunta(id: string, runId: string | null = "r-1"): InteractionRequest {
  return {
    id,
    run_id: runId ?? undefined,
    kind: "question",
    data: {
      questions: [
        {
          header: "Migração",
          question: "Como resolver as datas?",
          multiSelect: false,
          options: [{ label: "adapter", description: "" }],
        },
      ],
    },
  }
}

/** Duas conversas em projetos diferentes, cada uma com o seu run pausado. */
function cenarioBase() {
  useChat.setState({
    projectId: "p1",
    activeId: "c1",
    conversations: [],
    conversationsByProject: {},
    byId: {
      c1: conversa("p1", { runId: "r-1", running: true }),
      c2: conversa("p2", { runId: "r-2", running: true }),
    },
    queuedPrompt: null,
  })
  useMission.setState({ byConv: {} })
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  cenarioBase()
  vi.mocked(answerInteraction).mockClear()
})

describe("useAwaiting — o sinal âmbar da sidebar", () => {
  it("fila vazia ⇒ nada aceso", () => {
    const idx = useAwaiting()
    expect(idx.convIds.size).toBe(0)
    expect(idx.projectIds.size).toBe(0)
  })

  it("PERGUNTA pendente acende a conversa E o projeto dela", () => {
    useInteractions.setState({ queue: [pergunta("q1", "r-2")] })
    const idx = useAwaiting()
    expect([...idx.convIds]).toEqual(["c2"])
    expect([...idx.projectIds]).toEqual(["p2"])
  })

  it("pergunta de FASE de missão acende a conversa dona (run missionId::phase-N)", () => {
    // na missão o run_id não é o runId da conversa: ele vem prefixado pelo id da
    // missão, e o dono sai do byConv. Sem cobrir isso, o sinal funcionaria só no
    // turno linear — e a missão é justo o modo que roda por muito mais tempo.
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    useInteractions.setState({ queue: [pergunta("q1", "m1::phase-1")] })
    const idx = useAwaiting()
    expect([...idx.convIds]).toEqual(["c1"])
    expect([...idx.projectIds]).toEqual(["p1"])
  })

  it("pergunta ÓRFÃ (sem run_id) não acende nada — não se inventa dono", () => {
    useInteractions.setState({ queue: [pergunta("q1", null)] })
    const idx = useAwaiting()
    expect(idx.convIds.size).toBe(0)
    expect(idx.projectIds.size).toBe(0)
  })

  it("pergunta com run_id de run MORTO não acende nada (ter run_id não basta)", () => {
    // guarda contra "resolveu por perto": run desconhecido tem que ficar de fora,
    // senão o pedido acenderia uma conversa que não é a dele.
    useInteractions.setState({ queue: [pergunta("q1", "r-inexistente")] })
    expect(useAwaiting().convIds.size).toBe(0)
  })

  it("APROVAÇÃO continua acendendo — linear e missão (sem regressão)", () => {
    useInteractions.setState({ queue: [aprovacao("i1", "r-1")] })
    expect([...useAwaiting().convIds]).toEqual(["c1"])

    useMission.setState({ byConv: { c2: missao("c2") } })
    useInteractions.setState({ queue: [aprovacao("i2", "m1::phase-0")] })
    const idx = useAwaiting()
    expect([...idx.convIds]).toEqual(["c2"])
    expect([...idx.projectIds]).toEqual(["p2"])
  })

  it("pedidos de projetos diferentes acendem as duas conversas e os dois projetos", () => {
    // a chave carrega vários pares (`c1|p1,c2|p2`); este é o caso que prova que a
    // derivação parseia TODOS, não só o primeiro.
    useInteractions.setState({
      queue: [pergunta("q1", "r-1"), aprovacao("i1", "r-2")],
    })
    const idx = useAwaiting()
    expect([...idx.convIds].sort()).toEqual(["c1", "c2"])
    expect([...idx.projectIds].sort()).toEqual(["p1", "p2"])
  })

  it("conversa sem projeto carregado acende a conversa, e NENHUM projeto fantasma", () => {
    // projectId vazio (conversa recém-hidratada) não pode virar um Set com "" —
    // a pasta de projeto acenderia comparando `.has("")` por acidente.
    useChat.setState({ byId: { c1: conversa("", { runId: "r-1", running: true }) } })
    useInteractions.setState({ queue: [pergunta("q1", "r-1")] })
    const idx = useAwaiting()
    expect([...idx.convIds]).toEqual(["c1"])
    expect(idx.projectIds.size).toBe(0)
  })

  it("responder a pergunta APAGA o sinal na hora (o turno destravou)", () => {
    useInteractions.setState({ queue: [pergunta("q1", "r-1")] })
    expect(useAwaiting().convIds.has("c1")).toBe(true)
    useInteractions.getState().answer("q1", { answers: [] })
    expect(useAwaiting().convIds.size).toBe(0)
    expect(answerInteraction).toHaveBeenCalledWith("q1", { answers: [] })
  })

  it("ref ESTÁVEL enquanto a espera não muda, nova quando muda", () => {
    // a sidebar re-renderiza a árvore inteira se o índice trocar de identidade a
    // cada token do streaming — o cache por chave é o que evita isso.
    useInteractions.setState({ queue: [pergunta("q1", "r-1")] })
    const primeiro = useAwaiting()
    expect(useAwaiting()).toBe(primeiro)

    // outro pedido da MESMA conversa: a espera é a mesma ⇒ mesma ref.
    useInteractions.setState({
      queue: [pergunta("q1", "r-1"), aprovacao("i1", "r-1")],
    })
    expect(useAwaiting()).toBe(primeiro)

    // agora entra uma segunda conversa ⇒ índice novo.
    useInteractions.setState({
      queue: [pergunta("q1", "r-1"), aprovacao("i1", "r-2")],
    })
    expect(useAwaiting()).not.toBe(primeiro)
  })
})
