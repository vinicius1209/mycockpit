import { describe, expect, it } from "vitest"
import {
  commandForChannel,
  crossChannelNote,
  latestLabel,
  toProbeMap,
  updateAvailable,
  type DetectedTool,
} from "@/lib/detect"

function p(version: string | null, latest: string | null) {
  return { version, latest }
}

/** O cenário do incidente do sucesso falso: binário homebrew v2.1.212 (teto
 *  do tap 2.1.212), npm já em 2.1.220 — o botão "Atualizar" prometia o
 *  impossível e o brew "already installed" virava "atualizado". */
const claudeBrew = {
  version: "2.1.212",
  latest: "2.1.212",
  latestChannel: "homebrew",
  altLatest: "2.1.220",
  altChannel: "npm",
}

describe("updateAvailable", () => {
  it("acusa update quando latest é maior", () => {
    expect(updateAvailable(p("2.1.209", "2.1.300"))).toBe(true)
    expect(updateAvailable(p("2.1.209", "2.2.0"))).toBe(true)
    expect(updateAvailable(p("2.1.209", "3.0.0"))).toBe(true)
  })

  it("compara por segmentos NUMÉRICOS, não lexicográfico", () => {
    // "9" < "10" numericamente (lexicográfico diria o contrário)
    expect(updateAvailable(p("2.9.0", "2.10.0"))).toBe(true)
    expect(updateAvailable(p("2.10.0", "2.9.0"))).toBe(false)
  })

  it("igual ou instalada mais nova → false", () => {
    expect(updateAvailable(p("2.1.209", "2.1.209"))).toBe(false)
    expect(updateAvailable(p("2.2.0", "2.1.209"))).toBe(false)
  })

  it("segmento ausente conta como 0", () => {
    expect(updateAvailable(p("2.1", "2.1.1"))).toBe(true)
    expect(updateAvailable(p("2.1.0", "2.1"))).toBe(false)
  })

  it("null/indisponível → false (nunca acusa sem certeza)", () => {
    expect(updateAvailable(p(null, "2.1.300"))).toBe(false)
    expect(updateAvailable(p("2.1.209", null))).toBe(false)
    expect(updateAvailable(p(null, null))).toBe(false)
  })

  it("strings sem versão comparável → false", () => {
    expect(updateAvailable(p("abc", "2.1.300"))).toBe(false)
    expect(updateAvailable(p("2.1.209", "latest"))).toBe(false)
  })

  it("tolera prefixo/sufixo em volta da versão", () => {
    expect(updateAvailable(p("v2.1.209", "v2.1.300"))).toBe(true)
    expect(updateAvailable(p("2.1.209 (Claude Code)", "2.1.300"))).toBe(true)
    expect(updateAvailable(p("codex-cli 0.48.0", "0.50.1"))).toBe(true)
  })

  it("POR CANAL: canal satisfeito não acusa update, MESMO com outro canal maior", () => {
    // latest agora é do canal do binário; o altLatest (npm 2.1.220) NÃO entra
    // na conta — o botão some quando o canal está no teto.
    expect(updateAvailable(claudeBrew)).toBe(false)
  })

  it("POR CANAL: canal com versão maior é update de verdade", () => {
    expect(updateAvailable({ version: "2.1.212", latest: "2.1.220" })).toBe(true)
  })
})

describe("latestLabel (rótulo da última por canal)", () => {
  it("rotula o canal: 'última v2.1.212 (homebrew)'", () => {
    expect(latestLabel(claudeBrew)).toBe("última v2.1.212 (homebrew)")
  })

  it("sem canal conhecido, só a versão", () => {
    expect(latestLabel({ latest: "2.1.220", latestChannel: null })).toBe(
      "última v2.1.220",
    )
  })

  it("sem latest, sem rótulo", () => {
    expect(latestLabel({ latest: null, latestChannel: "npm" })).toBeNull()
  })
})

describe("crossChannelNote (canal cruzado, só informação)", () => {
  it("outro canal maior: linha na cara, sem botão", () => {
    expect(crossChannelNote(claudeBrew)).toBe(
      "o canal npm tem v2.1.220; este binário é homebrew (teto v2.1.212)",
    )
  })

  it("outro canal igual ou menor: nada a dizer", () => {
    expect(crossChannelNote({ ...claudeBrew, altLatest: "2.1.212" })).toBeNull()
    expect(crossChannelNote({ ...claudeBrew, altLatest: "2.1.100" })).toBeNull()
  })

  it("faltando dado de algum lado: nada a dizer (nunca inventa)", () => {
    expect(crossChannelNote({ ...claudeBrew, altLatest: null })).toBeNull()
    expect(crossChannelNote({ ...claudeBrew, altChannel: null })).toBeNull()
    expect(crossChannelNote({ ...claudeBrew, latest: null })).toBeNull()
    expect(crossChannelNote({ ...claudeBrew, latestChannel: null })).toBeNull()
  })
})

describe("toProbeMap", () => {
  it("carrega latest pro snapshot (e tolera Rust antigo sem o campo)", () => {
    const tools = [
      {
        id: "claude-code",
        installed: true,
        version: "2.1.209",
        auth: "ok",
        detail: null,
        latest: "2.1.300",
        latestChannel: "npm",
        altLatest: "2.1.212",
        altChannel: "homebrew",
      },
      // Rust antigo (sem `latest` no payload) → null, nunca undefined
      {
        id: "codex",
        installed: true,
        version: "0.48.0",
        auth: "ok",
        detail: null,
      } as unknown,
    ] as DetectedTool[]
    const map = toProbeMap(tools, 123)
    expect(map["claude-code"].latest).toBe("2.1.300")
    expect(map["claude-code"].checkedAt).toBe(123)
    // campos de canal viajam pro snapshot (a UI rotula e cruza canais deles).
    expect(map["claude-code"].latestChannel).toBe("npm")
    expect(map["claude-code"].altLatest).toBe("2.1.212")
    expect(map["claude-code"].altChannel).toBe("homebrew")
    expect(map["codex"].latest).toBeNull()
    expect(map["codex"].latestChannel).toBeNull()
    expect(map["codex"].altLatest).toBeNull()
  })
})

describe("commandForChannel — comando de update do CANAL detectado (G3.2)", () => {
  it("claude-code: npm e homebrew têm comandos distintos (o cask é claude-code)", () => {
    expect(commandForChannel("claude-code", "npm")).toBe(
      "npm i -g @anthropic-ai/claude-code@latest",
    )
    expect(commandForChannel("claude-code", "homebrew")).toBe(
      "brew upgrade claude-code",
    )
  })

  it("codex: cobre os dois canais reais de distribuição", () => {
    expect(commandForChannel("codex", "homebrew")).toBe("brew upgrade codex")
    expect(commandForChannel("codex", "npm")).toBe("npm i -g @openai/codex@latest")
  })

  it("canal desconhecido/ausente → null (o caller usa a copy neutra)", () => {
    expect(commandForChannel("claude-code", "cargo")).toBeNull()
    expect(commandForChannel("claude-code", null)).toBeNull()
    expect(commandForChannel("claude-code", undefined)).toBeNull()
  })

  it("agent sem comando conhecido (agy) → null em qualquer canal", () => {
    expect(commandForChannel("agy", "npm")).toBeNull()
    expect(commandForChannel("agy", "homebrew")).toBeNull()
  })
})
