// O clamp ÚNICO do vocabulário de automação, valor a valor.
//
// Este arquivo existe por causa de um bug REAL (04/09/2026): o "Auto" do
// seletor de automação nunca chegava no processo. O ADR-023 abriu o modo, o
// tipo cresceu e o motor ganhou o braço — mas os dois clamps do meio do
// caminho (`store/schedules.create` e o `toSchedule` do banco) continuaram
// escritos à mão como `=== "padrao" ? "padrao" : "leitura"`. Resultado: o
// Codex rodava em sandbox read-only, negava o shell com "Operation not
// permitted" e a automação falhava por um motivo que não tinha nada a ver com
// o que o usuário tinha pedido.
//
// A régua de segurança que o teste protege: a função pode APERTAR (valor
// desconhecido vira o mais restrito), nunca AFROUXAR.

import { describe, expect, it } from "vitest"
import {
  naoAlarga,
  normalizeSchedulePermission,
  PERMISSIVIDADE,
  type SchedulePermission,
} from "./sessionMode"

describe("normalizeSchedulePermission", () => {
  it("devolve os três modos do vocabulário sem mexer neles", () => {
    // o caso que o bug comia: "auto" TEM que atravessar.
    expect(normalizeSchedulePermission("auto")).toBe("auto")
    expect(normalizeSchedulePermission("padrao")).toBe("padrao")
    expect(normalizeSchedulePermission("leitura")).toBe("leitura")
  })

  it("'liberado' NUNCA passa: automação desassistida não tem quem segure um erro", () => {
    expect(normalizeSchedulePermission("liberado")).toBe("leitura")
  })

  it("valor estranho, vazio, null e undefined caem no mais restrito (fail-closed)", () => {
    for (const v of ["", "LIBERADO", "auto ", "fusion-ro", "plan", null, undefined]) {
      expect(normalizeSchedulePermission(v)).toBe("leitura")
    }
  })

  it("nunca devolve um modo MAIS permissivo que a entrada", () => {
    const entradas: [string, SchedulePermission][] = [
      ["leitura", "leitura"],
      ["padrao", "padrao"],
      ["auto", "auto"],
      ["liberado", "leitura"],
      ["xpto", "leitura"],
    ]
    for (const [cru, esperado] of entradas) {
      const saida = normalizeSchedulePermission(cru)
      expect(saida).toBe(esperado)
      // a invariante em si, medida na régua de permissividade: 'liberado' (3)
      // vira 'leitura' (0) — apertou; nenhum caminho sobe de degrau.
      if (cru in PERMISSIVIDADE) {
        expect(
          naoAlarga(cru as keyof typeof PERMISSIVIDADE, saida),
        ).toBe(true)
      }
    }
  })
})
