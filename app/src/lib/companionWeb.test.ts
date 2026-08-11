// Fundação C1 do Companion Web: o núcleo puro do cliente do celular
// (src-tauri/companion/core.js) importado DIRETO — o arquivo testado é o
// mesmo servido pelo binário (GET /core.js), nada de implementação gêmea.
// O core é UMD: o import por efeito colateral publica o global CompanionCore
// (tipado por src-tauri/companion/core.d.ts).
import { describe, expect, it } from "vitest"
import "../../src-tauri/companion/core.js"

const core = globalThis.CompanionCore

describe("rotas do companion (history API via hash)", () => {
  it("hash vazio, raiz ou lixo cai no briefing sem crashar", () => {
    expect(core.parseRoute("")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#qualquer-coisa")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/desconhecida/x")).toEqual({ screen: "brief" })
    expect(core.parseRoute("#/chat/so-projeto")).toEqual({ screen: "brief" })
  })

  it("fragment de token do pareamento nunca vira rota", () => {
    expect(core.parseRoute("#token=aabbccddeeff0011")).toEqual({
      screen: "brief",
    })
  })

  it("ida e volta tela → hash → tela preserva projeto, agent e conversa", () => {
    const agents: CompanionWebRoute = { screen: "agents", projectId: "p1" }
    expect(core.parseRoute(core.routeHash(agents))).toEqual(agents)

    const mesa: CompanionWebRoute = {
      screen: "chat",
      projectId: "p1",
      agent: "claude-code",
    }
    expect(core.parseRoute(core.routeHash(mesa))).toEqual(mesa)

    const explicita: CompanionWebRoute = {
      screen: "chat",
      projectId: "p2",
      agent: "codex",
      convId: "abc-123",
    }
    expect(core.parseRoute(core.routeHash(explicita))).toEqual(explicita)
  })

  it("segmentos com caracteres especiais sobrevivem ao encode/decode", () => {
    const r: CompanionWebRoute = {
      screen: "agents",
      projectId: "meu projeto/estranho#1",
    }
    const hash = core.routeHash(r)
    expect(hash.startsWith("#/agents/")).toBe(true)
    expect(core.parseRoute(hash)).toEqual(r)
  })

  it("percent-encoding inválido no hash não crasha, usa o segmento cru", () => {
    expect(core.parseRoute("#/agents/%E0%")).toEqual({
      screen: "agents",
      projectId: "%E0%",
    })
  })

  it("rota sem os campos obrigatórios vira a raiz", () => {
    expect(core.routeHash({ screen: "agents" })).toBe("#/")
    expect(core.routeHash({ screen: "chat", projectId: "p1" })).toBe("#/")
    expect(core.routeHash(null)).toBe("#/")
  })
})

describe("visto há (carimbo honesto do snapshot)", () => {
  const now = 1_700_000_000_000
  it("sem timestamp nunca inventa idade", () => {
    expect(core.seenAgo(now, null)).toBe("")
    expect(core.seenAgo(now, undefined)).toBe("")
    expect(core.seenAgo(now, 0)).toBe("")
    expect(core.seenAgo(now, Number.NaN)).toBe("")
  })
  it("menos de um minuto é visto agora", () => {
    expect(core.seenAgo(now, now - 5_000)).toBe("visto agora")
  })
  it("minutos, horas e dias em pt-BR", () => {
    expect(core.seenAgo(now, now - 3 * 60_000)).toBe("visto há 3 min")
    expect(core.seenAgo(now, now - 2 * 3_600_000)).toBe("visto há 2 h")
    expect(core.seenAgo(now, now - 3 * 86_400_000)).toBe("visto há 3 d")
  })
  it("relógio andando pra trás não vira idade negativa", () => {
    expect(core.seenAgo(now, now + 60_000)).toBe("visto agora")
  })
})

describe("máquina de reconexão (backoff com teto)", () => {
  it("backoff dobra a cada tentativa e trava em 15s", () => {
    expect(core.backoffDelay(0)).toBe(1_000)
    expect(core.backoffDelay(1)).toBe(2_000)
    expect(core.backoffDelay(2)).toBe(4_000)
    expect(core.backoffDelay(3)).toBe(8_000)
    expect(core.backoffDelay(4)).toBe(15_000)
    expect(core.backoffDelay(50)).toBe(15_000)
  })

  it("primeira conexão é connecting; queda vira reconnecting com retry", () => {
    let st = core.connReduce(null, "connect")
    expect(st.status).toBe("connecting")
    st = core.connReduce(st, "down")
    expect(st.status).toBe("reconnecting")
    expect(st.attempt).toBe(1)
    expect(st.retryInMs).toBe(1_000)
  })

  it("quedas seguidas crescem o backoff até o teto", () => {
    let st = core.connReduce(null, "connect")
    const delays: (number | null)[] = []
    for (let i = 0; i < 6; i++) {
      st = core.connReduce(st, "down")
      delays.push(st.retryInMs)
      st = core.connReduce(st, "connect")
      expect(st.status).toBe("reconnecting") // retry visível, não silêncio
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000])
  })

  it("abrir zera as tentativas: a próxima queda recomeça do backoff curto", () => {
    let st = core.connReduce(null, "connect")
    st = core.connReduce(st, "down")
    st = core.connReduce(st, "down")
    st = core.connReduce(st, "open")
    expect(st).toEqual({ status: "on", attempt: 0, retryInMs: null })
    st = core.connReduce(st, "down")
    expect(st.retryInMs).toBe(1_000)
  })

  it("evento desconhecido não muda nada (fail-open)", () => {
    const st = core.connReduce(null, "connect")
    expect(core.connReduce(st, "meteoro")).toEqual(st)
  })

  it("rótulos pt-BR por estado", () => {
    expect(core.connLabel({ status: "on", attempt: 0, retryInMs: null })).toBe(
      "conectado",
    )
    expect(
      core.connLabel({ status: "connecting", attempt: 0, retryInMs: null }),
    ).toBe("conectando…")
    expect(
      core.connLabel({ status: "reconnecting", attempt: 2, retryInMs: 2000 }),
    ).toBe("reconectando…")
  })
})
