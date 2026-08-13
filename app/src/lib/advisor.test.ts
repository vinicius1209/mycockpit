// Conselheiro inline (Especialistas E1): detecção do gatilho `@persona`, montagem
// do prompt (persona + contexto serializado + pergunta), disparo READ-ONLY pelo
// runAgent, carimbo do parecer (persona id+version+digest) e o "Trazer pro
// Executor". Cobre o caminho feliz E as guardas (fail-closed: não existe vs não
// consegui ler). Mocks no padrão da casa (runAgent/disco não vazam).

import { beforeEach, describe, expect, it, vi } from "vitest"

// isTauri true: runAdvisor só dispara dentro do app.
vi.mock("@/lib/db", async (io) => ({
  ...(await io<typeof import("@/lib/db")>()),
  isTauri: () => true,
}))
// runAgent invoca o Tauri — mocado (só o spy e os eventos simulados interessam).
vi.mock("@/lib/agent", () => ({ runAgent: vi.fn() }))
// getAgentDef bate no disco — mocado p/ testar as 3 resoluções (ok/sumiu/ilegível).
// slugify e os tipos seguem REAIS (spread do original).
vi.mock("@/lib/agentDefs", async (io) => ({
  ...(await io<typeof import("@/lib/agentDefs")>()),
  getAgentDef: vi.fn(),
}))

import type { AgentEvent } from "@/lib/agent"
import { runAgent } from "@/lib/agent"
import { getAgentDef, type AgentDef } from "@/lib/agentDefs"
import {
  ADVISOR_PERMISSION,
  buildAdviceHandoffBlock,
  buildAdviceItem,
  buildAdvisorPrompt,
  detectAdvisorMention,
  resolveAdvisor,
  runAdvisor,
} from "./advisor"

const runAgentMock = vi.mocked(runAgent)
const getAgentDefMock = vi.mocked(getAgentDef)

function agent(over: Partial<AgentDef> = {}): AgentDef {
  return {
    id: "projeto:aline",
    name: "Aline",
    personalityMd: "Você é a Aline, revisora rigorosa de segurança.",
    skills: [],
    policy: null,
    backend: "claude-code",
    model: null,
    effort: null,
    category: "Geral",
    rubric: [],
    avatarStyle: "glass",
    avatarSeed: "aline",
    version: 3,
    createdAt: 0,
    updatedAt: 0,
    digest: "abcdef1234567890",
    scope: "projeto",
    slug: "aline",
    path: "/proj/.mycockpit/agents/aline.md",
    ...over,
  }
}

/** Simula runAgent emitindo os eventos passados e resolvendo. */
function emit(events: AgentEvent[]) {
  runAgentMock.mockImplementation(async (...args) => {
    const onEvent = args[10] as (e: AgentEvent) => void
    for (const e of events) onEvent(e)
  })
}

