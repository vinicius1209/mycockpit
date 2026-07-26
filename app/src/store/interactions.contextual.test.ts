// Testes das interações CONTEXTUAIS (store/interactions):
// - convIdForInteraction: mapeamento request→conversa (extraído do bridge/
//   derive — turno linear por runId, missão por prefixo `missionId::phase-N`).
//   Ele segue devolvendo null p/ question, mas agora por um motivo estreito: é o
//   recorte APPROVAL-ONLY das superfícies que só falam de permissão (a mão da
//   mesa no office, o item de aprovação do companion). NÃO é mais a régua do
//   roteamento contextual;
// - computeContextualSplit: split por visibilidade, e desde a auditoria da
//   pergunta ele usa a régua SEM filtro de kind (o backend anexa run_id em todo
//   pedido — approval.rs), então PERGUNTA da conversa visível renderiza inline
//   em vez de cair no toast global;
// - responder inline remove da fila (o global nunca pisca o mesmo request).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { answerInteraction, type InteractionRequest } from "@/lib/interaction"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useMission } from "@/store/mission"
import {
  computeContextualSplit,
  convIdForInteraction,
  useInteractions,
} from "./interactions"

// Só o efeito (invoke Tauri) é mocado; failClosedAnswer & cia seguem reais.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})

// ── factories locais (espelham as do derive.test) ───────────────────────────

function conversa(
  projectId: string,
  patch: Partial<ConvState> = {},
): ConvState {
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

/** Aprovação no shape REAL do backend: `run_id` IRMÃO de `data` (approval.rs
 *  serializa assim; o `data` que ele monta tem só tool_name/command/input).
 *  O fixture antigo punha o run_id DENTRO de `data` e por isso a suíte passava
 *  enquanto, em produção, nenhum pedido era roteado pra conversa dona. */
function aprovacao(id: string, runId: string): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command: "ls", input: {} },
  }
}

/** Aprovação no shape LEGADO (`approval://request`): run_id dentro de `data`. */
function aprovacaoLegada(id: string, runId: string): InteractionRequest {
  return {
    id,
    kind: "approval",
    data: { run_id: runId, tool_name: "Bash", command: "ls", input: {} },
  }
}

/** Pergunta (ask_user) no shape REAL do backend: `run_id` no topo, igual ao
 *  approval — o `handle_conn` anexa o run em TODO pedido. `runId: null` = pedido
 *  órfão (não usar `undefined`: o argumento undefined ATIVA o default). */
function pergunta(id: string, runId: string | null = "r-1"): InteractionRequest {
  return {
    id,
    run_id: runId ?? undefined,
    kind: "question",
    data: {
      questions: [
        { header: "H", question: "Q?", multiSelect: false, options: [{ label: "a", description: "" }] },
      ],
    },
  }
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  useChat.setState({
    projectId: null,
    activeId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
    drafts: {},
    queuedPrompt: null,
  })
  useMission.setState({ byConv: {} })
  useApp.setState({ viewMode: "linear", scheduledOpen: false })
  vi.mocked(answerInteraction).mockClear()
})

// ── mapeamento request→conversa ─────────────────────────────────────────────

