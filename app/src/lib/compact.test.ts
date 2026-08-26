// /compactar — decisão por CAPABILITY (nunca por nome), copy honesta e as
// pontas do fluxo: em motor nativo o que viaja É o literal "/compact"; sem a
// capability, renovação de sessão com recap emoldurado (H3); sem sessão/turnos,
// nada dispara (fail-closed no efeito). Fixtures com payloads REAIS (ADR-016):
// a resposta empírica do claude 2.1.220 ("Not enough messages to compact") e a
// copy do Notice de compact_boundary que o adapter emite (adapters.rs).

import { describe, expect, it } from "vitest"
import {
  COMPACT_OFFER_THRESHOLD,
  NATIVE_COMPACT_PROMPT,
  RENEWAL_INSTRUCTION,
  buildRenewalPrompt,
  compactActionHint,
  compactOutcomeNotice,
  offersCompactAction,
  planCompact,
  renewalNotice,
} from "./compact"
import { serializeContext } from "@/lib/fusion"
import { HISTORY_OPEN, HISTORY_NOTE } from "@/lib/trust"
import type { ChatItem } from "@/store/chat"

describe("planCompact — decisão por capability", () => {
  it("motor com nativeCompact + sessão → turno técnico com o literal /compact", () => {
    const plan = planCompact("claude-code", {
      hasExecutorTurn: true,
      sessionId: "d2a1c9e0-sessao-real",
    })
    expect(plan).toEqual({ mode: "native", prompt: "/compact" })
    // a ponta nativa: o /compactar do app VIRA exatamente este texto.
    expect(NATIVE_COMPACT_PROMPT).toBe("/compact")
  })

  it("motor sem nativeCompact mas com sessionResume (codex) → renovação com resumo", () => {
    expect(
      planCompact("codex", {
        hasExecutorTurn: true,
        sessionId: "thread-0199",
      }),
    ).toEqual({ mode: "renew" })
  })

  it("motor sem sessionResume → nada a compactar, com motivo honesto (renovar seria teatro pago)", () => {
    const plan = planCompact("model", {
      hasExecutorTurn: true,
      sessionId: null,
    })
    expect(plan.mode).toBe("none")
    if (plan.mode === "none") {
      expect(plan.reason).toContain("sessão fresca")
    }
  })

  it("conversa sem turnos → nada a compactar (fail-closed no efeito)", () => {
    const plan = planCompact("claude-code", {
      hasExecutorTurn: false,
      sessionId: "d2a1c9e0-sessao-real",
    })
    expect(plan.mode).toBe("none")
  })

  it("motor nativo SEM sessão ativa → nada a compactar (não há alvo pro resume)", () => {
    const plan = planCompact("claude-code", {
      hasExecutorTurn: true,
      sessionId: null,
    })
    expect(plan.mode).toBe("none")
    if (plan.mode === "none") {
      expect(plan.reason).toContain("sessão nativa")
    }
  })

  it("motor desconhecido → nada dispara (capability ausente = false, degradação honesta)", () => {
    expect(
      planCompact("motor-fantasma", {
        hasExecutorTurn: true,
        sessionId: "s1",
      }).mode,
    ).toBe("none")
  })
})

