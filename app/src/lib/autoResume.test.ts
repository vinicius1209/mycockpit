import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  wantsAutoResume,
  parseResetHint,
  backoffMs,
  resumeBannerLabel,
  resumePrompt,
  turnClosedOk,
  BACKOFF_CAP_MS,
  RESUME_REASON_LIMIT,
  RESUME_REASON_LIMIT_SEM_RESET,
  RESUME_REASON_TEXT,
  retomadaAgendada,
} from "./autoResume"

let n = 0
function uid() {
  return `id-${n++}`
}
const text = (t: string): ChatItem => ({ kind: "text", id: uid(), text: t })
const limitItem = (m: string): ChatItem => ({ kind: "limit", id: uid(), message: m })
const user = (t: string): ChatItem => ({ kind: "user", id: uid(), text: t })
/** Desfecho do turno: o veredito do CLI (é o que o gate lê, não o texto). */
const ok = (v: boolean): ChatItem => ({ kind: "result", id: uid(), ok: v })

describe("backoffMs", () => {
  it("dobra por tentativa e capa em 15min", () => {
    expect(backoffMs(0)).toBe(60_000)
    expect(backoffMs(1)).toBe(120_000)
    expect(backoffMs(2)).toBe(240_000)
    expect(backoffMs(10)).toBe(BACKOFF_CAP_MS)
    expect(backoffMs(-5)).toBe(60_000)
  })
})

describe("parseResetHint", () => {
  const NOW = 1_700_000_000_000
  it("null sem hint", () => {
    expect(parseResetHint(undefined, NOW)).toBeNull()
    expect(parseResetHint("", NOW)).toBeNull()
  })
  it("duração relativa em segundos/minutos/horas", () => {
    expect(parseResetHint("60s", NOW)).toBe(60_000)
    expect(parseResetHint("wait 90 seconds", NOW)).toBe(90_000)
    expect(parseResetHint("reseta em 2 min", NOW)).toBe(120_000)
    expect(parseResetHint("1h", NOW)).toBe(3_600_000)
  })
  it("timestamp absoluto ISO → delta", () => {
    const future = new Date(NOW + 5 * 60_000).toISOString()
    expect(parseResetHint(future, NOW)).toBe(5 * 60_000)
  })
  it("epoch em segundos", () => {
    const epochSec = Math.floor((NOW + 120_000) / 1000)
    expect(parseResetHint(String(epochSec), NOW)).toBe(120_000)
  })

  it("lê o relógio com fuso da Claude no incidente real de 31/08", () => {
    const incidentAt = Date.parse("2026-08-31T11:29:04-03:00")
    const resetAt = Date.parse("2026-08-31T14:30:00-03:00")
    expect(
      parseResetHint("2:30pm (America/Sao_Paulo)", incidentAt),
    ).toBe(resetAt - incidentAt)
    expect(parseResetHint("3pm (America/Sao_Paulo)", incidentAt)).toBe(
      Date.parse("2026-08-31T15:00:00-03:00") - incidentAt,
    )
  })

  it("fuso inválido degrada sem derrubar o agendador", () => {
    expect(parseResetHint("2:30pm (Fuso/Inexistente)", NOW)).toBeNull()
  })
})