describe("convIdForInteraction", () => {
  it("turno linear: run_id igual ao runId corrente da conversa", () => {
    const chat = { byId: { c1: { runId: "r-1" }, c2: { runId: null } } }
    expect(
      convIdForInteraction(aprovacao("i1", "r-1"), chat, { byConv: {} }),
    ).toEqual({ convId: "c1", kind: "linear" })
  })

  it("missão: prefixo missionId:: com sufixo phase-N resolve a fase", () => {
    const missions = {
      byConv: { c1: { id: "m1", current: 0, phases: [{}, {}, {}] } },
    }
    expect(
      convIdForInteraction(aprovacao("i1", "m1::phase-1"), { byId: {} }, missions),
    ).toEqual({ convId: "c1", kind: "mission", phase: 1 })
  })

  it("missão: sufixo em outro formato cai na fase corrente", () => {
    const missions = {
      byConv: { c1: { id: "m1", current: 2, phases: [{}, {}, {}] } },
    }
    expect(
      convIdForInteraction(aprovacao("i1", "m1::retry-x"), { byId: {} }, missions),
    ).toEqual({ convId: "c1", kind: "mission", phase: 2 })
  })

  it("aceita o run_id no TOPO (shape do backend) e dentro de data (legado)", () => {
    const chat = { byId: { c1: { runId: "r-1" } } }
    // regressão: o backend manda o run_id irmão de `data`. Ler só `data.run_id`
    // devolvia null p/ TODO pedido real ⇒ nada renderizava inline e a mão do
    // escritório nunca subia.
    expect(
      convIdForInteraction(aprovacao("i1", "r-1"), chat, { byConv: {} }),
    ).toEqual({ convId: "c1", kind: "linear" })
    expect(
      convIdForInteraction(aprovacaoLegada("i2", "r-1"), chat, { byConv: {} }),
    ).toEqual({ convId: "c1", kind: "linear" })
  })

  it("topo vence o legado quando os dois vêm (não empata em null)", () => {
    const chat = { byId: { c1: { runId: "r-topo" }, c2: { runId: "r-data" } } }
    const req: InteractionRequest = {
      id: "i1",
      run_id: "r-topo",
      kind: "approval",
      data: { run_id: "r-data", tool_name: "Bash", command: "ls", input: {} },
    }
    expect(convIdForInteraction(req, chat, { byConv: {} })).toEqual({
      convId: "c1",
      kind: "linear",
    })
  })

  it("question ⇒ null AQUI, mesmo com run_id da conversa (recorte approval-only)", () => {
    // Este helper é o que a mesa do office e o item de aprovação do companion
    // consomem: os dois só sabem falar de permissão ("Aguardando aprovação",
    // comando + tool). A pergunta TEM dono resolvível pelo run_id, e quem precisa
    // dele (split inline + índice de espera da sidebar) usa a régua sem filtro de
    // kind — provado nos testes de computeContextualSplit logo abaixo.
    const chat = { byId: { c1: { runId: "r-1" } } }
    expect(convIdForInteraction(pergunta("q1"), chat, { byConv: {} })).toBeNull()
  })

  it("approval sem run_id / run_id desconhecido → null", () => {
    const semRunId: InteractionRequest = {
      id: "i1",
      kind: "approval",
      data: { tool_name: "Bash", command: "ls", input: {} },
    }
    const chat = { byId: { c1: { runId: "r-1" } } }
    expect(convIdForInteraction(semRunId, chat, { byConv: {} })).toBeNull()
    expect(
      convIdForInteraction(aprovacao("i2", "r-999"), chat, { byConv: {} }),
    ).toBeNull()
  })
})

// ── split por visibilidade ──────────────────────────────────────────────────

