import { describe, expect, it } from "vitest"
import { vistaDaConversa } from "@/components/chat/vistaDaConversa"

describe("vistaDaConversa — missão terminada devolve o fio", () => {
  it("O BUG: missão CONCLUÍDA não pode esconder o fio", () => {
    // Relato do usuário: missão concluída na tela, composer aceitando mensagem,
    // e nada aparecendo. O envio olhava `status === "running"` (já false) e o
    // fio olhava "tem missão" (ainda true) — duas perguntas, um booleano só.
    const v = vistaDaConversa({ temConversa: true, missao: "done" })
    expect(v.fio).toBe(true)
    // …e a timeline FICA: ela é o registro do episódio, não some por terminar.
    expect(v.timeline).toBe(true)
  })

  it("os três desfechos terminais devolvem o fio, não só o 'done'", () => {
    for (const s of ["done", "error", "aborted"] as const) {
      expect(vistaDaConversa({ temConversa: true, missao: s }).fio, s).toBe(true)
    }
  })

  it("missão RODANDO: a timeline toma a tela e o fio recua", () => {
    const v = vistaDaConversa({ temConversa: true, missao: "running" })
    expect(v.timeline).toBe(true)
    expect(v.fio).toBe(false)
    // A presença segue a mesma regra do fio: some enquanto a missão roda.
    expect(v.presenca).toBe(false)
  })

  it("sem missão nenhuma: fio normal, sem timeline", () => {
    const v = vistaDaConversa({ temConversa: true, missao: null })
    expect(v).toEqual({ timeline: false, fio: true, presenca: true, boasVindas: false })
  })

  it("sem conversa e sem missão: só o 'Boa tarde'", () => {
    const v = vistaDaConversa({ temConversa: false, missao: null })
    expect(v.boasVindas).toBe(true)
    expect(v.fio).toBe(false)
  })

  it("missão sem conversa NÃO mostra boas-vindas (o card flutuava sobre a timeline)", () => {
    // Defeito antigo que a supressão original consertou, e que a correção de
    // hoje não pode reintroduzir.
    for (const s of ["running", "done"] as const) {
      expect(vistaDaConversa({ temConversa: false, missao: s }).boasVindas, s).toBe(false)
    }
  })

  it("a presença volta junto com o fio quando a missão termina", () => {
    expect(vistaDaConversa({ temConversa: true, missao: "done" }).presenca).toBe(true)
  })
})
