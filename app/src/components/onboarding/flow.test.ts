import { describe, expect, it } from "vitest"
import {
  FLOW_VERSION,
  createCloseLatch,
  isLastStep,
  notifyMessage,
  notifyStateFromPath,
  parseRecord,
  partitionAgents,
  preselectAgent,
  resolveStartIndex,
  shouldAdvance,
  stepCounter,
  themeAfterExit,
  visibleSteps,
  type OnboardingRecord,
} from "./flow"
import { AGENTS } from "@/lib/agents"
import type { AgentProbe } from "@/lib/detect"

function probe(p: Partial<AgentProbe>): AgentProbe {
  return {
    installed: true,
    version: "1.0.0",
    auth: "ok",
    detail: null,
    latest: null,
    latestChannel: null,
    altLatest: null,
    altChannel: null,
    checkedAt: 0,
    ...p,
  }
}

describe("sequência de passos", () => {
  it("máquina que notifica vê os três passos", () => {
    expect(visibleSteps({ canNotify: true })).toEqual([
      "agents",
      "theme",
      "notifications",
    ])
  })

  it("passo condicional SOME da sequência, não vira bolinha morta", () => {
    const steps = visibleSteps({ canNotify: false })
    expect(steps).toEqual(["agents", "theme"])
    expect(steps).not.toContain("notifications")
  })

  it("o contador conta só os visíveis (1 de 2, nunca 1 de 3 com um pulado)", () => {
    const semNotificacao = visibleSteps({ canNotify: false })
    expect(stepCounter(semNotificacao, 0)).toEqual({ position: 1, total: 2 })
    expect(stepCounter(semNotificacao, 1)).toEqual({ position: 2, total: 2 })

    const completo = visibleSteps({ canNotify: true })
    expect(stepCounter(completo, 0)).toEqual({ position: 1, total: 3 })
    expect(stepCounter(completo, 2)).toEqual({ position: 3, total: 3 })
  })

  it("índice fora da faixa é clampado (nunca 0 de 3 nem 4 de 3)", () => {
    const steps = visibleSteps({ canNotify: true })
    expect(stepCounter(steps, -5)).toEqual({ position: 1, total: 3 })
    expect(stepCounter(steps, 99)).toEqual({ position: 3, total: 3 })
  })

  it("o último passo depende de quem sobrou, não do total declarado", () => {
    const semNotificacao = visibleSteps({ canNotify: false })
    // tema é o último quando notificações some
    expect(isLastStep(semNotificacao, 1)).toBe(true)
    const completo = visibleSteps({ canNotify: true })
    expect(isLastStep(completo, 1)).toBe(false)
    expect(isLastStep(completo, 2)).toBe(true)
  })
})

describe("resolução de versão de fluxo", () => {
  const rec = (v: number, last: number): OnboardingRecord => ({
    flowVersion: v,
    lastCompletedStep: last,
  })

  it("sem registro começa do zero", () => {
    expect(resolveStartIndex(null, 3)).toBe(0)
    expect(resolveStartIndex(undefined, 3)).toBe(0)
  })

  it("registro da versão atual retoma no passo seguinte ao concluído", () => {
    expect(resolveStartIndex(rec(FLOW_VERSION, -1), 3)).toBe(0)
    expect(resolveStartIndex(rec(FLOW_VERSION, 0), 3)).toBe(1)
    expect(resolveStartIndex(rec(FLOW_VERSION, 1), 3)).toBe(2)
  })

  it("registro de OUTRA versão de fluxo volta pro começo", () => {
    expect(resolveStartIndex(rec(FLOW_VERSION + 1, 2), 3)).toBe(0)
    expect(resolveStartIndex(rec(FLOW_VERSION - 1, 2), 3)).toBe(0)
  })

  it("fluxo que encolheu não deixa o usuário fora da faixa", () => {
    // gravou tendo concluído o 3º passo; hoje só há 2 visíveis
    expect(resolveStartIndex(rec(FLOW_VERSION, 2), 2)).toBe(1)
  })

  it("registro fora do shape é descartado (começa do zero, nunca pela metade)", () => {
    expect(parseRecord(null)).toBeNull()
    expect(parseRecord("2")).toBeNull()
    expect(parseRecord({ flowVersion: 1 })).toBeNull()
    expect(parseRecord({ flowVersion: "1", lastCompletedStep: 0 })).toBeNull()
    expect(parseRecord({ flowVersion: NaN, lastCompletedStep: 0 })).toBeNull()
    expect(parseRecord({ flowVersion: 1, lastCompletedStep: 0 })).toEqual({
      flowVersion: 1,
      lastCompletedStep: 0,
    })
  })
})

describe("latch de fechamento", () => {
  it("fecha exatamente uma vez", () => {
    const latch = createCloseLatch()
    expect(latch.attempt()).toBe(true)
    expect(latch.attempt()).toBe(false)
    expect(latch.attempt()).toBe(false)
    expect(latch.isClosed()).toBe(true)
  })

  it("destravar permite nova tentativa (o caso do persist que falhou)", () => {
    const latch = createCloseLatch()
    expect(latch.attempt()).toBe(true)
    latch.release()
    expect(latch.isClosed()).toBe(false)
    expect(latch.attempt()).toBe(true)
  })
})

