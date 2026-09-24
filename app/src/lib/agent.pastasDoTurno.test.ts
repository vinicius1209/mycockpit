// ADR-252: a pasta do arquivo solto de fora do projeto vale SÓ no envio em que
// ele foi citado. O `runAgent` é o ponto único por onde todo envio passa, e é
// ele que lê a moldura do prompt e manda as pastas no invoke, só para motor
// que recebe pasta extra (capability, nunca nome de motor).
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import { emoldurarArquivos, textoComArquivos } from "@/lib/arquivoCitado"

const h = vi.hoisted(() => ({ invokes: [] as Record<string, unknown>[] }))

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((e: AgentEvent) => void) | null = null
  },
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "run_agent") throw new Error(`invoke não mapeado: ${cmd}`)
    h.invokes.push(args)
    return null
  }),
}))
vi.mock("@/lib/db", () => ({
  loadUsageBaseline: vi.fn(async () => null),
  saveUsageBaseline: vi.fn(async () => {}),
}))

import { runAgent } from "@/lib/agent"

const ESLINT = "/Users/viniciusmachado/projetos/agencia_vm/vm-prospector/eslint.config.js"
const PROMPT = emoldurarArquivos(
  textoComArquivos("compara esse eslint com o nosso", [
    { tipo: "arquivo", id: "a", caminho: ESLINT, pasta: false, bytes: 305 },
  ]),
  (corpo) => corpo,
)

async function enviar(agent: string) {
  await runAgent("run-1", "conv-1", agent, null, null, PROMPT, "/Users/viniciusmachado/projetos/frota", null, "padrao", [], () => {})
  return h.invokes.at(-1)!
}

describe("runAgent: pastas só deste envio", () => {
  beforeEach(() => {
    h.invokes.length = 0
  })

  it("motor que recebe pasta extra ganha a pasta do arquivo de fora", async () => {
    expect((await enviar("claude-code")).pastasDoTurno).toEqual([
      "/Users/viniciusmachado/projetos/agencia_vm/vm-prospector",
    ])
  })

  it("motor sem a capacidade recebe só o caminho no prompt, nenhuma pasta", async () => {
    const args = await enviar("opencode")
    expect(args.pastasDoTurno).toEqual([])
    expect(args.prompt).toContain(ESLINT)
  })

  it("pedido sem arquivo solto não libera nada", async () => {
    await runAgent("run-2", "conv-1", "claude-code", null, null, "oi", "/repo", null, "padrao", [], () => {})
    expect(h.invokes.at(-1)!.pastasDoTurno).toEqual([])
  })
})
