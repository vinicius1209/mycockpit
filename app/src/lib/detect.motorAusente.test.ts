import { describe, expect, it } from "vitest"

import { avisoDeMotorAusente, type AgentProbe } from "@/lib/detect"

/** Um probe mínimo: o que importa aqui é `installed`. */
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
    binPath: null,
    checkedAt: 0,
  }
}

describe("aviso de motor ausente", () => {
  it("avisa, com a receita, quando o probe diz que não está instalado", () => {
    const aviso = avisoDeMotorAusente("codex", { codex: probe(false) })
    expect(aviso).toEqual({ comando: "brew install codex", ehLink: false })
  })

  it("não avisa quando está instalado", () => {
    expect(avisoDeMotorAusente("codex", { codex: probe(true) })).toBeNull()
  })

  it("não avisa quando a detecção ainda não rodou", () => {
    // §5 camada 3: aviso que depende de probe só aparece depois da leitura.
    // Sem esta regra o banner apareceria no boot, sumiria um segundo depois, e
    // a UI teria mentido pra quem tem o motor instalado.
    expect(avisoDeMotorAusente("codex", {})).toBeNull()
  })

  it("distingue receita que se COLA de receita que se ABRE", () => {
    const aviso = avisoDeMotorAusente("agy", { agy: probe(false) })
    expect(aviso?.ehLink).toBe(true)
    expect(aviso?.comando).toMatch(/^https:\/\//)
  })

  it("sem receita conhecida devolve comando null, e não um chute", () => {
    // `sst/tap/opencode` viveu no código sendo uma fórmula que não existe. A
    // regra que impede a próxima é esta: ausência de receita é um estado, não
    // um convite pra inventar uma.
    const aviso = avisoDeMotorAusente("motor-inventado", {
      "motor-inventado": probe(false),
    })
    expect(aviso).toEqual({ comando: null, ehLink: false })
  })
})