describe("regra do tema", () => {
  it("pular reverte pro tema de entrada (quem pulou não escolheu)", () => {
    expect(themeAfterExit("skip", "dark", "light")).toBe("dark")
    expect(themeAfterExit("skip", "light", "dark")).toBe("light")
  })

  it("avançar confirma a escolha vista no preview", () => {
    expect(themeAfterExit("advance", "dark", "light")).toBe("light")
  })

  it("voltar também confirma (o preview foi visto e aceito)", () => {
    expect(themeAfterExit("back", "dark", "light")).toBe("light")
  })

  it("pular sem ter mexido é inócuo", () => {
    expect(themeAfterExit("skip", "dark", "dark")).toBe("dark")
  })
})

describe("atalho de avanço", () => {
  it("Cmd+Enter e Ctrl+Enter avançam", () => {
    expect(shouldAdvance({ key: "Enter", metaKey: true })).toBe(true)
    expect(shouldAdvance({ key: "Enter", ctrlKey: true })).toBe(true)
  })

  it("Enter puro NÃO avança (o input é dono do Enter)", () => {
    expect(shouldAdvance({ key: "Enter" })).toBe(false)
    expect(shouldAdvance({ key: "Enter", metaKey: false, ctrlKey: false })).toBe(
      false,
    )
  })

  it("outra tecla com Cmd não avança", () => {
    expect(shouldAdvance({ key: "k", metaKey: true })).toBe(false)
    expect(shouldAdvance({ key: "Escape", metaKey: true })).toBe(false)
  })

  it("campo editável em foco fica com o atalho inteiro (nem Cmd+Enter)", () => {
    expect(
      shouldAdvance({ key: "Enter", metaKey: true, editableTarget: true }),
    ).toBe(false)
    expect(shouldAdvance({ key: "Enter", editableTarget: true })).toBe(false)
  })
})

describe("passo dos agentes", () => {
  it("detectado vai pro destaque, o resto pro colapsado", () => {
    const { found, others } = partitionAgents(AGENTS, {
      "claude-code": probe({ installed: true }),
      codex: probe({ installed: false }),
    })
    expect(found.map((d) => d.id)).toEqual(["claude-code"])
    expect(others.map((d) => d.id)).toContain("codex")
    expect(others.map((d) => d.id)).toContain("agy")
  })

  it("agent não integrado não entra em lista nenhuma", () => {
    const { found, others } = partitionAgents(AGENTS, {
      opencode: probe({ installed: true }),
    })
    expect(found.map((d) => d.id)).not.toContain("opencode")
    expect(others.map((d) => d.id)).not.toContain("opencode")
  })

  it("sem probe nenhum, ninguém é destaque (destaque exige detecção)", () => {
    const { found, others } = partitionAgents(AGENTS, {})
    expect(found).toEqual([])
    expect(others.length).toBeGreaterThan(0)
  })

  it("instalado com auth incerta ainda é detectado (degradação honesta)", () => {
    const { found } = partitionAgents(AGENTS, {
      agy: probe({ installed: true, auth: "unknown" }),
    })
    expect(found.map((d) => d.id)).toEqual(["agy"])
  })

  it("pré-seleciona o primeiro detectado", () => {
    const { found } = partitionAgents(AGENTS, {
      codex: probe({ installed: true }),
      agy: probe({ installed: true }),
    })
    expect(preselectAgent(found, null)).toBe("codex")
  })

  it("nada detectado não escolhe por ninguém", () => {
    expect(preselectAgent([], null)).toBeNull()
    expect(preselectAgent([], "claude-code")).toBeNull()
  })

  it("escolha do usuário não é reescrita pela pré-seleção", () => {
    const { found } = partitionAgents(AGENTS, {
      "claude-code": probe({ installed: true }),
      codex: probe({ installed: true }),
    })
    expect(preselectAgent(found, "codex")).toBe("codex")
  })

  it("escolha que sumiu da máquina cede pro primeiro detectado", () => {
    const { found } = partitionAgents(AGENTS, {
      codex: probe({ installed: true }),
    })
    expect(preselectAgent(found, "claude-code")).toBe("codex")
  })
})

describe("sonda de notificação", () => {
  it("deriva o estado do caminho por onde a notificação saiu", () => {
    expect(notifyStateFromPath("nativo")).toBe("native")
    expect(notifyStateFromPath("osascript")).toBe("fallback")
    expect(notifyStateFromPath("falhou")).toBe("blocked")
    expect(notifyStateFromPath("fora-do-app")).toBe("unavailable")
  })

  it("caminho desconhecido degrada pro pessimista, nunca pra sucesso", () => {
    expect(notifyStateFromPath("caminho-que-ainda-nao-existe")).toBe("blocked")
    expect(notifyStateFromPath("")).toBe("blocked")
  })

  it("antes do teste não afirma nada", () => {
    expect(notifyMessage("unknown")).toBeNull()
    expect(notifyMessage("testing")).toBeNull()
  })

  it("o fallback admite que a notificação chega com outro nome", () => {
    expect(notifyMessage("fallback")).toContain("Script Editor")
  })
})
