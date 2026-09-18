// O nome da conversa: recorte, e limpeza da resposta do helper.
//
// PAYLOADS REAIS (ADR-016). Colhidos em 18/09/2026 rodando o MESMO one-shot que
// o app roda (`claude -p --tools "" --output-format text`, sem hooks), com o
// `TITULO_PROMPT` deste módulo, sobre conversas reais deste repositório. Cada
// fixture abaixo diz o modelo e o pedido que a produziu.
//
// O primeiro é o incidente que desenhou a sentinela: para a conversa "oi", o
// haiku não nomeou nada, ele RESPONDEU — "Qual é o assunto do trabalho" viraria
// o nome da conversa na sidebar. Nenhuma fixture inventada teria esse formato.

import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { contextoDoTitulo, parseTitulo, TITULO_MAX } from "./tituloDaConversa"

/** Saídas REAIS do helper, uma por linha de evidência. */
const REAL = {
  // haiku, prompt SEM a regra da sentinela, sobre "oi" → o incidente.
  perguntaDeVolta: "Qual é o assunto do trabalho",
  // haiku, sobre "oi" / "testando" (duas caixas diferentes, as duas reais).
  sentinelaMaiuscula: "SEM ASSUNTO",
  sentinelaMinusculaComPonto: "Sem assunto.",
  // haiku, sobre o incidente real do autoscroll do fio.
  curto: "Autoscroll do fio",
  // haiku, sobre a decisão FTS5 vs embeddings (dois-pontos NO MEIO do nome).
  comDoisPontosNoMeio: "Busca do fio: FTS5 vs embeddings",
  // haiku, sobre "arruma isso ai pra mim" + resposta sobre o parse do custo:
  // o assunto veio da RESPOSTA, que é o que a regra do prompt pede.
  assuntoVeioDaResposta: "Parse do turn_costs",
  // sonnet (o helper é configurável, então não basta testar um modelo).
  doSonnet: "Nomeação automática de conversas",
  // haiku, sobre a migração de autenticação do Companion.
  longoMasCabendo: "Pareamento de autenticação do Companion",
} as const

const user = (text: string): ChatItem =>
  ({ kind: "user", id: "u", text, ts: 0 }) as unknown as ChatItem
const assistente = (text: string): ChatItem =>
  ({ kind: "text", id: "a", text, ts: 0 }) as unknown as ChatItem

describe("parseTitulo · payloads reais do helper", () => {
  it("nome curto e bom passa inteiro", () => {
    expect(parseTitulo(REAL.curto)).toBe("Autoscroll do fio")
    expect(parseTitulo(REAL.assuntoVeioDaResposta)).toBe("Parse do turn_costs")
    expect(parseTitulo(REAL.doSonnet)).toBe("Nomeação automática de conversas")
    expect(parseTitulo(REAL.longoMasCabendo)).toBe(
      "Pareamento de autenticação do Companion",
    )
  })

  it("dois-pontos NO MEIO é nome legítimo, não preâmbulo", () => {
    expect(parseTitulo(REAL.comDoisPontosNoMeio)).toBe(
      "Busca do fio: FTS5 vs embeddings",
    )
  })

  it("a sentinela vira null nas duas caixas que o modelo devolveu", () => {
    expect(parseTitulo(REAL.sentinelaMaiuscula)).toBeNull()
    expect(parseTitulo(REAL.sentinelaMinusculaComPonto)).toBeNull()
  })

  it("nenhum nome real passa da régua da sidebar", () => {
    for (const bruto of Object.values(REAL)) {
      const nome = parseTitulo(bruto)
      if (nome) expect(nome.length).toBeLessThanOrEqual(TITULO_MAX + 1)
    }
  })

  it("o incidente: sem a sentinela, a PERGUNTA do modelo viraria o nome", () => {
    // Documenta por que a regra existe no prompt. O parser não tem como saber
    // que isto é uma pergunta disfarçada — quem resolve é a sentinela, e é por
    // isso que ela está no prompt e não aqui.
    expect(parseTitulo(REAL.perguntaDeVolta)).toBe("Qual é o assunto do trabalho")
  })
})

// Contrato defensivo: estes formatos NÃO apareceram nas rodadas de 18/09/2026,
// então não são fixture, são a trava. Ficam porque o nome viaja pra notificação
// do SO e pro título de schedule, onde markdown e travessão já incomodaram
// (docs/mypeople-patterns-plan.md:395).
describe("parseTitulo · contrato (formatos não observados, travados assim mesmo)", () => {
  it("tira aspas, markdown de borda e ponto final", () => {
    expect(parseTitulo('"Autoscroll do fio"')).toBe("Autoscroll do fio")
    expect(parseTitulo("**Autoscroll do fio**")).toBe("Autoscroll do fio")
    expect(parseTitulo("- Autoscroll do fio.")).toBe("Autoscroll do fio")
  })

  it("travessão vira corte: fica o assunto, some o detalhe", () => {
    expect(parseTitulo("Watchdog do fio — corrigir o timer")).toBe(
      "Watchdog do fio",
    )
    expect(parseTitulo("Watchdog do fio – corrigir o timer")).toBe(
      "Watchdog do fio",
    )
  })

  it("preâmbulo conversacional é recusado", () => {
    expect(parseTitulo("Claro! Aqui está:")).toBeNull()
  })

  it("resposta vazia ou curta demais é recusada", () => {
    expect(parseTitulo("")).toBeNull()
    expect(parseTitulo("\n\n")).toBeNull()
    expect(parseTitulo("Ok")).toBeNull()
  })

  it("nome comprido é cortado na régua da sidebar", () => {
    const nome = parseTitulo("a".repeat(60))
    expect(nome).toBe(`${"a".repeat(TITULO_MAX)}…`)
  })

  it("só a primeira linha conta", () => {
    expect(parseTitulo("Autoscroll do fio\n\nPosso detalhar se quiser.")).toBe(
      "Autoscroll do fio",
    )
  })
})

describe("contextoDoTitulo", () => {
  it("ancora no PEDIDO que abriu a conversa, não nas últimas mensagens", () => {
    const ctx = contextoDoTitulo([
      user("o scroll do fio para de acompanhar"),
      assistente("achei, era o firstElementChild"),
      user("beleza"),
      assistente("commitado"),
    ])
    // o primeiro pedido sobrevive mesmo com turnos depois dele: é ele que nomeia
    expect(ctx).toContain("o scroll do fio para de acompanhar")
    // e a última resposta entra como desempate
    expect(ctx).toContain("commitado")
    expect(ctx).not.toContain("beleza")
  })

  it("conversa só com o pedido não inventa resposta", () => {
    expect(contextoDoTitulo([user("oi")])).toBe("Pedido: oi")
  })
})
