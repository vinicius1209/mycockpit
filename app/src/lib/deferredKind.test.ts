// Gêmeo de `tipo_do_diferido_atravessa_o_fio_em_snake_case` e
// `task_type_do_claude_vira_tipo_do_contrato` (src-tauri, adapters_claude_
// inventory_tests.rs): os quatro textos que o Rust serializa são os quatro que
// o TS aceita, e só a leitura de item antigo conhece termo cru de motor.

import { describe, expect, it } from "vitest"
import { deferredKind } from "./work"

describe("deferredKind", () => {
  it("aceita os quatro tipos do contrato como vieram do fio", () => {
    for (const kind of ["terminal", "subagent", "workflow", "other"]) {
      expect(deferredKind({ kind })).toBe(kind)
    }
  })

  it("item gravado antes do contrato é lido pelo termo cru da época", () => {
    // Valores das capturas reais (testdata/claude-2.1.270) e do `bash` que o
    // adapter punha no shell em segundo plano até 21/09/2026.
    expect(deferredKind({ kind: "local_bash" })).toBe("terminal")
    expect(deferredKind({ kind: "bash" })).toBe("terminal")
    expect(deferredKind({ kind: "local_agent" })).toBe("subagent")
    expect(deferredKind({ kind: "local_workflow" })).toBe("workflow")
  })

  it("termo que ninguém conhece vira other, e ausência segue ausência", () => {
    expect(deferredKind({ kind: "remote_thing" })).toBe("other")
    expect(deferredKind({ kind: null })).toBeNull()
  })
})
