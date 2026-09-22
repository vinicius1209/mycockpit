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
  MAX_ANEXOS_ANTERIORES,
  anexosDoParecer,
  avisoDeAnexoNaoEntregue,
  entregaveisAoMotor,
  buildAdviceHandoffBlock,
  buildAdviceItem,
  buildAdvisorPrompt,
  detectAdvisorMentions,
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

describe("detectAdvisorMentions (gatilho)", () => {
  const bob = () => agent({ id: "projeto:bob", name: "Bob", slug: "bob" })
  const uma = (texto: string, agentes = [agent()]) => detectAdvisorMentions(texto, agentes)

  it("@persona conhecida vira consulta; o resto do texto é a pergunta", () => {
    const m = uma("@aline revisa isso aqui")
    expect(m).toHaveLength(1)
    expect(m[0].def.id).toBe("projeto:aline")
    expect(m[0].question).toBe("revisa isso aqui")
  })

  it("casa por NOME também (o composer insere @<name>), colapsando o resto", () => {
    const m = uma("olha isso @Aline por favor")
    expect(m[0].def.slug).toBe("aline")
    // o que veio ANTES da menção é dela também: quem escreve assim está
    // falando com ela desde o começo.
    expect(m[0].question).toBe("olha isso por favor")
  })

  it("sem menção de persona → lista vazia (fluxo normal do executor)", () => {
    expect(uma("revisa isso aqui")).toEqual([])
  })

  it("@ de arquivo/desconhecido não casa persona → lista vazia", () => {
    expect(uma("@arquivo.ts muda a função")).toEqual([])
  })

  it("DOIS especialistas chamados: os dois entram, cada um com o trecho dele", () => {
    // O caso do relato de 21/09/2026: duas perguntas numa mensagem só. Antes,
    // só a primeira era consultada, e ela recebia as duas perguntas juntas.
    const texto =
      "@aline da uma olhada no mock html e diz se ficou melhor.\n\n@bob e sobre o agy ser configuração global, o que tu acha?"
    const m = detectAdvisorMentions(texto, [agent(), bob()])
    expect(m.map((x) => x.def.slug)).toEqual(["aline", "bob"])
    expect(m[0].question).toBe("da uma olhada no mock html e diz se ficou melhor.")
    expect(m[1].question).toBe("e sobre o agy ser configuração global, o que tu acha?")
    expect(m[0].question).not.toContain("agy")
  })

  it("chamadas coladas dividem a mesma pergunta, e nenhum @persona sobra crua", () => {
    const m = detectAdvisorMentions("@aline @bob revisa isso", [agent(), bob()])
    expect(m.map((x) => x.def.slug)).toEqual(["aline", "bob"])
    expect(m.map((x) => x.question)).toEqual(["revisa isso", "revisa isso"])
    expect(m.every((x) => !x.question.includes("@"))).toBe(true)
  })

  it("a ordem é a do texto, não a da lista de personas", () => {
    const m = detectAdvisorMentions("@bob primeiro, @aline depois", [agent(), bob()])
    expect(m.map((x) => x.def.slug)).toEqual(["bob", "aline"])
  })

  it("mantém @token que NÃO é persona (ex.: arquivo) na pergunta", () => {
    const m = uma("@aline olha o @arquivo.ts")
    expect(m[0].question).toBe("olha o @arquivo.ts")
  })

  it("sem personas no projeto não há consulta", () => {
    expect(detectAdvisorMentions("@aline oi", [])).toEqual([])
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

  // Payload REAL do pedido à Íris (22/09/2026, conversa 0d2e7d91): o anexo
  // chega relativo à pasta de dados da Frota, não ao projeto. O fixture
  // anterior usava "/proj/docs/erro.png", absoluto e inventado, e foi o que
  // escondeu o bug (ADR-016).
  const PRINT_1 = {
    path: "attachments/0d2e7d91-bf65-4536-835e-3c97c201fa85/87da3d956fc61e7a.png",
    name: "mapa-mundi.png",
    kind: "image" as const,
    mime: "image/png",
    bytes: 1,
  }
  const PRINT_2 = { ...PRINT_1, path: "attachments/0d2e7d91-bf65-4536-835e-3c97c201fa85/521575f48cd49f99.png", name: "521575f48cd49f99.png" }

  it("anexos entram pelo nome e pela origem, nunca pelo caminho relativo que enganava", () => {
    const prompt = buildAdvisorPrompt({
      def: agent(),
      context: "ctx",
      question: "revisa",
      anexos: { doPedido: [PRINT_1], anteriores: [PRINT_2] },
    })
    expect(prompt).toContain("Anexos deste pedido")
    expect(prompt).toContain("- mapa-mundi.png (arquivo 87da3d956fc61e7a.png)")
    expect(prompt).toContain("Anexos de mensagens anteriores desta conversa")
    expect(prompt).toContain("- 521575f48cd49f99.png")
    expect(prompt).not.toContain("attachments/0d2e7d91")
  })

  it("sem anexos não inventa a seção de arquivos", () => {
    expect(buildAdvisorPrompt({ def: agent(), context: "ctx", question: "revisa" })).not.toContain("Anexos")
    expect(
      buildAdvisorPrompt({ def: agent(), context: "ctx", question: "revisa", anexos: { doPedido: [], anteriores: [] } }),
    ).not.toContain("Anexos")
  })

  it("anteriores vêm do mais recente, sem repetir o do pedido, com teto", () => {
    const img = (n: number) => ({ ...PRINT_1, path: `attachments/c/${n}.png`, name: `${n}.png` })
    const itens = [
      { kind: "user", id: "u1", text: "a", ts: 1, attachments: [img(1), img(2), img(3), img(4)] },
      { kind: "assistant", id: "a1", text: "ok", ts: 2 },
      { kind: "user", id: "u2", text: "b", ts: 3, attachments: [img(5), img(6), img(7), PRINT_1] },
    ] as never
    const { doPedido, anteriores } = anexosDoParecer([PRINT_1, PRINT_1], itens)
    expect(doPedido).toEqual([PRINT_1])
    expect(anteriores.map((a) => a.name)).toEqual(["7.png", "6.png", "5.png", "4.png", "3.png", "2.png"])
    expect(anteriores).toHaveLength(MAX_ANEXOS_ANTERIORES)
  })
})

describe("o que o motor do especialista lê", () => {
  const img = { path: "attachments/c/print.png", name: "print.png", kind: "image" as const, mime: "image/png", bytes: 1 }
  const pdf = { path: "attachments/c/relatorio.pdf", name: "relatorio.pdf", kind: "pdf" as const, mime: "application/pdf", bytes: 1 }
  const pdfVelho = { ...pdf, path: "attachments/c/velho.pdf", name: "velho.pdf" }

  it("motor sem PDF: o do pedido é dito, o anterior sai calado", () => {
    const r = entregaveisAoMotor({ doPedido: [img, pdf], anteriores: [pdfVelho, img] }, { image: true, pdf: false })
    expect(r.doPedido).toEqual([img])
    expect(r.naoEntregues).toEqual([pdf])
    expect(r.anteriores).toEqual([img])
  })

  it("motor que lê tudo não gera aviso nenhum: a tela não muda", () => {
    const r = entregaveisAoMotor({ doPedido: [img, pdf], anteriores: [] }, { image: true, pdf: true })
    expect(r.naoEntregues).toEqual([])
    expect(avisoDeAnexoNaoEntregue("Íris", "Claude", r.naoEntregues ?? [])).toBeNull()
  })

  it("motor desconhecido não recebe anexo por omissão", () => {
    expect(entregaveisAoMotor({ doPedido: [img], anteriores: [img] }, undefined).naoEntregues).toEqual([img])
  })

  it("a linha diz quem, quantos, quais e por quê", () => {
    expect(avisoDeAnexoNaoEntregue("Íris", "Codex", [pdf])).toBe(
      "Íris não recebeu 1 anexo deste pedido: relatorio.pdf (o Codex não lê PDF).",
    )
    expect(avisoDeAnexoNaoEntregue("Íris", "Ollama", [img, pdf])).toBe(
      "Íris não recebeu 2 anexos deste pedido: print.png, relatorio.pdf (o Ollama não lê imagem nem PDF).",
    )
  })

  it("o especialista sabe que o anexo existe e que não o recebeu", () => {
    const prompt = buildAdvisorPrompt({
      def: agent(),
      context: "ctx",
      question: "revisa",
      anexos: { doPedido: [], anteriores: [], naoEntregues: [pdf] },
    })
    expect(prompt).toContain("não opine como se os tivesse visto")
    expect(prompt).toContain("- relatorio.pdf")
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
    expect(call[9]).toEqual([]) // sem anexo, nada entregue
  })

  it("anexos vão ao motor como num turno normal (o Rust valida e dá o acesso)", async () => {
    emit([{ type: "text", text: "vi as imagens" }, result(true, null)])
    const anexo = { path: "attachments/c/1.png", name: "1.png", kind: "image" as const, mime: "image/png", bytes: 1 }
    await runAdvisor({
      def: { backend: "claude-code", model: null, effort: null },
      prompt: "P",
      cwd: "/proj",
      attachments: [anexo],
    })
    const call = runAgentMock.mock.calls[0]
    expect(call[9]).toEqual([anexo])
    expect(call[8]).toBe(ADVISOR_PERMISSION) // continua só leitura
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
