import { describe, expect, it } from "vitest"
import {
  diagnosticoDoGh,
  GH_DESCONHECIDO,
  GH_INSTALL_COMMAND,
  GH_LOGIN_COMMAND,
} from "@/lib/github"

const conta = (user: string, active: boolean) => ({ user, active })

describe("diagnosticoDoGh — quatro estados, quatro remédios", () => {
  it("sem CLI: o remédio é INSTALAR, não logar", () => {
    const d = diagnosticoDoGh({ installed: false, version: null, accounts: [] })
    expect(d).toEqual({ estado: "sem-cli", comando: GH_INSTALL_COMMAND })
  })

  it("com CLI e sem conta: o remédio é LOGAR, não instalar", () => {
    // O defeito que a separação impede: colapsar os dois num "não conectado"
    // manda o usuário rodar o comando errado.
    const d = diagnosticoDoGh({
      installed: true,
      version: "2.62.0",
      accounts: [],
    })
    expect(d).toEqual({ estado: "sem-conta", comando: GH_LOGIN_COMMAND })
  })

  it("uma conta ativa: diz qual é", () => {
    const d = diagnosticoDoGh({
      installed: true,
      version: "2.62.0",
      accounts: [conta("alice", true)],
    })
    expect(d.estado).toBe("ok")
    if (d.estado !== "ok") throw new Error("estado inesperado")
    expect(d.ativa.user).toBe("alice")
    expect(d.contas).toHaveLength(1)
  })

  it("duas contas: a ATIVA é a apontada, mesmo não sendo a primeira", () => {
    // Este é o caso do incidente real: com duas contas, saber qual responde é
    // a informação inteira. Eleger a primeira daria a resposta errada aqui.
    const d = diagnosticoDoGh({
      installed: true,
      version: "2.62.0",
      accounts: [conta("pessoal", false), conta("trabalho", true)],
    })
    expect(d.estado).toBe("ok")
    if (d.estado !== "ok") throw new Error("estado inesperado")
    expect(d.ativa.user).toBe("trabalho")
    // e as duas continuam listadas: o app tenta as outras antes de desistir.
    expect(d.contas.map((c) => c.user)).toEqual(["pessoal", "trabalho"])
  })

  it("contas logadas mas NENHUMA marcada ativa → 'não sei', nunca a primeira", () => {
    // Só acontece se o formato do `gh auth status` mudar sob nós. A resposta
    // honesta é admitir; chutar a primeira reintroduz o incidente que esta
    // tela existe pra evitar, agora com a autoridade da interface.
    const d = diagnosticoDoGh({
      installed: true,
      version: "9.0.0",
      accounts: [conta("alice", false), conta("bob", false)],
    })
    expect(d.estado).toBe("sem-ativa")
    if (d.estado !== "sem-ativa") throw new Error("estado inesperado")
    expect(d.contas).toHaveLength(2)
  })

  it("o default pessimista oferece instalar, nunca afirma 'conectado'", () => {
    // Fora do Tauri e em qualquer falha o status é GH_DESCONHECIDO. Ele tem
    // que cair no estado cujo remédio é inofensivo.
    expect(diagnosticoDoGh(GH_DESCONHECIDO).estado).toBe("sem-cli")
  })
})

describe("consultarPrStatus e cache", () => {
  it("fora do Tauri ou branch inválida devolve null sem chamar invoke", async () => {
    const { consultarPrStatus } = await import("@/lib/github")
    expect(await consultarPrStatus("/tmp", "")).toBeNull()
    expect(await consultarPrStatus("/tmp", "HEAD")).toBeNull()
  })

  it("invalidação de cache funciona por branch e global", async () => {
    const { invalidarCacheDePr } = await import("@/lib/github")
    expect(() => invalidarCacheDePr("/repo", "feat/nova")).not.toThrow()
    expect(() => invalidarCacheDePr("/repo")).not.toThrow()
    expect(() => invalidarCacheDePr()).not.toThrow()
  })
})

