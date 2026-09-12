import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { buildNodes } from "./messageNodes"
import { corteNasceu, groupByAuthor, grupoDeCorte } from "./messageGroups"
import { deriveTurnTicks } from "./TurnScrubber"

// A sequência REAL do corte de 09/09/2026 (conversa "[feat] cliente coleta"):
// o pedido, a prosa do turno, o cancelled e a sua mensagem 71ms depois.
const CORTE = 1_788_962_247_781
const fio: ChatItem[] = [
  {
    kind: "user",
    id: "u1",
    text: "confere se as configurações de funil do banco local batem com o desenho novo",
    ts: CORTE - 321_193,
  },
  {
    kind: "text",
    id: "t1",
    text: "O banco local está disponível, mas as configurações dos funis estão antigas: quase todos os estágios apontam para a régua anterior.",
    ts: CORTE - 135_031,
  },
  { kind: "cancelled", id: "c1", ts: CORTE, cause: "correcao" },
  {
    kind: "user",
    id: "u2",
    text: "voce consegue se conectar no banco de prod e aplicar as mesmas configurações aqui no local",
    ts: CORTE + 71,
  },
]
const grupos = groupByAuthor(buildNodes(fio))
const grupoCorte = grupos.find((g) => g.author.kind === "system")
const grupoAgente = grupos.find((g) => g.author.kind === "executor")

describe("grupoDeCorte", () => {
  it("o marco do cancelled forma o grupo de corte", () => {
    expect(grupoCorte).toBeDefined()
    expect(grupoDeCorte(grupoCorte)).toBe(true)
  })

  it("o bloco do agente e as suas mensagens não são corte", () => {
    expect(grupoDeCorte(grupoAgente)).toBe(false)
    expect(grupos.filter((g) => g.author.kind === "you").some(grupoDeCorte)).toBe(false)
  })

  it("aviso de sistema sem cancelled não é corte", () => {
    const aviso = groupByAuthor(
      buildNodes([{ kind: "notice", id: "n1", message: "anexo expirado", ts: CORTE }]),
    )[0]
    expect(grupoDeCorte(aviso)).toBe(false)
  })
})

describe("corteNasceu: a brasa só no instante do corte", () => {
  it("o corte que acabou de chegar acende o bloco de cima", () => {
    expect(corteNasceu(grupoCorte, CORTE + 120)).toBe(true)
  })

  it("relido no dia seguinte, o corte não reacende nada", () => {
    expect(corteNasceu(grupoCorte, CORTE + 86_400_000)).toBe(false)
  })

  it("sem grupo seguinte (fim do fio) não há brasa", () => {
    expect(corteNasceu(undefined, CORTE)).toBe(false)
  })
})

describe("régua: o corte vira emenda", () => {
  const ticks = deriveTurnTicks(grupos)

  it("o marcador do corte é emenda e diz quem cortou", () => {
    const tick = ticks.find((t) => t.corte)
    expect(tick).toBeDefined()
    expect(tick?.summary).toBe("você interrompeu para corrigir")
  })

  it("só o marcador do corte é emenda", () => {
    expect(ticks.filter((t) => t.corte)).toHaveLength(1)
  })
})