function result(ok: boolean, text: string | null): AgentEvent {
  return {
    type: "result",
    ok,
    text,
    cost_usd: null,
    cost_source: "unknown",
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    cache_creation: 0,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("detectAdvisorMention (gatilho)", () => {
  it("@persona conhecida vira consulta; o resto do texto é a pergunta", () => {
    const m = detectAdvisorMention("@aline revisa isso aqui", [agent()])
    expect(m).not.toBeNull()
    expect(m!.def.id).toBe("projeto:aline")
    expect(m!.question).toBe("revisa isso aqui")
  })

  it("casa por NOME também (o composer insere @<name>), colapsando o resto", () => {
    const m = detectAdvisorMention("olha isso @Aline por favor", [agent()])
    expect(m!.def.slug).toBe("aline")
    expect(m!.question).toBe("olha isso por favor")
  })

  it("sem menção de persona → null (fluxo normal do executor)", () => {
    expect(detectAdvisorMention("revisa isso aqui", [agent()])).toBeNull()
  })

  it("@ de arquivo/desconhecido não casa persona → null (não é consulta)", () => {
    expect(detectAdvisorMention("@arquivo.ts muda a função", [agent()])).toBeNull()
  })

  it("tira TODOS os @token de personas conhecidas da pergunta (não sobra @bob)", () => {
    const bob = agent({ id: "projeto:bob", name: "Bob", slug: "bob" })
    const m = detectAdvisorMention("@aline @bob revisa isso", [agent(), bob])
    expect(m!.def.slug).toBe("aline") // o 1º que resolve é o consultado
    expect(m!.question).toBe("revisa isso") // @bob não fica cru na pergunta
    expect(m!.question).not.toContain("@")
  })

  it("mas mantém @token que NÃO é persona (ex.: arquivo) na pergunta", () => {
    const m = detectAdvisorMention("@aline olha o @arquivo.ts", [agent()])
    expect(m!.question).toBe("olha o @arquivo.ts")
  })

  it("sem personas carregadas → null", () => {
    expect(detectAdvisorMention("@aline oi", [])).toBeNull()
  })
})

describe("buildAdvisorPrompt (montagem)", () => {
  it("junta persona + política + contexto serializado + pergunta, em read-only", () => {
    const prompt = buildAdvisorPrompt({
      def: agent({ policy: "Nunca aprova sem teste." }),
      context: "Contexto da conversa até aqui:\nUsuário: adiciona login",
      question: "isso tem risco de segurança?",
    })
    expect(prompt).toContain("Você é a Aline, revisora rigorosa de segurança.")
    expect(prompt).toContain("Política de atuação: Nunca aprova sem teste.")
    expect(prompt).toContain("Contexto da conversa até aqui:")
    expect(prompt).toContain("Usuário: adiciona login")
    expect(prompt).toContain("isso tem risco de segurança?")
    // enquadramento de conselheiro read-only (não vira executor)
    expect(prompt).toContain("só leitura")
    expect(prompt).toContain("Não assuma o volante")
  })

  it("pergunta vazia (só a menção) ganha um pedido padrão", () => {
    const prompt = buildAdvisorPrompt({ def: agent(), context: "ctx", question: "" })
    expect(prompt).toContain("Dê seu parecer sobre o estado atual da conversa.")
  })

  it("rubrica não-vazia entra no prompt (o conselheiro VÊ a própria rubrica)", () => {
    const prompt = buildAdvisorPrompt({
      def: agent({ rubric: ["Fail-closed em toda dúvida", "Trilha de auditoria"] }),
      context: "ctx",
      question: "revisa",
    })
    expect(prompt).toContain("Sua rubrica")
    expect(prompt).toContain("- Fail-closed em toda dúvida")
    expect(prompt).toContain("- Trilha de auditoria")
  })

  it("rubrica vazia não inventa bloco de rubrica", () => {
    const prompt = buildAdvisorPrompt({
      def: agent({ rubric: [] }),
      context: "ctx",
      question: "revisa",
    })
    expect(prompt).not.toContain("Sua rubrica")
  })

  it("anexos do envio entram como caminhos (o parecer sabe que existem)", () => {
    const prompt = buildAdvisorPrompt({
      def: agent(),
      context: "ctx",
      question: "revisa",
      attachments: ["/proj/src/a.ts", "/proj/docs/erro.png"],
    })
    expect(prompt).toContain("Arquivos anexados a este pedido")
    expect(prompt).toContain("- /proj/src/a.ts")
    expect(prompt).toContain("- /proj/docs/erro.png")
  })

  it("sem anexos (ou só vazios) não inventa a seção de arquivos", () => {
    expect(
      buildAdvisorPrompt({ def: agent(), context: "ctx", question: "revisa" }),
    ).not.toContain("Arquivos anexados")
    expect(
      buildAdvisorPrompt({
        def: agent(),
        context: "ctx",
        question: "revisa",
        attachments: ["  "],
      }),
    ).not.toContain("Arquivos anexados")
  })
})

describe("runAdvisor (read-only, sem escrita)", () => {
  it("dispara o runAgent no modo leitura, sessão fresca, e acumula o parecer", async () => {
    emit([{ type: "text", text: "Risco: senha em texto puro." }, result(true, null)])
    const res = await runAdvisor({
      def: { backend: "claude-code", model: null, effort: null },
      prompt: "PROMPT",
      cwd: "/proj",
    })
    expect(res.ok).toBe(true)
    expect(res.text).toBe("Risco: senha em texto puro.")
    const call = runAgentMock.mock.calls[0]
    // fusion-ro = read-only ESTRITO: sem escrita E sem MCP (nenhum efeito
    // externo, nenhum ask_user pendurando o run). É o modo mais estrito da casa.
    expect(ADVISOR_PERMISSION).toBe("fusion-ro")
    expect(call[8]).toBe("fusion-ro") // permission (posição 8) = fusion-ro
    expect(call[8]).toBe(ADVISOR_PERMISSION)
    expect(call[7]).toBeNull() // resume null: sessão fresca, não toca o fio
  })

  it("dedup: se veio por deltas, o bloco de texto completo não duplica", async () => {
    emit([
      { type: "text_delta", text: "parte 1 " },
      { type: "text_delta", text: "parte 2" },
      { type: "text", text: "parte 1 parte 2" },
      result(true, "parte 1 parte 2"),
    ])
    const res = await runAdvisor({
      def: { backend: "claude-code", model: null, effort: null },
      prompt: "P",
      cwd: "/proj",
    })
    expect(res.text).toBe("parte 1 parte 2")
  })
})

describe("buildAdviceItem (carimbo de auditoria)", () => {
  it("carimba persona id + version + digest no item de parecer", () => {
    const item = buildAdviceItem(agent(), "tem risco?", "sim, corrige X")
    expect(item.kind).toBe("advice")
    expect(item.personaId).toBe("projeto:aline")
    expect(item.personaName).toBe("Aline")
    expect(item.personaVersion).toBe(3)
    expect(item.digest).toBe("abcdef1234567890")
    expect(item.question).toBe("tem risco?")
    expect(item.text).toBe("sim, corrige X")
  })
})

describe("buildAdviceHandoffBlock (Trazer pro Executor)", () => {
  it("embrulha o parecer num bloco atribuído à persona p/ o próximo turno", () => {
    const item = buildAdviceItem(agent(), "q", "use bcrypt no hash")
    const block = buildAdviceHandoffBlock(item)
    expect(block).toContain("Aline")
    expect(block).toContain("use bcrypt no hash")
    expect(block).toContain("trazido para você considerar")
  })
})

describe("resolveAdvisor (fail-closed: não existe vs não consegui ler)", () => {
  it("persona presente → ok", async () => {
    getAgentDefMock.mockResolvedValue(agent())
    expect(await resolveAdvisor("/proj", "projeto:aline")).toEqual({
      status: "ok",
      def: agent(),
    })
  })

  it("persona sumiu do disco (null) → missing (não existe)", async () => {
    getAgentDefMock.mockResolvedValue(null)
    expect(await resolveAdvisor("/proj", "projeto:aline")).toEqual({
      status: "missing",
    })
  })

  it("disco falhou (getAgentDef lança) → unreadable (não consegui ler)", async () => {
    getAgentDefMock.mockRejectedValue(new Error("EIO"))
    expect(await resolveAdvisor("/proj", "projeto:aline")).toEqual({
      status: "unreadable",
    })
  })
})
