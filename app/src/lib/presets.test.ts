// Sprint 3 · E2 — Agent Presets: digest canônico estável, bloco de persona só
// no 1º turno, preflight FAIL-CLOSED de skills e verificação de drift no
// resume/transplant. DB (getPreset) e inventário (readProjectCommands)
// mockados; o núcleo puro roda de verdade (sha256 via crypto.subtle).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentPreset } from "@/lib/db"

const h = vi.hoisted(() => ({
  preset: null as unknown,
  commands: [] as { name: string }[],
  getPresetThrows: false,
  commandsThrow: false,
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  getPreset: vi.fn(async () => {
    if (h.getPresetThrows) throw new Error("db indisponível")
    return h.preset
  }),
}))
vi.mock("@/lib/sources", () => ({
  readProjectCommands: vi.fn(async () => {
    if (h.commandsThrow) throw new Error("invoke falhou")
    return h.commands
  }),
}))

import { toast } from "sonner"
import { getPreset } from "@/lib/db"
import { readProjectCommands } from "@/lib/sources"
import {
  _resetPresetDriftWarnings,
  buildPersonaBlock,
  hasAssistantReply,
  parseSkillsText,
  personaHandoffBlock,
  preflightPreset,
  presetDigest,
  presetDriftVerdict,
  resolveFirstTurnPersona,
  shortDigest,
  shouldInjectPersona,
  warnPresetDrift,
} from "./presets"

function preset(patch: Partial<AgentPreset> = {}): AgentPreset {
  return {
    id: "pr1",
    name: "UI Engineer",
    personalityMd: "# UI Engineer\nCuida da interface com rigor.",
    skills: ["revisar-pr", "testes"],
    policy: "nunca commita sem pedir",
    backend: "codex",
    model: "gpt-x",
    effort: "high",
    digest: "d-gravado",
    version: 2,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetPresetDriftWarnings()
  h.preset = preset()
  h.commands = [{ name: "revisar-pr" }, { name: "testes" }]
  h.getPresetThrows = false
  h.commandsThrow = false
})

// ── digest canônico ─────────────────────────────────────────────────────────

