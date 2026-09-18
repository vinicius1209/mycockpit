// Quem pode ser renomeado pelo helper, e quem é intocável.
//
// A regra inteira do "uma vez na vida da conversa" mora em `podeNomear`, e ela
// é pura de propósito: sem coluna, sem flag e sem contador persistido, o estado
// sai dos próprios items e sobrevive a replay.
//
// O caso que ela existe para proteger é o último: título escrito por gente
// nunca é autocorrigido (ADR-142).

import { describe, expect, it } from "vitest"
import { deriveTitle } from "@/lib/convTitle"
import type { ChatItem } from "@/store/chat"
import { podeNomear, TITULO_MAX_TURNOS } from "./titulo"

const user = (text: string): ChatItem =>
  ({ kind: "user", id: `u${text}`, text, ts: 0 }) as unknown as ChatItem
const resposta = (text: string): ChatItem =>
  ({ kind: "text", id: `a${text}`, text, ts: 0 }) as unknown as ChatItem

const primeiroTurno = [user("oi"), resposta("Oi! Como posso ajudar?")]

describe("podeNomear", () => {
  it("conversa recém-nomeada pelo app pode ser renomeada pelo helper", () => {
    // é o caso de projeto: o título é o "oi" que o deriveTitle escreveu
    expect(podeNomear(deriveTitle(primeiroTurno), primeiroTurno)).toBe(true)
  })

  it("conversa sem título nenhum pode ser nomeada", () => {
    expect(podeNomear(null, primeiroTurno)).toBe(true)
    expect(podeNomear(undefined, primeiroTurno)).toBe(true)
  })

  it("título escrito por GENTE é intocável", () => {
    expect(podeNomear("Revisão de branches", primeiroTurno)).toBe(false)
  })

  it("nome que o helper já deu é intocável (a renomeação é uma só)", () => {
    // depois da primeira renomeação o título deixa de bater com o derivado,
    // e é exatamente isso que trava a segunda chamada — sem contador nenhum
    expect(podeNomear("Autoscroll do fio", primeiroTurno)).toBe(false)
  })

  it("ramo mantém o nome de ramo", () => {
    const itens = [user("arruma o watchdog"), resposta("feito")]
    expect(podeNomear("arruma o watchdog (fork)", itens)).toBe(false)
  })

  it("conversa sem turno nenhum não é nomeada", () => {
    expect(podeNomear(null, [])).toBe(false)
    expect(podeNomear(null, [resposta("nota do sistema")])).toBe(false)
  })

  it("a retentativa vale até o terceiro turno, e para ali", () => {
    const turnos = (n: number) =>
      Array.from({ length: n }, (_, i) => user(`pedido ${i}`))
    const noLimite = turnos(TITULO_MAX_TURNOS)
    expect(podeNomear(deriveTitle(noLimite), noLimite)).toBe(true)
    const passou = turnos(TITULO_MAX_TURNOS + 1)
    expect(podeNomear(deriveTitle(passou), passou)).toBe(false)
  })

  it("conversa que nasceu de anexo (título do anexo) também é nomeável", () => {
    // deriveTitle devolve "Imagem" quando só há anexo; continua sendo nome do
    // app, não de gente, então o helper ainda pode melhorar
    const itens = [
      {
        kind: "user",
        id: "u1",
        text: "",
        attachments: [{ kind: "image", path: "/a.png", name: "a.png", bytes: 1 }],
        ts: 0,
      } as unknown as ChatItem,
    ]
    expect(podeNomear(deriveTitle(itens), itens)).toBe(true)
  })
})
