import { describe, expect, it, vi } from "vitest"
import {
  HANDOFF_MAX_CHANGED_FILES,
  HANDOFF_RECENT_BUDGET_CHARS,
  buildContextEnvelope,
  prepareHybridHandoff,
  recentHistory,
  renderHybridHandoff,
  type ContextReference,
} from "./handoff"
import type { GitDiff } from "./git"
import type { ChatItem } from "@/store/chat"

const user = (text: string, id: string = crypto.randomUUID()): ChatItem => ({
  kind: "user",
  id,
  text,
})
const assistant = (text: string, id: string = crypto.randomUUID()): ChatItem => ({
  kind: "text",
  id,
  text,
})

const refs: ContextReference[] = [
  {
    kind: "manifest",
    uri: "context://conversation/c1/manifest",
    path: ".mycockpit/context/c1.handoff.json",
    description: "Índice",
  },
  {
    kind: "transcript",
    uri: "context://conversation/c1/transcript",
    path: ".mycockpit/context/c1.md",
    description: "Transcrição",
  },
]

const emptyDiff: GitDiff = { isRepo: true, branch: "main", files: [] }

describe("ContextEnvelope", () => {
  it("separa working set, falha de origem e ponteiros sem copiar o fio inteiro", () => {
    const old = "antigo ".repeat(4_000)
    const items: ChatItem[] = [
      user(old, "u0"),
      assistant("Decidimos usar um gateway.", "a0"),
      user("Implemente agora", "u1"),
      { kind: "error", id: "e1", message: "API indisponível" },
    ]
    const envelope = buildContextEnvelope({
      convId: "c1",
      sourceAgent: "claude-code",
      targetAgent: "codex",
      items,
      pendingUserIndex: 2,
      diff: emptyDiff,
      lessonsBlock: "## Lições\n- Preserve o contrato\n- Rode os testes",
      references: refs,
      date: new Date("2026-07-29T12:00:00.000Z"),
    })
    expect(envelope.pending_request).toBe("Implemente agora")
    expect(envelope.source_failure).toContain("API indisponível")
    expect(envelope.recent_history.length).toBeLessThanOrEqual(
      HANDOFF_RECENT_BUDGET_CHARS + 100,
    )
    expect(envelope.recent_history).toContain("gateway")
    expect(envelope.truncation.recent_history).toBe(true)
    expect(envelope.lessons).toEqual(["Preserve o contrato", "Rode os testes"])
    expect(envelope.references).toEqual(refs)
  })

  it("limita o índice de arquivos e mantém apenas referências leves", () => {
    const diff: GitDiff = {
      isRepo: true,
      branch: "feature/context",
      files: Array.from({ length: HANDOFF_MAX_CHANGED_FILES + 5 }, (_, i) => ({
        path: `src/f${i}.ts`,
        oldPath: null,
        status: "modified",
        additions: i,
        deletions: 0,
        binary: false,
        hunks: [],
      })),
    }
    const envelope = buildContextEnvelope({
      convId: "c1",
      sourceAgent: "codex",
      targetAgent: "claude-code",
      items: [user("continue")],
      pendingUserIndex: 0,
      diff,
      references: refs,
    })
    expect(envelope.changed_files).toHaveLength(HANDOFF_MAX_CHANGED_FILES)
    expect(envelope.truncation.changed_files).toBe(true)
    expect(envelope.changed_files[0]).toEqual({
      path: "src/f0.ts",
      status: "modified",
      additions: 0,
      deletions: 0,
    })
  })
})

