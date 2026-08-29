import { describe, expect, it } from "vitest"
import {
  STATUS_BAR_KINDS,
  statusBarAccepts,
  statusBuildItem,
  statusCostItem,
  statusProcessosItem,
  statusUpdateItem,
  statusWorktreeItem,
} from "./statusBar"

describe("statusBarAccepts (a fronteira faixa × linha viva)", () => {
  it("aceita só sinal ambiente permanente", () => {
    expect(statusBarAccepts("usage")).toBe(true)
    expect(statusBarAccepts("cost")).toBe(true)
    expect(statusBarAccepts("build")).toBe(true)
    expect(statusBarAccepts("update")).toBe(true)
    expect(statusBarAccepts("worktree")).toBe(true)
    // ADR-118: sessão de motor esquecida na máquina. Irmã do `worktree` — as
    // duas contam RECURSO DEIXADO PARA TRÁS, e nenhuma narra o agora de um
    // turno.
    expect(statusBarAccepts("processos")).toBe(true)
    // O número é tripwire de propósito: mexer nele é assinar embaixo. Cada
    // entrada nova precisa do argumento escrito no módulo, não da conveniência
    // de quem tem um dado sobrando e uma faixa vazia na frente.
    expect(STATUS_BAR_KINDS).toHaveLength(6)
  })

  it("recusa o AGORA do turno: a linha viva não sai do composer", () => {
    expect(statusBarAccepts("liveLine")).toBe(false)
    expect(statusBarAccepts("turn")).toBe(false)
    expect(statusBarAccepts("elapsed")).toBe(false)
    expect(statusBarAccepts("tool")).toBe(false)
    expect(statusBarAccepts("streaming")).toBe(false)
  })

  it("recusa o que PEDE decisão (isso é acionável, e a faixa não age)", () => {
    expect(statusBarAccepts("approval")).toBe(false)
    expect(statusBarAccepts("question")).toBe(false)
  })
})

describe("statusCostItem", () => {
  const cost = (total: number, turns: number, estimated = false) => ({
    total,
    turns,
    estimated,
  })

  it("com um turno só, a zona não desenha nada", () => {
    expect(statusCostItem(cost(0.4, 1), null)).toBeNull()
  })

  it("sem gasto real, a zona não desenha nada (nem US$ 0,00)", () => {
    expect(statusCostItem(cost(0, 5), null)).toBeNull()
  })

  it("com ≥2 turnos e gasto real, entra em cinza quando não há teto", () => {
    const item = statusCostItem(cost(12.5, 4), null)
    expect(item?.kind).toBe("cost")
    expect(item?.text).toBe("US$ 12,50")
    expect(item?.label).toBe("sessão")
    expect(item?.tone).toBe("ok")
  })

  it("custo estimado se anuncia com ~ (não finge medição exata)", () => {
    expect(statusCostItem(cost(0.42, 2, true), null)?.text).toBe("~US$ 0,420")
  })

  it("com teto do usuário, sobe de tom pela régua do §2", () => {
    expect(statusCostItem(cost(5.9, 3), 10)?.tone).toBe("ok")
    expect(statusCostItem(cost(6, 3), 10)?.tone).toBe("warn")
    expect(statusCostItem(cost(8, 3), 10)?.tone).toBe("danger")
  })

  it("o tooltip diz o teto quando existe, e como definir quando não existe", () => {
    expect(statusCostItem(cost(6, 3), 10)?.title).toContain("US$ 10,00")
    expect(statusCostItem(cost(6, 3), null)?.title).toContain("Configurações")
  })
})

describe("statusBuildItem", () => {
  it("mostra a versão curta e guarda a completa no tooltip (nunca trunca)", () => {
    const item = statusBuildItem("0.1.0-test.177")
    expect(item.text).toBe("local · v0.1.0-t177")
    expect(item.title).toContain("0.1.0-test.177")
    expect(item.tone).toBe("ok")
  })

  it("sem versão carimbada fica 'local', nunca um 'v?' inventado", () => {
    const item = statusBuildItem(null)
    expect(item.text).toBe("local")
    expect(item.text).not.toContain("v")
  })
})

describe("statusUpdateItem", () => {
  it("sem job rodando, a zona não desenha nada", () => {
    expect(statusUpdateItem([])).toBeNull()
  })

  it("um job rodando nomeia o agent", () => {
    const item = statusUpdateItem(["Codex"])
    expect(item?.kind).toBe("update")
    expect(item?.text).toBe("atualizando Codex…")
    expect(item?.title).toBe("Em andamento: Codex")
  })

  it("mais de um job rodando vira contagem, com os nomes no tooltip", () => {
    const item = statusUpdateItem(["Codex", "Claude Code"])
    expect(item?.text).toBe("atualizando 2…")
    expect(item?.title).toBe("Em andamento: Codex, Claude Code")
  })
})

describe("statusWorktreeItem", () => {
  it("nada solto, a zona não desenha nada (sem 'ok' nem zero)", () => {
    expect(statusWorktreeItem(0)).toBeNull()
    expect(statusWorktreeItem(-1)).toBeNull()
  })

  it("um solto não vira '1 worktrees'", () => {
    expect(statusWorktreeItem(1)?.text).toBe("1 worktree solto")
  })

  it("vários viram contagem", () => {
    expect(statusWorktreeItem(3)?.text).toBe("3 worktrees soltos")
  })

  it("tom cinza SEMPRE: sobra de worktree não é urgência (§2)", () => {
    expect(statusWorktreeItem(1)?.tone).toBe("ok")
    expect(statusWorktreeItem(99)?.tone).toBe("ok")
  })
})

describe("statusProcessosItem", () => {
  it("sem sessão esquecida, a zona não desenha NADA", () => {
    // Mesma regra do custo abaixo de 2 turnos: nada de "0 processos" nem
    // divisor órfão numa faixa que existe pra ser lida de canto de olho.
    expect(statusProcessosItem({ parados: 0, orfaos: 0 })).toBeNull()
  })

  it("conta paradas e órfãs juntas, e diz das órfãs no tooltip", () => {
    const item = statusProcessosItem({ parados: 2, orfaos: 1 })!
    expect(item.text).toBe("3 sessões paradas")
    expect(item.title).toContain("1 órfã")
  })

  it("o tom NÃO sobe: parado é ambiente, não é falha", () => {
    // Subir de tom aqui seria a faixa pedindo decisão — e ela não pede nada.
    expect(statusProcessosItem({ parados: 9, orfaos: 4 })!.tone).toBe("ok")
  })

  it("singular sem plural forçado", () => {
    expect(statusProcessosItem({ parados: 1, orfaos: 0 })!.text).toBe(
      "1 sessão parada",
    )
  })
})
