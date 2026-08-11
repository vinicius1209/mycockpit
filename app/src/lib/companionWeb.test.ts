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

describe("banner de offline (dado velho carimbado desde o boot)", () => {
  const base: CompanionWebOfflineInput = {
    mock: false,
    token: true,
    screen: "brief",
    conn: "connecting",
    connStatus: "connecting",
    snapStale: false,
  }

  it("boot offline com snapshot restaurado do cache carimba JÁ, antes da primeira queda", () => {
    // Mac desligado sem RST: status ainda é connecting, mas o dado na tela é
    // de ontem — o banner não espera o primeiro timeout de rede.
    expect(core.offlineBanner({ ...base, snapStale: true })).toBe(true)
  })

  it("primeiro load sem dado nenhum não flasha banner durante o handshake", () => {
    expect(core.offlineBanner(base)).toBe(false)
  })

  it("queda real (reconnecting) mostra o banner mesmo sem dado velho", () => {
    expect(
      core.offlineBanner({ ...base, connStatus: "reconnecting" }),
    ).toBe(true)
  })

  it("conectado nunca mostra banner, mesmo logo após restaurar cache", () => {
    expect(
      core.offlineBanner({ ...base, conn: "on", snapStale: true }),
    ).toBe(false)
  })

  it("sem token, em mock ou na tela de pareamento o banner não existe", () => {
    expect(core.offlineBanner({ ...base, token: false, snapStale: true })).toBe(
      false,
    )
    expect(core.offlineBanner({ ...base, mock: true, snapStale: true })).toBe(
      false,
    )
    expect(
      core.offlineBanner({ ...base, screen: "pair", snapStale: true }),
    ).toBe(false)
    expect(core.offlineBanner(null)).toBe(false)
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

// ───────────────────────────────────────────────────────────── C2 — Ações

describe("rota de lançar tarefa (C2)", () => {
  it("ida e volta preserva a tela e o projeto pré-escolhido", () => {
    const semProjeto: CompanionWebRoute = { screen: "launch" }
    expect(core.routeHash(semProjeto)).toBe("#/launch")
    expect(core.parseRoute("#/launch")).toEqual(semProjeto)

    const comProjeto: CompanionWebRoute = { screen: "launch", projectId: "p1" }
    expect(core.parseRoute(core.routeHash(comProjeto))).toEqual(comProjeto)
  })

  it("projeto com caracteres especiais sobrevive ao encode/decode", () => {
    const r: CompanionWebRoute = { screen: "launch", projectId: "meu proj#2" }
    expect(core.parseRoute(core.routeHash(r))).toEqual(r)
  })
})

describe("parar turno com semântica honesta (stopDisposition)", () => {
  it("turno rodando pode parar", () => {
    expect(core.stopDisposition({ finalizing: false })).toEqual({
      can: true,
      label: "Parar",
      reason: null,
    })
  })

  it("turno FINALIZANDO não é interrompível, com o motivo na cara", () => {
    const d = core.stopDisposition({ finalizing: true })
    expect(d.can).toBe(false)
    expect(d.reason).toContain("não dá mais para interromper")
  })

  it("item torto ou ausente é fail-open: deixa parar (o Mac é a verdade final)", () => {
    expect(core.stopDisposition(null).can).toBe(true)
    expect(core.stopDisposition(undefined).can).toBe(true)
  })
})

describe("id de ação idempotente (makeActionId)", () => {
  it("gera 32 hex e é determinístico dado o rand injetado", () => {
    const a = core.makeActionId(() => 0.5)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(core.makeActionId(() => 0.5)).toBe(a)
    // rand diferente → id diferente (um id POR gesto)
    expect(core.makeActionId(() => 0.1)).not.toBe(a)
  })

  it("rand torto nunca produz char inválido", () => {
    expect(core.makeActionId(() => Number.NaN)).toMatch(/^[0-9a-f]{32}$/)
    expect(core.makeActionId(() => 99)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe("janela honesta do retry de lançamento (launchRetryDisposition)", () => {
  const now = 1_700_000_000_000

  it("dentro da janela: reusa o id (retry não duplica de verdade)", () => {
    expect(core.launchRetryDisposition(now, now - 30_000)).toEqual({
      reuse: true,
      warn: null,
    })
    // borda: exatamente no limite ainda reusa
    expect(
      core.launchRetryDisposition(now, now - core.ACTION_REUSE_TTL_MS).reuse,
    ).toBe(true)
  })

  it("janela expirada: id morre e a copy avisa que relançar pode duplicar", () => {
    const d = core.launchRetryDisposition(
      now,
      now - core.ACTION_REUSE_TTL_MS - 1_000,
    )
    expect(d.reuse).toBe(false)
    expect(d.warn).toContain("pode duplicar")
  })

  it("sem gesto anterior: id novo sem alarde (primeiro envio não é retry)", () => {
    expect(core.launchRetryDisposition(now, null)).toEqual({
      reuse: false,
      warn: null,
    })
    expect(core.launchRetryDisposition(now, Number.NaN).warn).toBeNull()
  })

  it("a margem do cliente fica ABAIXO do TTL do servidor (5 min): relógio nunca joga a favor", () => {
    expect(core.ACTION_REUSE_TTL_MS).toBeLessThan(5 * 60_000)
    expect(core.ACTION_REUSE_TTL_MS).toBeGreaterThan(0)
  })
})

describe("resposta de pergunta com opções (buildQuestionAnswer)", () => {
  // fixture com o shape REAL do snapshot (CompanionQuestion ← AskUserQuestion)
  const choices: CompanionWebChoice[] = [
    {
      header: "Cache",
      question: "Qual estratégia de cache prefere?",
      multiSelect: false,
      options: [
        { label: "TTL curto", description: "30s" },
        { label: "Invalidação por evento", description: "mais código" },
      ],
    },
    {
      header: "Escopo",
      question: "Onde aplicar?",
      multiSelect: true,
      options: [
        { label: "API", description: "" },
        { label: "Front", description: "" },
      ],
    },
  ]

  it("monta answers com header + labels marcados, no shape do desktop", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: ["TTL curto"] },
      { selected: ["API", "Front"] },
    ])
    expect(out).toEqual({
      answers: [
        { header: "Cache", selected: ["TTL curto"] },
        { header: "Escopo", selected: ["API", "Front"] },
      ],
    })
  })

  it("texto livre (Outro) entra como seleção, depois dos labels", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: [], other: "  redis com TTL de 5 min  " },
      { selected: ["API"], other: "e o worker também" },
    ])
    expect(out?.answers[0].selected).toEqual(["redis com TTL de 5 min"])
    expect(out?.answers[1].selected).toEqual(["API", "e o worker também"])
  })

  it("single-select nunca viaja com mais de um label (o excedente cai)", () => {
    const out = core.buildQuestionAnswer(choices, [
      { selected: ["TTL curto", "Invalidação por evento"] },
      { selected: ["API"] },
    ])
    expect(out?.answers[0].selected).toEqual(["TTL curto"])
  })

  it("pergunta sem NADA marcado nem digitado = incompleta: null (nunca resposta muda)", () => {
    expect(
      core.buildQuestionAnswer(choices, [{ selected: ["TTL curto"] }, {}]),
    ).toBeNull()
    expect(core.buildQuestionAnswer(choices, null)).toBeNull()
  })

  it("entrada torta é fail-closed: sem perguntas não há payload", () => {
    expect(core.buildQuestionAnswer([], [])).toBeNull()
    expect(core.buildQuestionAnswer(null, [])).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────── C3 — Conversa

describe("markdown seguro do fio (renderMarkdown, subset próprio)", () => {
  // Fixtures REAIS: trechos de itens `text` do SQLite desta máquina (lição
  // ADR-016 — fixture inventada esconde bug). O subset cobre o que os fios
  // reais usam: negrito, itálico, código, fences, listas, headers, tabelas,
  // quotes e links http(s).

  it("negrito, itálico e código inline de um turno real", () => {
    // trecho real (conversa d5fea167): request/response com código inline
    const real =
      'Confirmado: o "pet" é o **`PatchPessoaRequestModel`** — a única classe de *request* convivendo no pacote `model/`.'
    const html = core.renderMarkdown(real)
    expect(html).toContain("<strong><code>PatchPessoaRequestModel</code></strong>")
    expect(html).toContain("<em>request</em>")
    expect(html).toContain("<code>model/</code>")
    expect(html).toContain("&quot;pet&quot;")
  })

  it("fence de código real vira <pre> com o conteúdo escapado, sem markdown dentro", () => {
    // trecho real (application-local.yml explicado pelo agente)
    const real =
      "No perfil local, a configuração efetiva é:\n\n```yaml\napplication:\n  gateway:\n    origem: SALESFORCE\n```\n\nO client envia ambos."
    const html = core.renderMarkdown(real)
    expect(html).toContain('<pre class="mdcode"><code>application:\n  gateway:\n    origem: SALESFORCE</code></pre>')
    expect(html).toContain('<p class="mdp">O client envia ambos.</p>')
    // fence aberta sem fechamento não engole o resto em silêncio: rende o bloco
    expect(core.renderMarkdown("```\nlet x = a < b\n")).toContain("let x = a &lt; b")
  })

  it("listas reais (com e sem número) e headers", () => {
    const real =
      "Alteração aplicada:\n\n- Removida `RecursoNaoEncontradoException`.\n- Testes atualizados.\n\n1. Carrega `application.yml`.\n2. Sobrepõe `application-local.yml`."
    const html = core.renderMarkdown(real)
    expect(html).toContain('<ul class="mdl"><li>Removida <code>RecursoNaoEncontradoException</code>.</li>')
    expect(html).toContain('<ol class="mdl"><li>Carrega <code>application.yml</code>.</li>')
    expect(core.renderMarkdown("## Resumo")).toBe('<div class="mdh mdh2">Resumo</div>')
  })

  it("tabela real vira <table> dentro de wrapper com scroll próprio", () => {
    // trecho real (validação do badge por sessão)
    const real =
      "| Sessão escolhida | Badge exibido |\n|---|---|\n| Gala de encerramento (21/08) | **Sex 21 Ago 19:00** |"
    const html = core.renderMarkdown(real)
    expect(html).toContain('<div class="mdtablewrap"><table class="mdtable">')
    expect(html).toContain("<th>Sessão escolhida</th>")
    expect(html).toContain("<td><strong>Sex 21 Ago 19:00</strong></td>")
  })

  it("citação real em bloco, com inline dentro", () => {
    const real = '> "Eu percebi uma coisa, **que é o horário de início**"\n> É possível ajustar?'
    const html = core.renderMarkdown(real)
    expect(html).toContain('<blockquote class="mdq">')
    expect(html).toContain("<strong>que é o horário de início</strong>")
    expect(html).toContain("<br>É possível ajustar?")
  })

  it("só http(s) vira link; path local e javascript: ficam texto puro", () => {
    const ok = core.renderMarkdown("[doc](https://spring.io/guides)")
    expect(ok).toContain('<a href="https://spring.io/guides" rel="noopener noreferrer" target="_blank">doc</a>')
    // caso real: link markdown apontando pra path do disco NÃO vira <a>
    const disco = core.renderMarkdown("[nossa-casa-codex](/Users/vinicius/projetos/nossa-casa-codex)")
    expect(disco).not.toContain("<a ")
    expect(core.renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a ")
  })

  it("conteúdo hostil de LLM nunca vira HTML vivo (dentro e fora de código)", () => {
    expect(core.renderMarkdown("<script>alert(1)</script>")).not.toContain("<script")
    expect(core.renderMarkdown("`<img src=x onerror=alert(1)>`")).toContain(
      "<code>&lt;img src=x onerror=alert(1)&gt;</code>",
    )
    expect(core.renderMarkdown('**<b onmouseover="x">a</b>**')).not.toContain("<b ")
    // NUL injetado não forja o sentinela interno dos spans de código
    expect(core.renderMarkdown("a\u00000\u0000b `x`")).toContain("<code>x</code>")
  })

  it("entrada vazia ou torta não crasha", () => {
    expect(core.renderMarkdown("")).toBe("")
    expect(core.renderMarkdown(null)).toBe("")
    expect(core.renderMarkdown(undefined)).toBe("")
  })
})

describe("trabalhando há… (elapsedLabel, carimbo do turno vivo)", () => {
  const now = 1_700_000_000_000
  it("segundos, minutos e horas em pt-BR", () => {
    expect(core.elapsedLabel(now, now - 42_000)).toBe("há 42 s")
    expect(core.elapsedLabel(now, now - 5 * 60_000)).toBe("há 5 min")
    expect(core.elapsedLabel(now, now - 2 * 3_600_000)).toBe("há 2 h")
  })
  it("startedAt inválido nunca inventa tempo", () => {
    expect(core.elapsedLabel(now, null)).toBe("")
    expect(core.elapsedLabel(now, 0)).toBe("")
    expect(core.elapsedLabel(now, Number.NaN)).toBe("")
  })
  it("relógio pra trás não vira tempo negativo", () => {
    expect(core.elapsedLabel(now, now + 60_000)).toBe("há 0 s")
  })
})

describe("emenda da janela do fio (mergeThreadTail / mergeThreadOlder)", () => {
  it("primeira cauda: vira a faixa inteira", () => {
    expect(core.mergeThreadTail(null, { items: ["a", "b"], start: 5 })).toEqual({
      items: ["a", "b"],
      start: 5,
    })
  })

  it("refetch da cauda com sobreposição: a cauda FRESCA substitui (item de tool muta)", () => {
    // faixa [0..3); cauda nova [2..4): o item 2 velho sai, o fresco entra
    const cur = { items: ["i0", "i1", "tool-velho"], start: 0 }
    const tail = { items: ["tool-com-result", "i3"], start: 2 }
    expect(core.mergeThreadTail(cur, tail)).toEqual({
      items: ["i0", "i1", "tool-com-result", "i3"],
      start: 0,
    })
  })

  it("cauda que recua (janela maior que a faixa) assume inteira", () => {
    const cur = { items: ["i5"], start: 5 }
    const tail = { items: ["i2", "i3", "i4", "i5", "i6"], start: 2 }
    expect(core.mergeThreadTail(cur, tail)).toEqual(tail)
  })

  it("buraco entre a faixa e a cauda: descarta o velho (faixa com lacuna mentiria)", () => {
    const cur = { items: ["i0", "i1"], start: 0 }
    const tail = { items: ["i90"], start: 90 }
    expect(core.mergeThreadTail(cur, tail)).toEqual({ items: ["i90"], start: 90 })
  })

  it("cauda torta é ignorada (mantém o que temos)", () => {
    const cur = { items: ["i0"], start: 0 }
    expect(core.mergeThreadTail(cur, null)).toEqual(cur)
    expect(core.mergeThreadTail(cur, { items: "x" as unknown as unknown[], start: 0 })).toEqual(cur)
    expect(core.mergeThreadTail(cur, { items: [], start: -1 })).toEqual(cur)
  })

  it("carregar anteriores: página contígua emenda na frente", () => {
    const cur = { items: ["i2", "i3"], start: 2 }
    const older = { items: ["i0", "i1"], start: 0 }
    expect(core.mergeThreadOlder(cur, older)).toEqual({
      items: ["i0", "i1", "i2", "i3"],
      start: 0,
    })
  })

  it("página rasgada (não termina onde a faixa começa) é ignorada", () => {
    const cur = { items: ["i5"], start: 5 }
    expect(core.mergeThreadOlder(cur, { items: ["i0"], start: 0 })).toEqual(cur)
    expect(core.mergeThreadOlder(cur, null)).toEqual(cur)
    expect(core.mergeThreadOlder(null, { items: ["i0"], start: 0 })).toBeNull()
  })
})

describe("blob do fio (blobUrlPath, espelho do blob_path_parts do Rust)", () => {
  it("paths REAIS de anexo e evidência viram URL da rota autenticada", () => {
    // paths reais do SQLite desta máquina
    expect(
      core.blobUrlPath("attachments/16b3735b-0552-4162-96d2-71bc034944eb/d82ead1887fb803b.png"),
    ).toBe("/api/blob/attachments/16b3735b-0552-4162-96d2-71bc034944eb/d82ead1887fb803b.png")
    expect(
      core.blobUrlPath("evidence/d5fea167-493d-4c77-a93f-6e7df5a256fb/toolu_01Wwmz5Hn1KbU1wrm35LrjvT-0.jpg"),
    ).toBe("/api/blob/evidence/d5fea167-493d-4c77-a93f-6e7df5a256fb/toolu_01Wwmz5Hn1KbU1wrm35LrjvT-0.jpg")
  })

  it("só imagem vira <img>; pdf e extensão estranha ficam de fora", () => {
    expect(core.blobUrlPath("attachments/abc/doc.pdf")).toBeNull()
    expect(core.blobUrlPath("attachments/abc/x.sh")).toBeNull()
    expect(core.blobUrlPath("attachments/abc/semext")).toBeNull()
  })

  it("traversal, raiz desconhecida e tipo errado nunca viram URL", () => {
    expect(core.blobUrlPath("attachments/../x.png")).toBeNull()
    expect(core.blobUrlPath("secrets/abc/x.png")).toBeNull()
    expect(core.blobUrlPath("/etc/passwd")).toBeNull()
    expect(core.blobUrlPath("attachments/abc/a/b.png")).toBeNull()
    expect(core.blobUrlPath(null)).toBeNull()
    expect(core.blobUrlPath(42)).toBeNull()
  })
})
