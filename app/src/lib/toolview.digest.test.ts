// Digest do cabeçalho do grupo (despoluição do fio, direção B + paleta A):
// o resumo passa a SER a informação — contagem, duração congelada e, na falha,
// a CULPADA nomeada. Strings dos casos vêm do mock docs/mocks/fio-despoluicao-b.html
// e dos builds 186/187 (prints do usuário).
import { describe, expect, it } from "vitest"
import { describeToolGroup, type ToolActivityInput } from "./toolview"

const T0 = 1_754_400_000_000

function bash(
  command: string,
  over: Partial<ToolActivityInput> = {},
): ToolActivityInput {
  return {
    name: "Bash",
    input: { command },
    result: { ok: true },
    ...over,
  }
}

describe("describeToolGroup · falha nomeada no resumo", () => {
  it("uma falha entre várias nomeia a culpada: '1 de N falhou · <culpada>'", () => {
    const tools: ToolActivityInput[] = [
      bash("ls"),
      bash("pwd"),
      {
        name: "Bash",
        input: { description: "Gerar PDF (iPhone SE)", command: "node probe.mjs" },
        result: { ok: false },
      },
      bash("git status"),
      bash("git diff"),
      bash("rg foo src"),
      bash("cat a.txt"),
    ]
    const digest = describeToolGroup(tools)
    expect(digest.label).toBe("1 de 7 falhou · Gerar PDF (iPhone SE)")
    expect(digest.state).toBe("error")
    expect(digest.failed).toBe(1)
    expect(digest.total).toBe(7)
  })

  it("várias falhas viram contagem, sem eleger uma culpada só", () => {
    const digest = describeToolGroup([
      bash("bun run test", { result: { ok: false } }),
      bash("tsc", { result: { ok: false } }),
      bash("ls"),
    ])
    expect(digest.label).toBe("2 de 3 falharam")
    expect(digest.state).toBe("error")
  })

  it("grupo de UMA ação que falhou fala no pretérito direto: '<culpada> falhou'", () => {
    const digest = describeToolGroup([
      {
        name: "Bash",
        input: { description: "Executar testes", command: "bun run test" },
        result: { ok: false },
      },
    ])
    expect(digest.label).toBe("Executar testes falhou")
    expect(digest.state).toBe("error")
  })

  it("a falha vence mesmo com o grupo ainda ativo (não se esconde atrás do corrente)", () => {
    const digest = describeToolGroup(
      [bash("ls", { result: { ok: false } }), bash("pwd", { result: undefined })],
      true,
    )
    expect(digest.state).toBe("error")
    expect(digest.label).toContain("falhou")
  })
})

describe("describeToolGroup · duração congelada (pretérito, regra do Warp)", () => {
  it("grupo assentado congela o tempo total: 1º nascimento → última atividade", () => {
    const digest = describeToolGroup([
      bash("ls", { ts: T0, activityAt: T0 + 300 }),
      bash("cat a.txt", { ts: T0 + 500, activityAt: T0 + 3_000 }),
    ])
    expect(digest.durationMs).toBe(3_000)
    expect(digest.state).toBe("ok")
  })

  it("abaixo de 1s não mostra relógio (nunca '0s')", () => {
    const digest = describeToolGroup([
      bash("ls", { ts: T0, activityAt: T0 + 400 }),
    ])
    expect(digest.durationMs).toBeNull()
  })

  it("rodando não ganha relógio aqui: o 'agora' pertence à linha viva", () => {
    const digest = describeToolGroup(
      [bash("ls", { ts: T0, activityAt: T0 + 5_000 }), bash("pwd", { result: undefined, ts: T0 })],
      true,
    )
    expect(digest.state).toBe("running")
    expect(digest.durationMs).toBeNull()
  })

  it("histórico antigo sem carimbos não inventa duração", () => {
    const digest = describeToolGroup([bash("ls"), bash("pwd")])
    expect(digest.durationMs).toBeNull()
  })
})

describe("describeToolGroup · contagens e paridade com o resumo existente", () => {
  it("conta shells e agentes numa passada só (sussurro do cabeçalho)", () => {
    const digest = describeToolGroup([
      { name: "Task", input: { description: "Investigar" }, result: { ok: true } },
      bash("ls"),
      bash("pwd"),
    ])
    expect(digest.agents).toBe(1)
    expect(digest.shells).toBe(2)
  })

  it("sem falha, mantém a gramática de sempre ('N verificações concluídas')", () => {
    const digest = describeToolGroup([
      bash("git status"),
      bash("rg foo src"),
      { name: "Read", input: { file_path: "/tmp/a.ts" }, result: { ok: true } },
    ])
    expect(digest.label).toBe("3 verificações concluídas")
    expect(digest.state).toBe("ok")
  })

  it("histórico sem tool_result segue 'registradas', nunca pendente", () => {
    const digest = describeToolGroup([
      bash("ls", { result: undefined }),
      bash("pwd", { result: undefined }),
    ])
    expect(digest.label).toBe("2 verificações registradas")
    expect(digest.state).toBe("recorded")
  })

  it("grupo vazio degrada honesto", () => {
    const digest = describeToolGroup([])
    expect(digest.label).toBe("Atividade técnica")
    expect(digest.total).toBe(0)
  })
})

