// "Precisa de você" (ADR-268). O caso que motivou: o Agy sem o acompanhamento
// não nomeava a conversa no primeiro turno, e nada nas Configurações dizia
// isso; o conserto era um botão no rodapé da página de MCPs (26/09/2026).
import { describe, expect, it } from "vitest"
import { AGENTS } from "@/lib/agents"
import { mcpsPedindoLogin, pendencias } from "./pendencias"
import { precisaDeAtencao } from "./sections"

const instalado = { installed: true, auth: "ok" }
const global = AGENTS.find((a) => a.kind === "agent" && a.available && a.workMcpGlobalEnv)!
const porTurno = AGENTS.find((a) => a.kind === "agent" && a.available && a.workMcp && !a.workMcpGlobalEnv)!

describe("pendencias — o que espera um gesto seu", () => {
  it("nada olhado ainda não é alarme", () => {
    expect(pendencias({})).toEqual([])
  })

  it("motor de cadastro global sem acompanhamento: pendência com o gesto ali mesmo", () => {
    const [p] = pendencias({
      detected: { [global.id]: instalado },
      trabalho: { [global.id]: "absent" },
    })
    expect(p.titulo).toBe(`${global.label} sem acompanhamento`)
    expect(p.detalhe).toContain("título automático")
    expect(p.secao).toBe(`motor:${global.id}`)
    expect(p.gesto).toEqual({ tipo: "conectar-acompanhamento", agent: global.id })
  })

  it("desativado no CLI também pede o gesto; conectado não", () => {
    expect(pendencias({ detected: { [global.id]: instalado }, trabalho: { [global.id]: "disabled" } })).toHaveLength(1)
    expect(pendencias({ detected: { [global.id]: instalado }, trabalho: { [global.id]: "configured" } })).toEqual([])
  })

  it("conflito no CLI é pendência, mas leva à página: o app não sobrescreve a entrada de outro", () => {
    const [p] = pendencias({ detected: { [global.id]: instalado }, trabalho: { [global.id]: "conflict" } })
    expect(p.gesto).toEqual({ tipo: "abrir" })
  })

  it("não verificável (versão velha, CLI mudo) não é pendência: não há gesto a oferecer", () => {
    expect(pendencias({ detected: { [global.id]: instalado }, trabalho: { [global.id]: "unavailable" } })).toEqual([])
  })

  it("motor não instalado nunca vira pendência, nem sem acompanhamento", () => {
    expect(
      pendencias({
        detected: { [global.id]: { installed: false, auth: "missing" } },
        trabalho: { [global.id]: "absent" },
      }),
    ).toEqual([])
  })

  it("motor que recebe o canal por turno não tem cadastro a fazer", () => {
    expect(pendencias({ detected: { [porTurno.id]: instalado }, trabalho: { [porTurno.id]: "absent" } })).toEqual([])
  })

  it("CLI instalada e deslogada vem antes de tudo, e leva à página do motor", () => {
    const lista = pendencias({
      detected: { [global.id]: { installed: true, auth: "missing" } },
      trabalho: { [global.id]: "absent" },
      gh: { installed: true, contas: 0 },
    })
    expect(lista.map((p) => p.id)).toEqual([`login:${global.id}`, `acompanhamento:${global.id}`, "gh"])
  })

  it("MCP ligado pedindo login é pendência do projeto", () => {
    const [p] = pendencias({ mcpPedemLogin: ["notion"] })
    expect(p.titulo).toBe("notion pede login")
    expect(p.secao).toBe("integrations")
  })
})

describe("mcpsPedindoLogin — só o que alguém vai chamar", () => {
  const base = { id: "a", name: "notion", ofereceLogin: true, ligado: true }
  it("ligado, com login pelo app e sem sessão: pede", () => {
    expect(mcpsPedindoLogin([base], new Set())).toEqual(["notion"])
  })
  it("conectado, desligado ou sem login pelo app: não pede", () => {
    expect(mcpsPedindoLogin([base], new Set(["a"]))).toEqual([])
    expect(mcpsPedindoLogin([{ ...base, ligado: false }], new Set())).toEqual([])
    expect(mcpsPedindoLogin([{ ...base, ofereceLogin: false }], new Set())).toEqual([])
  })
})

describe("o ponto do rail lê a mesma lista", () => {
  const fatos = { detected: { [global.id]: instalado }, trabalho: { [global.id]: "absent" as const } }
  it("acende no motor, em 'Todos os motores' e em 'Precisa de você'", () => {
    expect(precisaDeAtencao(`motor:${global.id}`, fatos)).toBe(true)
    expect(precisaDeAtencao("machine", fatos)).toBe(true)
    expect(precisaDeAtencao("pending", fatos)).toBe(true)
  })
  it("não acende onde a pendência não mora", () => {
    expect(precisaDeAtencao("integrations", fatos)).toBe(false)
    expect(precisaDeAtencao(`motor:${porTurno.id}`, fatos)).toBe(false)
  })
})
