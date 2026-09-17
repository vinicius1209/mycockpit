import { describe, expect, it } from "vitest"
import { avisoDeOrfaos, quedaDoNavegador } from "./vigiaDoNavegador"

describe("vigia do navegador do projeto", () => {
  it("saída do navegador sem pedido é queda; parada pedida não é", () => {
    const base = { runId: "browser-54c053f3-9117-4522-a151-42015673bbfc", exitCode: 1 }
    expect(quedaDoNavegador({ ...base, status: "failed" })).toEqual({
      projectId: "54c053f3-9117-4522-a151-42015673bbfc",
      exitCode: 1,
    })
    expect(quedaDoNavegador({ ...base, status: "exited", exitCode: 0 })).toMatchObject({ exitCode: 0 })
    expect(quedaDoNavegador({ ...base, status: "stopped" })).toBeNull()
    expect(quedaDoNavegador({ ...base, status: "running" })).toBeNull()
  })

  it("processo que não é navegador nunca vira aviso de navegador", () => {
    expect(quedaDoNavegador({ runId: "run-123", status: "failed", exitCode: 1 })).toBeNull()
  })

  it("aviso de sobra diz quantos e de quais projetos", () => {
    const nome = (id: string) => ({ p1: "jornal", p2: "mycockpit" })[id] ?? null
    expect(avisoDeOrfaos([{ pid: 1, projectId: "p1" }], nome)).toBe(
      "Um navegador de projeto (jornal) ficou aberto de uma sessão anterior e segura o perfil.",
    )
    expect(avisoDeOrfaos([{ pid: 1, projectId: "p1" }, { pid: 2, projectId: "p2" }], nome)).toBe(
      "2 navegadores de projeto (jornal, mycockpit) ficaram abertos de uma sessão anterior e seguram os perfis.",
    )
    expect(avisoDeOrfaos([{ pid: 1, projectId: "sumiu" }], nome)).toBe(
      "Um navegador de projeto ficou aberto de uma sessão anterior e segura o perfil.",
    )
  })
})