describe("buildRenewalPrompt — recap emoldurado (H3) + doutrina + instrução", () => {
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "implementa o login com magic link" },
    { kind: "text", id: "t1", text: "Implementado em auth.ts; testes verdes." },
  ]

  it("o recap sai DENTRO da moldura H3 e a instrução fixa fecha o prompt", () => {
    const recap = serializeContext(items)
    const prompt = buildRenewalPrompt({ recap })
    expect(prompt).toContain(HISTORY_OPEN)
    expect(prompt).toContain(HISTORY_NOTE)
    expect(prompt).toContain("implementa o login com magic link")
    expect(prompt.endsWith(RENEWAL_INSTRUCTION)).toBe(true)
  })

  it("cascata: identidade → regras → recap → instrução (mesma ordem dos sends)", () => {
    const prompt = buildRenewalPrompt({
      recap: serializeContext(items),
      doctrineBlock: '<doutrina fonte=".mycockpit/instructions.md">regras</doutrina>',
      personaBlock: "<persona>Aline</persona>",
    })
    const persona = prompt.indexOf("<persona>")
    const doutrina = prompt.indexOf("<doutrina")
    const recap = prompt.indexOf(HISTORY_OPEN)
    const instrucao = prompt.indexOf(RENEWAL_INSTRUCTION)
    expect(persona).toBeGreaterThanOrEqual(0)
    expect(persona).toBeLessThan(doutrina)
    expect(doutrina).toBeLessThan(recap)
    expect(recap).toBeLessThan(instrucao)
  })

  it("sem doutrina/persona, o prompt é só recap + instrução (nada de bloco vazio)", () => {
    const prompt = buildRenewalPrompt({ recap: serializeContext(items) })
    expect(prompt.startsWith(HISTORY_OPEN)).toBe(true)
    expect(prompt).not.toContain("<doutrina")
  })
})

describe("copy honesta (pt-BR, sem travessão)", () => {
  it("renewalNotice não promete número que não temos e cita o motor", () => {
    const msg = renewalNotice("codex")
    expect(msg).toContain("Sessão renovada com resumo")
    expect(msg).toContain("não é mensurável")
    expect(msg).toContain("Codex")
    expect(msg).not.toContain("—")
  })

  it("compactActionHint explica o que VAI acontecer conforme o motor", () => {
    expect(compactActionHint("claude-code")).toContain("compacta a própria sessão")
    expect(compactActionHint("codex")).toContain("renova a sessão com um resumo")
    // agy 1.1.13 retoma sessão, então caiu no mesmo caminho do codex:
    // renovação com resumo, não "sessão fresca" (medido 14/08/2026).
    expect(compactActionHint("agy")).toContain("renova a sessão com um resumo")
    expect(compactActionHint("model")).toContain("sessão fresca")
    for (const agent of ["claude-code", "codex", "agy", "model"]) {
      expect(compactActionHint(agent)).not.toContain("—")
    }
  })
})

describe("offersCompactAction — limiar do anel (ADR-015)", () => {
  it("a ação entra a partir de 70% de uso; abaixo é ruído", () => {
    expect(COMPACT_OFFER_THRESHOLD).toBe(0.7)
    expect(offersCompactAction(0.69)).toBe(false)
    expect(offersCompactAction(0.7)).toBe(true)
    expect(offersCompactAction(0.94)).toBe(true)
  })
})

describe("compactOutcomeNotice — meta honesta do turno técnico", () => {
  it("com o marco REAL do stream (Notice de compact_boundary do adapter) afirma a compactação", () => {
    // copy exata que o ClaudeAdapter emite pro subtype compact_boundary
    // (adapters.rs) — é o único sinal verdadeiro de que compactou.
    const added: ChatItem[] = [
      { kind: "user", id: "u", text: "/compactar" },
      {
        kind: "notice",
        id: "n",
        message:
          "Contexto cheio: o Claude Code compactou a conversa — o detalhe antigo virou resumo.",
      },
    ]
    expect(compactOutcomeNotice(added)).toBe("Contexto compactado.")
  })

  it("sem o marco, NADA é afirmado: a resposta real do motor fica no fio como veio", () => {
    // resposta empírica do claude 2.1.220 ao /compact numa sessão curta
    // (04/08/2026): afirmar "Contexto compactado" aqui seria mentira.
    const added: ChatItem[] = [
      { kind: "user", id: "u", text: "/compactar" },
      { kind: "text", id: "t", text: "Not enough messages to compact" },
    ]
    expect(compactOutcomeNotice(added)).toBeNull()
  })
})
