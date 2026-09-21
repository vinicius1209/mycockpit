import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock("@/lib/advisor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/advisor")>()),
  runAdvisor: vi.fn(),
}))

import { runAdvisor } from "@/lib/advisor"
import type { AgentDef } from "@/lib/agentDefs"
import { useChat } from "@/store/chat"
import { consultAdvisor } from "./consultAdvisor"

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
