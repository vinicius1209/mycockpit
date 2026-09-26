import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@/lib/advisor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/advisor")>()),
  runAdvisor: vi.fn(),
  resolveAdvisor: vi.fn(),
}))
vi.mock("@/lib/agentDefs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agentDefs")>()),
  listAgentDefs: vi.fn(),
}))

import { resolveAdvisor, runAdvisor } from "@/lib/advisor"
import { listAgentDefs } from "@/lib/agentDefs"
import { useFilaDeConselheiros } from "@/store/filaConselheiros"
import type { AgentDef } from "@/lib/agentDefs"
import { useChat } from "@/store/chat"
import { consultAdvisor, consultarMencionados } from "./consultAdvisor"

const CONV = "c1"

const persona = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: "projeto:iris",
  name: "Íris",
  personalityMd: "Você é a Íris, revisora de interface.",
  skills: [],
  policy: null,
  backend: "claude-code",
  model: null,
  effort: null,
  category: "Geral",
  rubric: [],
  avatarStyle: "glass",
  avatarSeed: "iris",
  version: 3,
  createdAt: 0,
  updatedAt: 0,
  digest: "abcdef1234567890",
  scope: "projeto",
  slug: "iris",
  path: "/proj/.frota/agents/iris.md",
  ...over,
})

beforeEach(() => {
  vi.mocked(runAdvisor).mockReset()
  useFilaDeConselheiros.setState({ porConversa: {} })
  useChat.setState({
    activeId: CONV,
    byId: {
      [CONV]: {
        projectId: "p1",
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
      },
    },
  } as never)
})

describe("consulta a um conselheiro", () => {
  it("o composer pode limpar quando a mensagem ENTRA no fio, não quando o parecer volta", async () => {
    // O defeito de 21/09/2026: o aceite só acontecia depois do parecer, então a
    // mensagem ficava no composer enquanto a conselheira lia o contexto.
    let liberarParecer: (v: Awaited<ReturnType<typeof runAdvisor>>) => void = () => {}
    vi.mocked(runAdvisor).mockReturnValue(
      new Promise((resolve) => {
        liberarParecer = resolve
      }) as ReturnType<typeof runAdvisor>,
    )
    const aoAceitar = vi.fn()

    const consulta = consultAdvisor(
      CONV,
      persona(),
      "da uma olhada",
      { path: "/proj" },
      { text: "@Íris da uma olhada", attachments: [] },
      { aoAceitar },
    )
    await vi.waitFor(() => expect(aoAceitar).toHaveBeenCalledTimes(1))
    // e a mensagem já está no fio, endereçada
    const itens = useChat.getState().byId[CONV].items
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ kind: "user", advisorTo: { name: "Íris" } })
    // o parecer ainda nem chegou
    expect(useChat.getState().byId[CONV].advising).toMatchObject({ name: "Íris" })

    liberarParecer({ ok: true, text: "parecer pronto", error: null })
    await consulta
    expect(useChat.getState().byId[CONV].advising).toBeNull()
  })

  it("com dois chamados, a bolha mostra o trecho de cada um e o anexo aparece uma vez", async () => {
    vi.mocked(runAdvisor).mockResolvedValue({ text: "ok" } as never)
    const anexo = { path: "a/print.png", name: "print.png", kind: "image" as const, mime: "image/png", bytes: 10 }
    const sent = { text: "@Íris olha o mock @Aline e o agy?", attachments: [anexo] }

    await consultAdvisor(CONV, persona(), "olha o mock", { path: "/proj" }, sent, {
      bolha: "olha o mock",
      mostrarAnexos: true,
    })
    await consultAdvisor(
      CONV,
      persona({ id: "projeto:aline", name: "Aline", slug: "aline" }),
      "e o agy?",
      { path: "/proj" },
      sent,
      { bolha: "e o agy?", mostrarAnexos: false },
    )

    const bolhas = useChat.getState().byId[CONV].items.filter((i) => i.kind === "user")
    expect(bolhas.map((b) => b.text)).toEqual(["olha o mock", "e o agy?"])
    expect(bolhas.map((b) => b.advisorTo?.name)).toEqual(["Íris", "Aline"])
    expect(bolhas[0].attachments).toHaveLength(1)
    expect(bolhas[1].attachments).toBeUndefined()
  })
})