describe("wantsAutoResume", () => {
  const NOW = 1_700_000_000_000

  it("resume FORTE quando bate limite da CLI, cronometrado pelo hint", () => {
    const v = wantsAutoResume([text("ok")], { hit: true, resetHint: "60s" }, 0, NOW)
    expect(v.resume).toBe(true)
    expect(v.delayMs).toBe(62_000) // 60s + 2s de folga
    expect(v.reason).toMatch(/limite/i)
  })

  it("limite da CLI sem hint cai no backoff pela tentativa", () => {
    const v = wantsAutoResume([text("ok")], { hit: true }, 2, NOW)
    expect(v.resume).toBe(true)
    expect(v.delayMs).toBe(240_000)
  })

  it("resume HEURÍSTICO pelo texto final (pt-BR)", () => {
    const v = wantsAutoResume(
      [text("Bati no rate limit. Vou aguardar o reset e tentar de novo.")],
      undefined,
      0,
      NOW,
    )
    expect(v.resume).toBe(true)
    expect(v.reason).toMatch(/texto/i)
  })

  it("resume HEURÍSTICO em inglês (will retry / wakeup)", () => {
    expect(wantsAutoResume([text("I will retry after the wakeup.")], undefined, 0, NOW).resume).toBe(true)
    expect(wantsAutoResume([text("Hit the limit, backing off for a bit.")], undefined, 0, NOW).resume).toBe(true)
  })

  it("extrai o delay do próprio texto quando cita duração", () => {
    const v = wantsAutoResume(
      [text("Vou esperar 60s e tentar novamente.")],
      undefined,
      0,
      NOW,
    )
    expect(v.resume).toBe(true)
    expect(v.delayMs).toBe(62_000)
  })

  it("usa o evento de limite como texto final", () => {
    const v = wantsAutoResume([limitItem("Limite de uso atingido, tente mais tarde")], undefined, 0, NOW)
    expect(v.resume).toBe(true)
  })

  it("NÃO resume num turno normal concluído", () => {
    const v = wantsAutoResume(
      [text("Pronto! Criei o arquivo e os testes passaram.")],
      undefined,
      0,
      NOW,
    )
    expect(v.resume).toBe(false)
    expect(v.delayMs).toBe(0)
  })

  it("NÃO resume se o turno terminou em erro (sem sinal de retry)", () => {
    const items: ChatItem[] = [text("mexendo nos arquivos"), { kind: "error", id: uid(), message: "boom" }]
    expect(wantsAutoResume(items, undefined, 0, NOW).resume).toBe(false)
  })

  it("não trunca um reset confiável no teto do backoff", () => {
    const v = wantsAutoResume([text("ok")], { hit: true, resetHint: "1h" }, 0, NOW)
    expect(v.delayMs).toBe(3_602_000)
    expect(v.delayMs).toBeGreaterThan(BACKOFF_CAP_MS)
  })

  it("agenda o reset real das 14:30, não uma tentativa em 60s", () => {
    // Fixture do SQLite: limite às 11:29:04, reset_hint abaixo e reenvio
    // incorreto registrado às 11:30:05. A espera correta passa de 3h.
    const incidentAt = Date.parse("2026-08-31T11:29:04-03:00")
    const resetAt = Date.parse("2026-08-31T14:30:00-03:00")
    const v = wantsAutoResume(
      [limitItem("You've hit your session limit · resets 2:30pm (America/Sao_Paulo)")],
      { hit: true, resetHint: "2:30pm (America/Sao_Paulo)" },
      0,
      incidentAt,
    )
    expect(v.delayMs).toBe(resetAt - incidentAt + 2_000)
    expect(v.delayMs).toBeGreaterThan(BACKOFF_CAP_MS)
  })

  it("usa o backoff como piso se o minuto do reset acabou de passar", () => {
    const justAfterReset = Date.parse("2026-08-31T14:30:04-03:00")
    const v = wantsAutoResume(
      [limitItem("You've hit your session limit · resets 2:30pm (America/Sao_Paulo)")],
      { hit: true, resetHint: "2:30pm (America/Sao_Paulo)" },
      1,
      justAfterReset,
    )
    expect(v.delayMs).toBe(120_000)
  })
})

describe("turno que fechou bem não é retomado por texto (REGRESSÃO 13/08/2026)", () => {
  const NOW = 1_700_000_000_000
  /** O texto REAL que custou um run pago: uma recomendação de arquitetura em
   *  que a palavra "retry" é vocabulário técnico, não promessa de tentar de
   *  novo. Casava `\bretry\b` e reenviava sozinho. */
  const ARQUITETURA = text(
    "4. **ERP:** adicionar solicitação, aprovação, outbox/retry e confirmação externa.\n\nNão alterei o código neste turno.",
  )

  it("result ok + 'outbox/retry' no texto: NÃO retoma", () => {
    const items: ChatItem[] = [user("veja a troca com o Allan"), ARQUITETURA, ok(true)]
    const v = wantsAutoResume(items, undefined, 0, NOW)
    expect(v.resume).toBe(false)
    expect(v.delayMs).toBe(0)
  })

  it("outras palavras técnicas do dia a dia também deixam de disparar", () => {
    for (const t of [
      "Implementei rate limit no endpoint de login.",
      "O cliente já faz backoff exponencial entre as tentativas.",
      "O teste tem retry automático quando o CI está lento.",
    ]) {
      const items: ChatItem[] = [user("faça isso"), text(t), ok(true)]
      expect(wantsAutoResume(items, undefined, 0, NOW).resume).toBe(false)
    }
  })

  it("MAS turno que falhou com o mesmo sinal continua retomando", () => {
    const items: ChatItem[] = [user("faça isso"), text("Bati no rate limit, vou tentar de novo."), ok(false)]
    const v = wantsAutoResume(items, undefined, 0, NOW)
    expect(v.resume).toBe(true)
    expect(v.reason).toBe(RESUME_REASON_TEXT)
  })

  it("e turno que morreu sem desfecho (sem result) segue coberto pela heurística", () => {
    const items: ChatItem[] = [user("faça isso"), text("Vou aguardar o reset e continuar.")]
    expect(wantsAutoResume(items, undefined, 0, NOW).resume).toBe(true)
  })

  it("o sinal FORTE do CLI vence o desfecho: limite bateu, retoma mesmo com result ok", () => {
    const items: ChatItem[] = [user("faça isso"), text("tudo certo"), ok(true)]
    const v = wantsAutoResume(items, { hit: true, resetHint: "60s" }, 0, NOW)
    expect(v.resume).toBe(true)
    expect(v.reason).toBe(RESUME_REASON_LIMIT)
  })

  it("turnClosedOk lê o desfecho, não o texto", () => {
    expect(turnClosedOk([user("x"), text("oi"), ok(true)])).toBe(true)
    expect(turnClosedOk([user("x"), text("oi"), ok(false)])).toBe(false)
    // sem desfecho nenhum dentro do turno = não fechou bem
    expect(turnClosedOk([user("x"), text("oi")])).toBe(false)
    // desfecho de OUTRO turno não conta como o deste
    expect(turnClosedOk([text("oi"), ok(true), user("novo pedido"), text("trabalhando")])).toBe(false)
  })
})

