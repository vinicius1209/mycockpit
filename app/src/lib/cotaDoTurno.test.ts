import { describe, expect, it } from "vitest"
import { competemPelaMesmaCota, provedorDaCota } from "@/lib/cotaDoTurno"

describe("provedorDaCota", () => {
  it("cada motor clássico tem um dono de cota", () => {
    expect(provedorDaCota("claude-code", null)).toBe("anthropic")
    expect(provedorDaCota("codex", null)).toBe("openai")
    expect(provedorDaCota("agy", null)).toBe("google")
    // Conversa antiga grava agent vazio; a convenção da casa é claude-code.
    expect(provedorDaCota("", null)).toBe("anthropic")
  })

  it("no OpenCode quem paga é o PROVEDOR do modelo, não o motor", () => {
    expect(provedorDaCota("opencode", "openai/gpt-5.6-sol")).toBe("openai")
    expect(provedorDaCota("opencode", "google/gemini-2.5-pro")).toBe("google")
    expect(provedorDaCota("opencode", "opencode-go/kimi-k3")).toBe("opencode-go")
    expect(provedorDaCota("opencode", "openrouter/anthropic/claude-4")).toBe("openrouter")
  })

  it("OpenCode sem modelo escolhido é 'não sei', nunca um chute", () => {
    // Quem decide é o config do próprio OpenCode. Afirmar aqui seria inventar.
    expect(provedorDaCota("opencode", null)).toBeNull()
    expect(provedorDaCota("opencode", "default")).toBeNull()
  })

  it("motor fora do registry é 'não sei'", () => {
    expect(provedorDaCota("aider", "x")).toBeNull()
  })
})

describe("competemPelaMesmaCota", () => {
  it("O CASO QUE MOTIVOU: Codex e opencode/openai são a MESMA assinatura", () => {
    // Trocar de um pro outro num rate limit manda o usuário bater na mesma
    // porta. Sem esta regra, o card de recuperação ofereceria isso.
    expect(
      competemPelaMesmaCota(
        { agent: "codex", model: null },
        { agent: "opencode", model: "openai/gpt-5.6-sol" },
      ),
    ).toBe(true)
  })

  it("o plano Go é cota SEPARADA de todo o resto", () => {
    for (const outro of ["claude-code", "codex", "agy"]) {
      expect(
        competemPelaMesmaCota(
          { agent: outro, model: null },
          { agent: "opencode", model: "opencode-go/kimi-k3" },
        ),
        outro,
      ).toBe(false)
    }
  })

  it("agy e opencode/google dividem a conta do Google", () => {
    expect(
      competemPelaMesmaCota(
        { agent: "agy", model: null },
        { agent: "opencode", model: "google/gemini-2.5-pro" },
      ),
    ).toBe(true)
  })

  it("não saber NÃO vira 'compete': o usuário não fica sem saída", () => {
    // Bloquear por ignorância seria pior que oferecer com ressalva.
    expect(
      competemPelaMesmaCota(
        { agent: "codex", model: null },
        { agent: "opencode", model: null },
      ),
    ).toBe(false)
  })
})

describe("a frase do card de recuperação nomeia a cota", () => {
  it("com o par que estourou, diz QUAL provedor foi", async () => {
    const { recoveryMessage } = await import("@/lib/cotaDoTurno")
    const msg = recoveryMessage(
      { ok: false, items: [{ kind: "limit" }], costUsd: 0 } as never,
      { agent: "codex", model: null },
    )
    expect(msg).toContain("openai")
    // A frase precisa dizer POR QUE isso importa, senão vira ruído técnico.
    expect(msg).toMatch(/mesmo provedor|mesma porta/)
  })

  it("sem saber de quem foi, não inventa provedor nenhum", async () => {
    const { recoveryMessage } = await import("@/lib/cotaDoTurno")
    const msg = recoveryMessage(
      { ok: false, items: [{ kind: "limit" }], costUsd: 0 } as never,
    )
    expect(msg).not.toMatch(/A cota que estourou/)
    // …e continua dizendo o que fazer.
    expect(msg).toContain("Escolha outro agent")
  })
})