describe("presetDigest — estável e determinístico", () => {
  const base = {
    personalityMd: "persona",
    skills: ["a", "b"],
    policy: "p",
    backend: "codex",
    model: "m",
    effort: "e",
  }

  it("mesmo input produz o mesmo hash (hex sha256 minúsculo)", async () => {
    const d1 = await presetDigest(base)
    const d2 = await presetDigest({ ...base })
    expect(d1).toBe(d2)
    expect(d1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("a ORDEM das skills não muda o hash (skills são conjunto ordenado)", async () => {
    const d1 = await presetDigest({ ...base, skills: ["a", "b"] })
    const d2 = await presetDigest({ ...base, skills: ["b", "a"] })
    expect(d1).toBe(d2)
  })

  it("qualquer campo mudado muda o hash", async () => {
    const original = await presetDigest(base)
    const variants = [
      { ...base, personalityMd: "outra" },
      { ...base, skills: ["a"] },
      { ...base, policy: "q" },
      { ...base, policy: null },
      { ...base, backend: "claude-code" },
      { ...base, model: "n" },
      { ...base, model: null },
      { ...base, effort: null },
    ]
    for (const v of variants) {
      expect(await presetDigest(v)).not.toBe(original)
    }
  })

  it("shortDigest devolve os 8 primeiros hex (preview da UI)", async () => {
    const d = await presetDigest(base)
    expect(shortDigest(d)).toBe(d.slice(0, 8))
    expect(shortDigest(d)).toHaveLength(8)
  })
})

describe("parseSkillsText (campo das Settings)", () => {
  it("aceita vírgula ou linha, tolera a barra e deduplica", () => {
    expect(parseSkillsText("revisar-pr, /testes\n testes \n\n/deploy")).toEqual([
      "revisar-pr",
      "testes",
      "deploy",
    ])
    expect(parseSkillsText("")).toEqual([])
  })
})

// ── bloco de persona + decisão de injeção ───────────────────────────────────

describe("buildPersonaBlock", () => {
  it("monta o bloco pt-BR com nome, personalidade, política e skills", () => {
    const block = buildPersonaBlock(preset())
    expect(block).toContain('<persona name="UI Engineer">')
    expect(block).toContain("Cuida da interface com rigor.")
    expect(block).toContain("Política de atuação: nunca commita sem pedir")
    expect(block).toContain("/revisar-pr, /testes")
    expect(block).toContain("</persona>")
  })

  it("sem política e sem skills o bloco não inventa as seções", () => {
    const block = buildPersonaBlock(preset({ policy: null, skills: [] }))
    expect(block).not.toContain("Política de atuação")
    expect(block).not.toContain("Skills deste projeto")
  })
})

describe("hasAssistantReply — o prompt do 1º turno chegou?", () => {
  it("user/error/notice sozinhos NÃO contam como resposta", () => {
    expect(hasAssistantReply([])).toBe(false)
    expect(
      hasAssistantReply([{ kind: "user" }, { kind: "error" }, { kind: "notice" }]),
    ).toBe(false)
  })

  it("text, tool ou result contam como resposta do assistant", () => {
    expect(hasAssistantReply([{ kind: "user" }, { kind: "text" }])).toBe(true)
    expect(hasAssistantReply([{ kind: "user" }, { kind: "tool" }])).toBe(true)
    expect(hasAssistantReply([{ kind: "user" }, { kind: "result" }])).toBe(true)
  })
})

describe("shouldInjectPersona — 1º turno (e o 1º run que morreu, D1)", () => {
  it("injeta quando a conversa está destravada E tem preset", () => {
    expect(shouldInjectPersona(false, "pr1", false)).toBe(true)
  })

  it("conversa travada COM resposta de assistant nunca re-injeta", () => {
    expect(shouldInjectPersona(true, "pr1", true)).toBe(false)
  })

  it("D1: travada mas SEM resposta (1º run morreu no spawn) re-injeta", () => {
    expect(shouldInjectPersona(true, "pr1", false)).toBe(true)
  })

  it("sem preset não há o que injetar (camada crua)", () => {
    expect(shouldInjectPersona(false, null, false)).toBe(false)
    expect(shouldInjectPersona(false, undefined, false)).toBe(false)
    expect(shouldInjectPersona(true, null, false)).toBe(false)
  })
})

// ── preflight fail-closed ───────────────────────────────────────────────────

describe("preflightPreset — fail-closed", () => {
  it("passa quando personality existe e toda skill está no inventário", () => {
    expect(
      preflightPreset(preset(), ["revisar-pr", "testes", "extra"]),
    ).toEqual({ ok: true })
  })

  it("skill faltante bloqueia e NOMEIA a que falta", () => {
    const r = preflightPreset(preset(), ["revisar-pr"])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain("/testes")
      expect(r.error).not.toContain("/revisar-pr")
      expect(r.error).toContain("abortado")
    }
  })

  it("personality vazia bloqueia (persona meia-boca não entra)", () => {
    const r = preflightPreset(preset({ personalityMd: "   " }), ["revisar-pr", "testes"])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("sem personalidade")
  })
})

// ── veredito de drift ───────────────────────────────────────────────────────

describe("presetDriftVerdict", () => {
  it("digest igual = ok; diferente = drift; preset sumiu = deleted", () => {
    expect(presetDriftVerdict("abc", "abc")).toBe("ok")
    expect(presetDriftVerdict("abc", "xyz")).toBe("drift")
    expect(presetDriftVerdict("abc", null)).toBe("deleted")
  })
})

// ── resolução do 1º turno (orquestrador) ────────────────────────────────────

describe("resolveFirstTurnPersona", () => {
  it("conversa travada (com resposta) ou sem preset → none (nem consulta o banco)", async () => {
    expect(
      await resolveFirstTurnPersona({
        locked: true,
        presetId: "pr1",
        hasReply: true,
        projectPath: "/proj",
      }),
    ).toEqual({ status: "none" })
    expect(
      await resolveFirstTurnPersona({
        locked: false,
        presetId: null,
        hasReply: false,
        projectPath: "/proj",
      }),
    ).toEqual({ status: "none" })
    expect(getPreset).not.toHaveBeenCalled()
  })

  it("caminho feliz: bloco + digest recomputado + trio do preset", async () => {
    const r = await resolveFirstTurnPersona({
      locked: false,
      presetId: "pr1",
      hasReply: false,
      projectPath: "/proj",
    })
    expect(r.status).toBe("ready")
    if (r.status === "ready") {
      expect(r.block).toContain('<persona name="UI Engineer">')
      expect(r.presetId).toBe("pr1")
      expect(r.digest).toBe(await presetDigest(preset()))
      expect(r.agent).toBe("codex")
      expect(r.model).toBe("gpt-x")
      expect(r.effort).toBe("high")
    }
  })

  it("D1: travada SEM resposta (1º run morreu no spawn) volta a injetar", async () => {
    const r = await resolveFirstTurnPersona({
      locked: true,
      presetId: "pr1",
      hasReply: false,
      projectPath: "/proj",
    })
    expect(r.status).toBe("ready")
  })

  it("skill fora do inventário do projeto BLOQUEIA (run não inicia)", async () => {
    h.commands = [{ name: "revisar-pr" }] // "testes" não existe
    const r = await resolveFirstTurnPersona({
      locked: false,
      presetId: "pr1",
      hasReply: false,
      projectPath: "/proj",
    })
    expect(r.status).toBe("blocked")
    if (r.status === "blocked") expect(r.error).toContain("/testes")
  })

  it("preset apagado bloqueia com instrução de trocar", async () => {
    h.preset = null
    const r = await resolveFirstTurnPersona({
      locked: false,
      presetId: "pr1",
      hasReply: false,
      projectPath: "/proj",
    })
    expect(r.status).toBe("blocked")
    if (r.status === "blocked") expect(r.error).toContain("não existe mais")
  })

  it("inventário inacessível bloqueia (fail-closed, não best-effort)", async () => {
    h.commandsThrow = true
    const r = await resolveFirstTurnPersona({
      locked: false,
      presetId: "pr1",
      hasReply: false,
      projectPath: "/proj",
    })
    expect(r.status).toBe("blocked")
    expect(readProjectCommands).toHaveBeenCalledWith("/proj")
  })
})

// ── doutrina no transplant (D3) ─────────────────────────────────────────────

describe("personaHandoffBlock — a doutrina viaja no transplant", () => {
  it("conversa carimbada com preset vivo → bloco de persona ATUAL", async () => {
    const block = await personaHandoffBlock("pr1", "digest-carimbado")
    expect(block).toContain('<persona name="UI Engineer">')
  })

  it("preset apagado ou DB fora → null (segue sem bloco, o warn avisa)", async () => {
    h.preset = null
    expect(await personaHandoffBlock("pr1", "digest")).toBeNull()
    h.preset = preset()
    h.getPresetThrows = true
    expect(await personaHandoffBlock("pr1", "digest")).toBeNull()
  })

  it("conversa sem carimbo não tem doutrina a levar", async () => {
    expect(await personaHandoffBlock(null, null)).toBeNull()
    expect(await personaHandoffBlock("pr1", null)).toBeNull()
    expect(getPreset).not.toHaveBeenCalled()
  })
})

// ── drift no resume/transplant ──────────────────────────────────────────────

describe("warnPresetDrift — aviso obrigatório, turno segue", () => {
  it("digest carimbado igual ao atual → ok, sem toast", async () => {
    const stamped = await presetDigest(preset())
    const v = await warnPresetDrift("c1", "pr1", stamped)
    expect(v).toBe("ok")
    expect(toast).not.toHaveBeenCalled()
  })

  it("digest antigo ≠ atual dispara o aviso de persona mudada", async () => {
    const v = await warnPresetDrift("c1", "pr1", "digest-de-quando-começou")
    expect(v).toBe("drift")
    expect(toast).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast).mock.calls[0][0]).toContain('"UI Engineer" mudou')
  })

  it("mesma divergência não re-toasta a cada turno (1 aviso por episódio)", async () => {
    await warnPresetDrift("c1", "pr1", "digest-velho")
    await warnPresetDrift("c1", "pr1", "digest-velho")
    expect(toast).toHaveBeenCalledTimes(1)
    // outra conversa é outro episódio
    await warnPresetDrift("c2", "pr1", "digest-velho")
    expect(toast).toHaveBeenCalledTimes(2)
  })

  it("preset apagado com conversa apontando → aviso equivalente", async () => {
    h.preset = null
    const v = await warnPresetDrift("c1", "pr1", "digest-velho")
    expect(v).toBe("deleted")
    expect(vi.mocked(toast).mock.calls[0][0]).toContain("apagado")
  })

  it("sem carimbo (preset escolhido mas nunca rodou) não verifica nada", async () => {
    expect(await warnPresetDrift("c1", "pr1", null)).toBeNull()
    expect(await warnPresetDrift("c1", null, "x")).toBeNull()
    expect(getPreset).not.toHaveBeenCalled()
  })
})