describe("computeContextualSplit", () => {
  it("conversa dona VISÍVEL (linear + ativa) ⇒ inline; toast global suprime", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([req])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })

  it("conversa dona NÃO-ativa ⇒ global (outra conversa na tela)", () => {
    useChat.setState({
      activeId: "c2",
      byId: {
        c1: conversa("p1", { runId: "r-1", running: true }),
        c2: conversa("p1"),
      },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([req])
  })

  it("viewMode office ⇒ tudo global (o office tem os próprios beacons)", () => {
    useApp.setState({ viewMode: "office" })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([req])
  })

  it("view Agendado aberta (scheduledOpen) ⇒ global mesmo no linear", () => {
    useApp.setState({ scheduledOpen: true })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([req])
  })

  it("PERGUNTA da conversa visível ⇒ inline junto com a permissão (o buraco que isto fecha)", () => {
    // Antes o split filtrava approval: uma pergunta da conversa aberta na sua
    // frente era jogada no toast global do canto, longe do fluxo onde ela se
    // decide. O backend manda run_id na question também, então ela tem dono.
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const q = pergunta("q1")
    const ap = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [q, ap] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([q, ap])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })

  it("pergunta de OUTRA conversa segue no toast global", () => {
    useChat.setState({
      activeId: "c1",
      byId: {
        c1: conversa("p1", { runId: "r-1", running: true }),
        c2: conversa("p1", { runId: "r-2", running: true }),
      },
    })
    const q = pergunta("q1", "r-2")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([q])
  })

  it("pergunta de conversa de OUTRO projeto ⇒ global (não invade a que está aberta)", () => {
    // o pedido nasceu num turno em background, de um projeto que você não está
    // olhando: renderizar inline aqui plantaria a pergunta de outro projeto no
    // fluxo desta conversa. Quem te leva até lá é o toast global + sidebar.
    useChat.setState({
      projectId: "p1",
      activeId: "c1",
      byId: {
        c1: conversa("p1", { runId: "r-1", running: true }),
        c9: conversa("p2", { runId: "r-9", running: true }),
      },
    })
    const q = pergunta("q1", "r-9")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([q])
  })

  it("pergunta no viewMode office ⇒ global (o office tem os próprios beacons)", () => {
    // o split por visibilidade não pode ter sido perdido junto com o filtro de
    // kind: fora do linear NENHUMA conversa está na tela, nem pra pergunta.
    useApp.setState({ viewMode: "office" })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const q = pergunta("q1")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([q])
  })

  it("pergunta com a view Agendado aberta ⇒ global mesmo no linear", () => {
    // a conversa é a ativa, mas está COBERTA pela view global — o card inline
    // renderizaria atrás dela, invisível, e o turno ficaria parado sem sinal.
    useApp.setState({ scheduledOpen: true })
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const q = pergunta("q1")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([q])
  })

  it("pergunta de fase de missão de conversa NÃO visível ⇒ global", () => {
    useChat.setState({
      activeId: "c2",
      byId: { c1: conversa("p1"), c2: conversa("p1") },
    })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    const q = pergunta("q1", "m1::phase-1")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([q])
  })

  it("pergunta sem run_id (órfã) ⇒ global: não se inventa dono", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const q = pergunta("q1", null)
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.global).toEqual([q])
  })

  it("pergunta com run_id de run MORTO ⇒ global (ter run_id não basta)", () => {
    // órfão pela outra ponta: o campo veio preenchido, mas nenhuma conversa/missão
    // é dona dele (run já encerrado). Cair no inline aqui seria roubar o card pra
    // conversa que por acaso está aberta.
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const q = pergunta("q1", "r-fantasma")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([])
    expect(split.inlineConvId).toBeNull()
    expect(split.global).toEqual([q])
  })

  it("fila mista (2 kinds, 3 conversas): cada pedido cai em UM lado só", () => {
    // invariante do split: inline ∪ global = fila, e nada aparece nos dois (o
    // usuário veria o MESMO pedido no fluxo e no canto da tela).
    useChat.setState({
      projectId: "p1",
      activeId: "c1",
      byId: {
        c1: conversa("p1", { runId: "r-1", running: true }),
        c2: conversa("p1", { runId: "r-2", running: true }),
        c9: conversa("p2", { runId: "r-9", running: true }),
      },
    })
    const daVisivel = [aprovacao("i1", "r-1"), pergunta("q1", "r-1")]
    const dosOutros = [
      pergunta("q2", "r-2"),
      aprovacao("i2", "r-9"),
      pergunta("q3", null),
    ]
    useInteractions.setState({ queue: [...daVisivel, ...dosOutros] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual(daVisivel)
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual(dosOutros)
    expect(split.inline.length + split.global.length).toBe(5)
    const inlineIds = new Set(split.inline.map((r) => r.id))
    expect(split.global.some((r) => inlineIds.has(r.id))).toBe(false)
  })

  it("pergunta de FASE de missão (missionId::phase-N) da conversa visível ⇒ inline", () => {
    useChat.setState({ activeId: "c1", byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    const q = pergunta("q1", "m1::phase-1")
    useInteractions.setState({ queue: [q] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([q])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })

  it("fase de missão (run_id missionId::phase-N) da conversa visível ⇒ inline", () => {
    useChat.setState({ activeId: "c1", byId: { c1: conversa("p1") } })
    useMission.setState({ byConv: { c1: missao("c1", { current: 1 }) } })
    const req = aprovacao("i1", "m1::phase-1")
    useInteractions.setState({ queue: [req] })
    const split = computeContextualSplit()
    expect(split.inline).toEqual([req])
    expect(split.inlineConvId).toBe("c1")
    expect(split.global).toEqual([])
  })
})

// ── responder inline remove da fila ─────────────────────────────────────────

describe("answer inline", () => {
  it("responder pelo card inline remove da fila NA HORA — o global nunca pisca", () => {
    useChat.setState({
      activeId: "c1",
      byId: { c1: conversa("p1", { runId: "r-1", running: true }) },
    })
    const req = aprovacao("i1", "r-1")
    useInteractions.setState({ queue: [req] })
    expect(computeContextualSplit().inline).toEqual([req])

    useInteractions.getState().answer("i1", { allow: true })
    expect(useInteractions.getState().queue).toHaveLength(0)
    const after = computeContextualSplit()
    expect(after.inline).toEqual([])
    expect(after.global).toEqual([])
    expect(answerInteraction).toHaveBeenCalledWith("i1", { allow: true })
  })
})