describe("renderHybridHandoff", () => {
  it("coloca identidade/doutrina no início e o pedido uma única vez no final", () => {
    const envelope = buildContextEnvelope({
      convId: "c1",
      sourceAgent: "claude-code",
      targetAgent: "codex",
      items: [user("faça a migração")],
      pendingUserIndex: 0,
      diff: emptyDiff,
      references: refs,
    })
    const prompt = renderHybridHandoff(
      envelope,
      "<persona>revisor</persona>",
      "<project_doctrine>sem atalhos</project_doctrine>",
    )
    expect(prompt.startsWith("<persona>revisor</persona>")).toBe(true)
    expect(prompt).toContain("context_manifest")
    expect(prompt).toContain(".mycockpit/context/c1.md")
    expect(prompt.match(/faça a migração/g)).toHaveLength(1)
    expect(prompt.endsWith("faça a migração")).toBe(true)
  })
})

describe("prepareHybridHandoff", () => {
  it("exporta transcript pleno + manifesto e mantém o push pequeno", async () => {
    const huge = "detalhe antigo ".repeat(8_000)
    const items: ChatItem[] = [
      user(huge, "u0"),
      assistant("Estado recente e relevante.", "a0"),
      user("continue daqui", "u1"),
      { kind: "limit", id: "l1", message: "usage limit" },
    ]
    const write = vi.fn(
      async (
        _cwd: string,
        _convId: string,
        _markdown: string,
        _manifest: string,
      ) => ({
        transcriptPath: ".mycockpit/context/c1.md",
        manifestPath: ".mycockpit/context/c1.handoff.json",
      }),
    )
    const prepared = await prepareHybridHandoff({
      projectId: "p1",
      cwd: "/repo",
      convId: "c1",
      sourceAgent: "claude-code",
      targetAgent: "codex",
      items,
      pendingUserIndex: 2,
      getDiff: async () => emptyDiff,
      exportBundle: write,
      date: new Date("2026-07-29T12:00:00.000Z"),
    })
    expect(write).toHaveBeenCalledTimes(1)
    const [, , transcript, manifest] = write.mock.calls[0]
    expect(transcript).toContain(huge)
    expect(JSON.parse(manifest).pending_request).toBe("continue daqui")
    expect(prepared.prompt).not.toContain(huge)
    expect(prepared.prompt.length).toBeLessThan(9_000)
    expect(prepared.paths?.manifestPath).toContain("handoff.json")
  })

  it("degrada sem ponteiros de arquivo quando o export falha", async () => {
    const prepared = await prepareHybridHandoff({
      projectId: "p1",
      cwd: "/repo",
      convId: "c1",
      sourceAgent: "claude-code",
      targetAgent: "codex",
      items: [assistant("já fiz A"), user("faça B")],
      pendingUserIndex: 1,
      getDiff: async () => emptyDiff,
      exportBundle: async () => {
        throw new Error("disco cheio")
      },
    })
    expect(prepared.paths).toBeNull()
    expect(prepared.prompt).not.toContain(".mycockpit/context/c1.md")
    expect(prepared.prompt).toContain("context://conversation/c1")
    expect(prepared.prompt).toContain("faça B")
  })

  it("não promete MCP nem SQLite ao Agy", async () => {
    const prepared = await prepareHybridHandoff({
      projectId: "p1",
      cwd: "/repo",
      convId: "c1",
      sourceAgent: "codex",
      targetAgent: "agy",
      items: [assistant("já fiz A"), user("faça B")],
      pendingUserIndex: 1,
      getDiff: async () => emptyDiff,
      exportBundle: async () => {
        throw new Error("disco cheio")
      },
    })
    expect(prepared.envelope.references).toEqual([])
    expect(prepared.prompt).not.toContain("mc-context")
    expect(prepared.prompt).not.toContain("context://conversation")
    expect(prepared.prompt).toContain("faça B")
  })
})

describe("recentHistory", () => {
  it("é tail-biased", () => {
    const items: ChatItem[] = [
      user("primeiro " + "x".repeat(100)),
      assistant("último ponto importante"),
    ]
    const history = recentHistory(items, 80)
    expect(history.text).not.toContain("primeiro")
    expect(history.text).toContain("último ponto importante")
    expect(history.truncated).toBe(true)
  })
})
