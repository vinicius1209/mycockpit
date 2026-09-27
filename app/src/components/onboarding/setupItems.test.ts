import { describe, expect, it, vi } from "vitest"
import {
  buildItems,
  dismissActionLabel,
  guideProgress,
  guideView,
  isComplete,
  ringDash,
  shouldShowGuide,
  stateFromProbe,
  type GuideCapabilities,
} from "./setupItems"
import { agentProbe, meterProbe, withTimeout } from "./setupProbes"
import type { AgentProbe } from "@/lib/detect"

const TUDO: GuideCapabilities = { meter: true, hooks: true, companion: true }
const NADA: GuideCapabilities = { meter: false, hooks: false, companion: false }

function probe(installed: boolean): AgentProbe {
  return {
    installed,
    version: null,
    auth: "unknown",
    detail: null,
    latest: null,
    latestChannel: null,
    altLatest: null,
    altChannel: null,
    checkedAt: 0,
  }
}

describe("estado de um item", () => {
  it("só marca com probe que voltou dizendo que sim", () => {
    expect(stateFromProbe(true)).toBe("done")
    expect(stateFromProbe(false)).toBe("todo")
  })

  it("leitura que não voltou é não sei, nunca feito", () => {
    expect(stateFromProbe(null)).toBe("unknown")
    expect(stateFromProbe(undefined)).toBe("unknown")
  })
})

describe("lista de itens", () => {
  it("capacidade que esta máquina não tem some da lista inteira", () => {
    const items = buildItems(NADA, {})
    expect(items.map((i) => i.id)).toEqual(["agent", "project"])
  })

  it("capacidade presente entra na lista", () => {
    const items = buildItems(TUDO, {})
    expect(items.map((i) => i.id)).toEqual([
      "agent",
      "project",
      "meter",
      "hooks",
      "companion",
    ])
  })

  it("cada item aponta pra onde ele se resolve", () => {
    const items = buildItems(TUDO, {})
    expect(items.find((i) => i.id === "project")?.target).toEqual({
      kind: "add-project",
    })
    // Desde a ADR-268 os hooks moram na página do motor: o primeiro do
    // registry que os tem.
    expect(items.find((i) => i.id === "hooks")?.target).toEqual({
      kind: "settings",
      section: "motor:claude-code",
    })
  })

  it("nomeia a ação necessária em vez de confundir visita com conclusão", () => {
    const items = buildItems(TUDO, {})
    expect(items.find((i) => i.id === "meter")?.label).toBe(
      "Mostrar a janela de uso na barra",
    )
    expect(items.find((i) => i.id === "hooks")?.label).toBe(
      "Instalar hooks para enxergar sessões do terminal",
    )
  })
})

describe("saída do guia", () => {
  it("assume a decisão quando só restam capacidades opcionais", () => {
    const items = buildItems(TUDO, {
      agent: true,
      project: true,
      meter: true,
      hooks: false,
      companion: false,
    })
    expect(dismissActionLabel(items)).toBe("Concluir sem os opcionais")
  })

  it("continua descrevendo esconder quando falta configuração essencial", () => {
    const items = buildItems(NADA, { agent: true, project: false })
    expect(dismissActionLabel(items)).toBe("Esconder da barra lateral")
  })
})

describe("progresso e conclusão", () => {
  it("conta só o que o probe confirmou", () => {
    const items = buildItems(NADA, { agent: true, project: false })
    expect(guideProgress(items)).toEqual({ done: 1, total: 2 })
  })

  it("não sei NÃO conta como feito", () => {
    const items = buildItems(NADA, { agent: true, project: null })
    expect(guideProgress(items)).toEqual({ done: 1, total: 2 })
    expect(isComplete(items)).toBe(false)
  })

  it("tudo marcado é completo", () => {
    const items = buildItems(NADA, { agent: true, project: true })
    expect(isComplete(items)).toBe(true)
  })

  it("máquina sem capacidade nenhuma listada não fica com guia órfão", () => {
    expect(isComplete([])).toBe(true)
  })
})

describe("visibilidade do guia", () => {
  it("aparece enquanto pronto, incompleto e não dispensado", () => {
    expect(
      shouldShowGuide({ ready: true, complete: false, dismissed: false }),
    ).toBe(true)
  })

  it("some sozinho ao completar, sem precisar de dispensa", () => {
    expect(
      shouldShowGuide({ ready: true, complete: true, dismissed: false }),
    ).toBe(false)
  })

  it("dispensado não volta", () => {
    expect(
      shouldShowGuide({ ready: true, complete: false, dismissed: true }),
    ).toBe(false)
  })

  it("antes de assentar não aparece (nada de contagem piscando)", () => {
    expect(
      shouldShowGuide({ ready: false, complete: false, dismissed: false }),
    ).toBe(false)
  })

  it("leitura travada mantém o guia VISÍVEL, não o esconde pra sempre", () => {
    // probes voltaram, mas um deles como "não sei" ⇒ incompleto ⇒ visível
    const items = buildItems(TUDO, {
      agent: true,
      project: true,
      meter: true,
      hooks: null,
      companion: true,
    })
    expect(
      shouldShowGuide({
        ready: true,
        complete: isComplete(items),
        dismissed: false,
      }),
    ).toBe(true)
  })
})

