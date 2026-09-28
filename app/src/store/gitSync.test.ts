import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  chamadas: [] as { cmd: string; args: Record<string, unknown> }[],
  falha: null as null | ((cmd: string) => unknown),
  turno: false,
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    h.chamadas.push({ cmd, args })
    const erro = h.falha?.(cmd)
    if (erro) throw erro
  }),
}))
vi.mock("@/lib/avisos", () => ({ avisar: { feito: vi.fn(), erro: vi.fn() } }))
vi.mock("@/lib/sinaisDoDisco", () => ({ avisarGravacao: vi.fn(), haTurnoNaPasta: () => h.turno }))

const PASTA = "/Users/v/projetos/frota"
/** Saída real de `git push` recusado (LC_ALL=C), como o Rust a entrega. */
const RECUSADO = {
  tipo: "recusado",
  detalhe: " ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'file:///tmp/frota-cap/r.git'",
  dono: null,
  contaAtiva: null,
  contas: [],
}

async function store() {
  const m = await import("@/store/gitSync")
  return m.useGitSync
}

beforeEach(() => {
  vi.resetModules()
  h.chamadas.length = 0
  h.falha = null
  h.turno = false
})

describe("os gestos de rede da aba Alterações", () => {
  it("trazer e enviar vira dois passos, trazer só avançando", async () => {
    const s = await store()
    expect(await s.getState().executar(PASTA, "trazer-e-enviar")).toBe(true)
    expect(h.chamadas.map((c) => [c.cmd, c.args.rebase ?? c.args.publicar])).toEqual([
      ["git_trazer", false],
      ["git_enviar", false],
    ])
    expect(s.getState().emCurso[PASTA]).toBeUndefined()
  })

  it("push recusado vira a faixa com o gesto para repetir, e nada força", async () => {
    h.falha = (cmd) => (cmd === "git_enviar" ? RECUSADO : null)
    const s = await store()
    expect(await s.getState().executar(PASTA, "enviar")).toBe(false)
    expect(s.getState().faixa[PASTA]).toMatchObject({ gesto: "enviar", erro: { tipo: "recusado" } })
    expect(h.chamadas.every((c) => !JSON.stringify(c.args).includes("force"))).toBe(true)
  })

  it("conflito não vira faixa: quem mostra os arquivos é o estado do repositório", async () => {
    h.falha = () => ({ ...RECUSADO, tipo: "conflito" })
    const s = await store()
    await s.getState().executar(PASTA, "trazer", { rebase: true })
    expect(h.chamadas[0]).toMatchObject({ cmd: "git_trazer", args: { rebase: true } })
    expect(s.getState().faixa[PASTA]).toBeUndefined()
  })

  it("com um turno rodando na pasta, trazer não começa, mas enviar sim", async () => {
    h.turno = true
    const s = await store()
    expect(await s.getState().executar(PASTA, "trazer")).toBe(false)
    expect(h.chamadas).toEqual([])
    expect(await s.getState().executar(PASTA, "enviar")).toBe(true)
  })

  it("o mesmo gesto não dispara duas vezes em cima de si", async () => {
    const s = await store()
    const a = s.getState().executar(PASTA, "enviar")
    const b = s.getState().executar(PASTA, "enviar")
    expect(await b).toBe(false)
    expect(await a).toBe(true)
    expect(h.chamadas).toHaveLength(1)
  })
})
