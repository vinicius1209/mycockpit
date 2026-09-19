// Regras puras da "cara de app" do Companion (core.js servido pelo binário):
// identidade por hash, pulso da frota, prévia da linha e grupo de ferramentas.
// Mesmo arquivo nas duas pontas, como em companionWeb.test.ts.
import { describe, expect, it } from "vitest"
import "../../src-tauri/companion/core.js"

const core = globalThis.CompanionCore

const T0 = 1_789_600_000_000

// Formato de `buildCompanionSnapshot` (lib/companion.ts): uma aprovação e uma
// pergunta pendentes, um turno rodando, e as recentes de dois projetos.
const snap = {
  attention: [
    { id: "apr-77", kind: "approval", convId: "conv-t1", projectId: "p2", projectName: "site-maclan",
      agent: "codex", phase: null, phaseLabel: null, command: "rm -rf node_modules && bun install", toolName: "Bash" },
    { id: "q-12", kind: "question", convId: "conv-t2", projectId: "p1", projectName: "mycockpit",
      agent: "claude-code", phase: null, phaseLabel: null, questions: ["Qual estratégia de cache prefere?"] },
  ],
  running: [
    { convId: "conv-t9", projectId: "p1", projectName: "mycockpit", kind: "turno", agent: "claude-code",
      label: "Atualizar dependências", detail: "finalizando…", startedAt: null, finalizing: true },
  ],
  projects: [
    { id: "p1", name: "mycockpit", agents: [{ agent: "claude-code" }],
      recent: [
        { convId: "conv-t2", title: "Estratégia de cache do snapshot", agent: "claude-code", updatedAt: T0 - 9 * 60000, running: false, pedeVoce: true },
        { convId: "conv-t9", title: "Atualizar dependências", agent: "claude-code", updatedAt: T0 - 2 * 60000, running: true, pedeVoce: false },
        { convId: "c1", title: "Revisar o parser do diff", agent: "claude-code", updatedAt: T0 - 4 * 60000, running: false, pedeVoce: false,
          frase: "Extraiu o parser pra lib/ e cobriu o caso vazio." },
        { convId: "c3", title: "Subir o worker", agent: null, updatedAt: T0 - 3 * 3600000, running: false, pedeVoce: false },
      ] },
  ],
}

describe("identidade por hash", () => {
  it("o mesmo id cai sempre no mesmo índice, dentro do intervalo", () => {
    const a = core.hashIndex("conv-t1", 6)
    expect(core.hashIndex("conv-t1", 6)).toBe(a)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(6)
  })

  it("id vazio ou n inválido não quebra", () => {
    expect(core.hashIndex(null, 6)).toBe(0)
    expect(core.hashIndex("x", 0)).toBe(0)
  })
})

describe("hora curta da linha", () => {
  it("agora, minutos, horas e dias", () => {
    expect(core.shortAgo(T0, T0 - 20_000)).toBe("agora")
    expect(core.shortAgo(T0, T0 - 4 * 60_000)).toBe("4 min")
    expect(core.shortAgo(T0, T0 - 3 * 3_600_000)).toBe("3 h")
    expect(core.shortAgo(T0, T0 - 2 * 86_400_000)).toBe("2 d")
  })

  it("sem carimbo, sem texto", () => {
    expect(core.shortAgo(T0, null)).toBe("")
    expect(core.shortAgo(T0, 0)).toBe("")
  })
})