describe("a heurística não atravessa a fronteira do turno", () => {
  const NOW = 1_700_000_000_000

  it("turno só de ferramentas não herda o 'vou tentar de novo' do turno anterior", () => {
    const items: ChatItem[] = [
      user("primeiro pedido"),
      text("Bati no limite, vou tentar de novo."),
      user("agora faz outra coisa"),
      { kind: "tool", id: uid(), name: "Bash", input: { command: "ls" } },
    ]
    expect(wantsAutoResume(items, undefined, 0, NOW).resume).toBe(false)
  })
})

describe("o app conta o gatilho real (nada de limite inventado)", () => {
  it("prompt do reenvio muda com o motivo", () => {
    expect(resumePrompt(RESUME_REASON_LIMIT)).toContain("limite de uso")
    const heuristico = resumePrompt(RESUME_REASON_TEXT)
    expect(heuristico).not.toContain("limite de uso")
    expect(heuristico).toContain("indicou que continuaria depois")
    // e admite a possibilidade de não haver nada pendente
    expect(heuristico).toContain("se não ficou nada pendente")
  })

  it("banner não jura reset de limite quando ninguém bateu limite", () => {
    expect(resumeBannerLabel(RESUME_REASON_LIMIT)).toBe("após o reset do limite")
    expect(resumeBannerLabel(RESUME_REASON_TEXT)).not.toMatch(/limite/i)
  })
})

describe("limite do Codex: horário real ou honestidade sobre não ter horário", () => {
  // Payload REAL do fio (conversa do Codex, 14/09/2026 13:50:09). O Rust passa a
  // extrair o trecho depois de "try again at"; antes vinha vazio e a retomada
  // agendava 60s, 120s, 240s, 480s dizendo "após o reset do limite".
  const MENSAGEM =
    "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 10:12 AM."
  const incidente = new Date(2026, 8, 14, 13, 50, 9).getTime()
  const volta = new Date(2026, 8, 19, 10, 12).getTime()

  it("lê a data do Codex e agenda para quando o limite volta de fato", () => {
    expect(parseResetHint("Sep 19th, 2026 10:12 AM", incidente)).toBe(volta - incidente)
    const v = wantsAutoResume([limitItem(MENSAGEM)], { hit: true, resetHint: "Sep 19th, 2026 10:12 AM" }, 3, incidente)
    expect(v.reason).toBe(RESUME_REASON_LIMIT)
    expect(v.delayMs).toBe(volta - incidente + 2_000)
  })

  it("aceita as outras variações de dia e de meia-noite e meio-dia", () => {
    const base = new Date(2026, 8, 14, 9, 0).getTime()
    expect(parseResetHint("Sep 1st, 2027 12:05 AM", base)).toBe(new Date(2027, 8, 1, 0, 5).getTime() - base)
    expect(parseResetHint("October 2nd, 2026 12:30 PM", base)).toBe(new Date(2026, 9, 2, 12, 30).getTime() - base)
    expect(parseResetHint("Foo 19th, 2026 10:12 AM", base)).toBeNull()
  })

  it("sem horário legível, o motivo diz que é estimativa e ninguém jura reset", () => {
    const v = wantsAutoResume([limitItem(MENSAGEM)], { hit: true, resetHint: null }, 3, incidente)
    expect(v.reason).toBe(RESUME_REASON_LIMIT_SEM_RESET)
    expect(v.delayMs).toBe(480_000)
    expect(resumeBannerLabel(v.reason)).not.toContain("após o reset")
    expect(resumeBannerLabel(v.reason)).toContain("sem horário de reset")
    expect(resumePrompt(v.reason)).toContain("limite de uso")
    expect(resumePrompt(v.reason)).not.toContain("já deve ter resetado")
  })
})

describe("retomadaAgendada", () => {
  const estado = { tries: 1, maxTries: 3, nextAt: 0, reason: "limit", timer: 0 as unknown as ReturnType<typeof setTimeout> }
  it("agendada só enquanto o timer não disparou", () => {
    expect(retomadaAgendada({ autoResume: estado })).toBe(true)
    expect(retomadaAgendada({ autoResume: { ...estado, disparou: true } })).toBe(false)
    expect(retomadaAgendada({})).toBe(false)
    expect(retomadaAgendada(undefined)).toBe(false)
  })
})