describe("anexo que não chega ao especialista", () => {
  const pdf = { path: "attachments/c1/relatorio.pdf", name: "relatorio.pdf", kind: "pdf" as const, mime: "application/pdf", bytes: 1 }
  const img = { path: "attachments/c1/print.png", name: "print.png", kind: "image" as const, mime: "image/png", bytes: 1 }

  it("motor sem PDF: uma linha no fio diz o que não chegou, e o run não o leva", async () => {
    vi.mocked(runAdvisor).mockResolvedValue({ ok: true, text: "ok", error: null })
    await consultAdvisor(CONV, persona({ backend: "codex" }), "revisa", { path: "/proj" }, {
      text: "@Íris revisa",
      attachments: [img, pdf],
    })
    const avisos = useChat.getState().byId[CONV].items.filter((i) => i.kind === "notice")
    expect(avisos.map((a) => (a as { message: string }).message)).toEqual([
      "Íris não recebeu 1 anexo deste pedido: relatorio.pdf (o Codex não lê PDF).",
    ])
    expect(vi.mocked(runAdvisor).mock.calls[0][0].attachments).toEqual([img])
  })

  it("com tudo entregue, nenhuma linha a mais no fio", async () => {
    vi.mocked(runAdvisor).mockResolvedValue({ ok: true, text: "ok", error: null })
    await consultAdvisor(CONV, persona(), "revisa", { path: "/proj" }, {
      text: "@Íris revisa",
      attachments: [img, pdf],
    })
    expect(useChat.getState().byId[CONV].items.map((i) => i.kind)).toEqual(["user", "advice"])
    expect(vi.mocked(runAdvisor).mock.calls[0][0].attachments).toEqual([img, pdf])
  })
})

describe("dois chamados na mesma mensagem", () => {
  it("a fila nasce no envio, cada um sai dela ao começar, e some no fim", async () => {
    const vistas: string[][] = []
    vi.mocked(runAdvisor).mockImplementation(async () => {
      vistas.push(
        (useFilaDeConselheiros.getState().porConversa[CONV] ?? []).map((c) => c.name),
      )
      return { ok: true, text: "parecer", error: null }
    })
    vi.mocked(listAgentDefs).mockResolvedValue([
      persona(),
      persona({ id: "projeto:aline", name: "Aline", slug: "aline" }),
    ])
    vi.mocked(resolveAdvisor).mockImplementation(async (_p, id) => ({
      status: "ok",
      def: id === "projeto:iris" ? persona() : persona({ id: "projeto:aline", name: "Aline", slug: "aline" }),
    }))

    const virou = await consultarMencionados({
      convId: CONV,
      project: { path: "/proj" },
      sent: { text: "@Íris olha o mock @Aline e o agy?", attachments: [] },
    })

    expect(virou).toBe(true)
    // Enquanto a Íris lia, a Aline estava visível na espera; depois, ninguém.
    expect(vistas).toEqual([["Aline"], []])
    expect(useFilaDeConselheiros.getState().porConversa[CONV] ?? []).toEqual([])
  })

  it("quem não consegue opinar deixa linha no fio, não só um toast", async () => {
    vi.mocked(listAgentDefs).mockResolvedValue([persona()])
    vi.mocked(resolveAdvisor).mockResolvedValue({ status: "ok", def: persona() })
    vi.mocked(runAdvisor).mockResolvedValue({ ok: false, text: "", error: "sem resposta" } as never)

    await consultarMencionados({
      convId: CONV,
      project: { path: "/proj" },
      sent: { text: "@Íris e aí?", attachments: [] },
    })

    const itens = useChat.getState().byId[CONV].items
    const aviso = itens.find((i) => i.kind === "notice")
    expect(aviso?.message).toBe("Íris não opinou neste turno: sem resposta")
  })
})