describe("pulso da frota (a cara do topo)", () => {
  it("quem pede você vence quem roda", () => {
    expect(core.fleetPulse(snap, false)).toEqual({ state: "pede", label: "2 pedem você · 1 rodando" })
  })

  it("singular quando é um só", () => {
    const um = { ...snap, attention: [snap.attention[0]], running: [] }
    expect(core.fleetPulse(um, false).label).toBe("1 pede você · nada rodando")
  })

  it("sem pendência: rodando ou calma", () => {
    expect(core.fleetPulse({ ...snap, attention: [] }, false)).toEqual({ state: "roda", label: "1 rodando" })
    expect(core.fleetPulse({ attention: [], running: [] }, false)).toEqual({ state: "calma", label: "nada rodando" })
  })

  it("fora do ar vence tudo, com o carimbo de quando foi visto", () => {
    expect(core.fleetPulse(snap, true, "visto há 3 min")).toEqual({
      state: "off",
      label: "Sem conexão com o Mac · visto há 3 min",
    })
  })

  it("sem snapshot ainda, diz que está conectando em vez de fingir calma", () => {
    expect(core.fleetPulse(null, false).state).toBe("wait")
  })
})

describe("prévia da linha de conversa", () => {
  const lista = core.homeConversations(snap, null)
  const de = (id: string) => lista.find((c) => c.convId === id)

  it("homeConversations leva a frase do snapshot e null quando não há", () => {
    expect(de("c1")?.frase).toBe("Extraiu o parser pra lib/ e cobriu o caso vazio.")
    expect(de("c3")?.frase).toBeNull()
  })

  it("pergunta pendente mostra a própria pergunta", () => {
    expect(core.convPreview(de("conv-t2"), snap)).toEqual({ tone: "pede", text: "Qual estratégia de cache prefere?" })
  })

  it("aprovação pendente mostra o comando", () => {
    expect(core.convPreview({ convId: "conv-t1" }, snap)).toEqual({
      tone: "pede",
      text: "Pede aprovação: rm -rf node_modules && bun install",
    })
  })

  it("turno vivo mostra o detalhe do running", () => {
    expect(core.convPreview(de("conv-t9"), snap)).toEqual({ tone: "roda", text: "finalizando…" })
  })

  it("conversa parada mostra a frase pronta; sem frase, nada inventado", () => {
    expect(core.convPreview(de("c1"), snap)).toEqual({ tone: "", text: "Extraiu o parser pra lib/ e cobriu o caso vazio." })
    expect(core.convPreview(de("c3"), snap)).toEqual({ tone: "", text: "" })
  })
})

describe("grupo de ferramentas no fio", () => {
  // Itens no formato de GET /api/conv (mesmos do mock da página).
  const itens = [
    { kind: "user", id: "i1", text: "O formulário de contato não envia no Safari. Investiga?" },
    { kind: "tool", id: "i3", name: "Grep", input: { pattern: "onSubmit", path: "src/" }, result: { ok: true, text: "3 matches", lines: 3 } },
    { kind: "tool", id: "i4", name: "Bash", input: { command: "bun test contact-form" }, result: { ok: false, text: "1 fail", lines: 12 } },
    { kind: "notice", id: "i5", message: "Contexto compactado (78% do limite)." },
    { kind: "tool", id: "i6", name: "Grep", input: { pattern: "FormData" }, result: null },
    { kind: "result", id: "i8", ok: true, costUsd: 0.18, durationMs: 214000 },
  ]

  it("ferramentas seguidas viram um grupo; o resto passa intacto e na ordem", () => {
    const g = core.groupThreadItems(itens)
    expect(g.map((x) => x.kind)).toEqual(["user", "tools", "notice", "tools", "result"])
    expect((g[1] as CompanionWebToolGroup).items.map((t) => t.id)).toEqual(["i3", "i4"])
    expect(g[0]).toBe(itens[0])
  })

  it("rótulo conta, lista os nomes e diz quantas falharam", () => {
    const g = core.groupThreadItems(itens)
    expect(core.toolGroupLabel((g[1] as CompanionWebToolGroup).items)).toBe("2 ações · Grep, Bash · 1 falhou")
    expect(core.toolGroupLabel((g[3] as CompanionWebToolGroup).items)).toBe("1 ação · Grep")
  })

  it("entrada que não é lista vira lista vazia", () => {
    expect(core.groupThreadItems(null)).toEqual([])
  })
})
