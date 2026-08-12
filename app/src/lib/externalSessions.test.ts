// Sessões externas (hooks-plan H1) — as peças puras: copy de status,
// resolução de projeto pelo cwd, idade do sinal e a chave estável do tray.
// `now` injetável em tudo (regra da casa).

import { beforeEach, describe, expect, it } from "vitest"
import {
  DISPLAY_TTL_MS,
  externalSessionsKey,
  projectForCwd,
  seenAgo,
  sessionPlace,
  statusLabel,
  statusTone,
  useExternalSessions,
  visibleSessions,
  type ExternalSession,
} from "./externalSessions"

function sess(over: Partial<ExternalSession> = {}): ExternalSession {
  return {
    agent: "claude-code",
    sessionId: "s-1",
    cwd: "/Users/v/projetos/mycockpit",
    status: "working",
    lastEvent: "PreToolUse",
    tool: "Bash",
    lastSeen: 1_000,
    startedAt: 0,
    ...over,
  }
}

beforeEach(() => {
  useExternalSessions.setState({ sessions: [] })
})

describe("status de sessão externa vira copy honesta", () => {
  it("trabalhando · esperando você · ociosa", () => {
    expect(statusLabel("working")).toBe("trabalhando")
    expect(statusLabel("waiting")).toBe("esperando você")
    expect(statusLabel("blocked")).toBe("esperando você")
    expect(statusLabel("idle")).toBe("ociosa")
  })

  it("status desconhecido degrada pra ociosa (fail-open no render)", () => {
    expect(statusLabel("outra-coisa" as ExternalSession["status"])).toBe(
      "ociosa",
    )
  })

  it("tons seguem o STYLEGUIDE: azul só no vivo, âmbar só no que pede você", () => {
    expect(statusTone("working")).toBe("running")
    expect(statusTone("waiting")).toBe("attention")
    expect(statusTone("blocked")).toBe("attention")
    expect(statusTone("idle")).toBe("neutral")
  })
})

describe("projeto pelo cwd", () => {
  const projects = [
    { path: "/Users/v/projetos/mycockpit", name: "MyCockpit" },
    { path: "/Users/v/projetos/mycockpit/vendor", name: "Vendor" },
    { path: "/Users/v/projetos/outro", name: "Outro" },
  ]

  it("casa igualdade exata e subpasta (worktree)", () => {
    expect(projectForCwd("/Users/v/projetos/outro", projects)?.name).toBe(
      "Outro",
    )
    expect(
      projectForCwd("/Users/v/projetos/mycockpit/app/src", projects)?.name,
    ).toBe("MyCockpit")
  })

  it("prefixo é por SEGMENTO: /a/b não engole /a/bc", () => {
    expect(projectForCwd("/Users/v/projetos/mycockpit-2", projects)).toBeNull()
  })

  it("projeto aninhado mais específico vence", () => {
    expect(
      projectForCwd("/Users/v/projetos/mycockpit/vendor/x", projects)?.name,
    ).toBe("Vendor")
  })

  it("trailing slash não muda o resultado", () => {
    expect(projectForCwd("/Users/v/projetos/outro/", projects)?.name).toBe(
      "Outro",
    )
  })

  it("cwd fora de qualquer projeto = null (nunca inventa vínculo)", () => {
    expect(projectForCwd("/tmp/aleatorio", projects)).toBeNull()
    expect(projectForCwd("", projects)).toBeNull()
  })

  it("sessionPlace degrada pro basename do cwd", () => {
    expect(sessionPlace(sess(), projects)).toBe("MyCockpit")
    expect(sessionPlace(sess({ cwd: "/tmp/spike-x/" }), projects)).toBe(
      "spike-x",
    )
    expect(sessionPlace(sess({ cwd: "" }), projects)).toBe("pasta desconhecida")
  })
})

describe("visto há X (now injetável)", () => {
  it("agora · segundos · minutos · horas", () => {
    expect(seenAgo(1_000, 3_000)).toBe("agora")
    expect(seenAgo(1_000, 31_000)).toBe("há 30s")
    expect(seenAgo(0, 5 * 60_000)).toBe("há 5 min")
    expect(seenAgo(0, 3 * 3_600_000)).toBe("há 3h")
  })

  it("relógio andando pra trás não vira idade negativa", () => {
    expect(seenAgo(10_000, 5_000)).toBe("agora")
  })
})

describe("visibilidade e chave do tray", () => {
  it("sessão muda há mais de 2h some da exibição (honesto, sem teatro)", () => {
    const fresca = sess({ sessionId: "a", lastSeen: 1_000_000 })
    const velha = sess({ sessionId: "b", lastSeen: 1_000_000 - DISPLAY_TTL_MS })
    expect(visibleSessions([fresca, velha], 1_000_001)).toEqual([fresca])
  })

  it("chave estável: mesma frota = mesma chave, status novo muda a chave", () => {
    const a = sess({ sessionId: "a" })
    const b = sess({ sessionId: "b", agent: "codex" })
    const k1 = externalSessionsKey([a, b])
    expect(externalSessionsKey([b, a])).toBe(k1) // ordem não importa
    expect(externalSessionsKey([{ ...a, status: "idle" }, b])).not.toBe(k1)
  })
})
