// Teste-GÊMEO do Rust (`matriz_lista_de_modelos_por_agent` em adapters.rs) —
// mesma disciplina das matrizes de anexo/slash/canais/compactação/janela.
// Lá é a verdade auditada por versão (14/08/2026, nesta máquina: agy 1.1.13
// `agy models`, codex 0.147 `model/list` no app-server, claude 2.1.220 SEM
// fonte); aqui é o espelho que a UI e o curador de modelos consultam.
// Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef, modelListingAgents } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (agy-models ↔ AgyModelsSubcommand, codex-app-server ↔ CodexAppServer). */
const MATRIZ: Record<string, "agy-models" | "codex-app-server" | null> = {
  // claude 2.1.220: nenhum subcomando de modelos (help verificado 14/08/2026)
  // e nada oficial em disco. Sem fonte confiável ⇒ null, e o catálogo
  // models.dev segue sendo a fonte (o §M1 do plano previu exatamente isso).
  "claude-code": null,
  // codex 0.147: `model/list` no canal app-server read-only, com `hidden` e
  // `upgrade` (aposentadoria anunciada pelo próprio CLI).
  codex: "codex-app-server",
  // agy 1.1.13: `agy models` imprime TSV `slug<TAB>Rótulo` no stdout.
  agy: "agy-models",
}

describe("lista viva de modelos por agent (espelho do registry Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: listsModels=${esperado}`, () => {
      expect(agentDef(id)?.listsModels).toBe(esperado)
    })
  }

  it("agent desconhecido não promete nada (fail-closed)", () => {
    expect(agentDef("gemini-inexistente")?.listsModels).toBeUndefined()
  })

  it("motor não integrado nunca declara fonte de lista", () => {
    for (const a of AGENTS.filter((x) => !x.available)) {
      expect(a.listsModels, `${a.id}: fonte declarada sem integração`).toBeNull()
    }
  })

  it("declarar fonte de lista exige ter escolha de modelo pra alimentar", () => {
    // Espelho da coerência cobrada no contrato Rust: sonda que alimenta um
    // seletor inexistente seria lista decorativa. É implicação, não
    // igualdade — o claude tem seletor e mesmo assim não tem fonte viva.
    for (const a of AGENTS) {
      if (a.listsModels != null) {
        expect(a.models.length, `${a.id}: lista viva sem seletor de modelo`).toBeGreaterThan(0)
      }
    }
  })

  it("a lista de motores sondáveis sai do registry, nunca de nome fixo", () => {
    expect(modelListingAgents().map((a) => a.id)).toEqual(["codex", "agy"])
  })
})