describe("decisão de exibição (guideView)", () => {
  const base = {
    caps: TUDO,
    ready: true,
    dismissed: false,
    onboarded: true,
  }
  const TUDO_FEITO = {
    agent: true,
    project: true,
    meter: true,
    hooks: true,
    companion: true,
  }

  it("pronto e incompleto devolve a contagem", () => {
    const view = guideView({ ...base, probes: { ...TUDO_FEITO, hooks: false } })
    expect(view).not.toBeNull()
    expect(view).toMatchObject({ done: 4, total: 5 })
  })

  it("COMPLETOU ⇒ null (a linha some sozinha, não congela na contagem velha)", () => {
    expect(guideView({ ...base, probes: TUDO_FEITO })).toBeNull()
  })

  it("o item que faltava sendo marcado tira a linha da tela", () => {
    // exatamente o roteiro do incidente: 4/5 na tela, usuário completa o 5º.
    const antes = guideView({ ...base, probes: { ...TUDO_FEITO, hooks: false } })
    expect(antes).toMatchObject({ done: 4, total: 5 })
    const depois = guideView({ ...base, probes: TUDO_FEITO })
    expect(depois).toBeNull()
  })

  it("nenhuma leitura assentou ⇒ null (nada de contagem piscando no boot)", () => {
    expect(guideView({ ...base, probes: null })).toBeNull()
  })

  it("app ainda não pronto ⇒ null", () => {
    expect(
      guideView({ ...base, ready: false, probes: { agent: false, project: false } }),
    ).toBeNull()
  })

  it("dispensado ⇒ null mesmo incompleto", () => {
    expect(
      guideView({ ...base, dismissed: true, probes: { ...TUDO_FEITO, hooks: false } }),
    ).toBeNull()
  })

  it("durante o onboarding ⇒ null (o wizard já faz esse trabalho)", () => {
    expect(
      guideView({ ...base, onboarded: false, probes: { ...TUDO_FEITO, hooks: false } }),
    ).toBeNull()
  })

  it("leitura travada mantém a linha (não sei nunca completa o guia)", () => {
    const view = guideView({ ...base, probes: { ...TUDO_FEITO, hooks: null } })
    expect(view).toMatchObject({ done: 4, total: 5 })
  })

  it("máquina sem capacidade opcional completa com 2 itens e some", () => {
    expect(
      guideView({
        ...base,
        caps: NADA,
        probes: { agent: true, project: true },
      }),
    ).toBeNull()
  })
})

describe("anel de progresso", () => {
  it("vazio desenha o traço inteiro, cheio não desenha nada", () => {
    expect(ringDash(0, 4, 100)).toBe(100)
    expect(ringDash(4, 4, 100)).toBe(0)
    expect(ringDash(2, 4, 100)).toBe(50)
  })

  it("total zero não divide por zero", () => {
    expect(Number.isFinite(ringDash(0, 0, 100))).toBe(true)
  })

  it("contagem fora da faixa não vaza do anel", () => {
    expect(ringDash(9, 4, 100)).toBe(0)
    expect(ringDash(-3, 4, 100)).toBe(100)
  })
})

describe("probe de agent", () => {
  it("sem nenhum snapshot a resposta é não sei (o app nunca olhou)", () => {
    expect(agentProbe({})).toBeNull()
  })

  it("snapshot com CLI instalada marca", () => {
    expect(agentProbe({ codex: probe(true) })).toBe(true)
  })

  it("snapshot sem nenhuma instalada não marca", () => {
    expect(agentProbe({ codex: probe(false), agy: probe(false) })).toBe(false)
  })
})

describe("probe da janela de uso", () => {
  it("Claude com leitura OAuth marca mesmo sem instalar statusline", async () => {
    await expect(
      meterProbe({ "claude-code": probe(true) }),
    ).resolves.toBe(true)
  })
})

describe("teto de tempo do probe", () => {
  it("leitura que volta a tempo passa o valor", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42)
  })

  it("leitura que falha vira não sei, sem derrubar o guia", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("HOME ausente")), 1000),
    ).resolves.toBeNull()
  })

  it("leitura pendurada estoura o teto e vira não sei", async () => {
    vi.useFakeTimers()
    try {
      const pendurada = new Promise<number>(() => {})
      const p = withTimeout(pendurada, 15_000)
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(p).resolves.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
