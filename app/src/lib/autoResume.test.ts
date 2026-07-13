import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import {
  wantsAutoResume,
  parseResetHint,
  backoffMs,
  BACKOFF_CAP_MS,
} from "./autoResume"

let n = 0
function uid() {
  return `id-${n++}`
}
const text = (t: string): ChatItem => ({ kind: "text", id: uid(), text: t })
const limitItem = (m: string): ChatItem => ({ kind: "limit", id: uid(), message: m })

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

  it("usa o cartão de limite como texto final", () => {
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

  it("capa o delay em 15min mesmo com hint gigante", () => {
    const v = wantsAutoResume([text("ok")], { hit: true, resetHint: "1h" }, 0, NOW)
    expect(v.delayMs).toBe(BACKOFF_CAP_MS)
  })
})
