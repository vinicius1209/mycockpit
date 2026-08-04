// Matriz de comandos "/" por agent — o espelho TS das capabilities
// `native_slash`/`command_sources` do Rust (app/src-tauri/src/adapters.rs).
//
// POR QUE ESTE TESTE EXISTE (mesma disciplina do agents.caps.test.ts): a
// capability mora em DOIS lugares. O Rust declara a VERDADE auditada do CLI
// (CLAUDE_CAPS/CODEX_CAPS/AGY_CAPS); o espelho TS (AgentDef.nativeSlash/
// nativeCommandSource) é o que a expansão app-side e o popover "/" consultam.
// Divergir estraga dos dois lados:
//   - só Rust  ⇒ o front expande o que podia viajar cru (perde frontmatter rico);
//   - só TS    ⇒ pior: o front manda /nome cru pra um motor que ignora — a
//     barra morta que a fase dos comandos "/" existiu pra matar.
// O teste gêmeo no Rust (`matriz_native_slash_e_fontes_por_agent`) afirma a
// MESMA matriz sobre as capabilities declaradas. Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { agentDef, DESTINATIONS } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores
 *  (nativeCommandSource "claude" ↔ CommandSource::ClaudeDirs, "codex" ↔
 *  CommandSource::CodexPrompts, null ↔ lista vazia). */
const MATRIZ: Record<
  string,
  { nativeSlash: boolean; nativeCommandSource: string | null }
> = {
  // claude 2.1.219: `claude -p "/cmd"` interpreta nativamente → fonte própria
  // viaja crua e preserva frontmatter rico.
  "claude-code": { nativeSlash: true, nativeCommandSource: "claude" },
  // codex-cli 0.144.6: `exec` NÃO interpreta /prompt (a expansão é nossa),
  // mas a convenção ~/.codex/prompts existe e entra no inventário do "/".
  codex: { nativeSlash: false, nativeCommandSource: "codex" },
  // agy 1.1.9: sem slash nativo e sem convenção própria (só a casa).
  agy: { nativeSlash: false, nativeCommandSource: null },
}

describe("comandos \"/\" por agent (espelho das capabilities do Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: nativeSlash=${esperado.nativeSlash} fonte=${esperado.nativeCommandSource ?? "nenhuma"}`, () => {
      const def = agentDef(id)
      expect(def, `${id} precisa existir no registry`).toBeTruthy()
      expect(def?.nativeSlash).toBe(esperado.nativeSlash)
      expect(def?.nativeCommandSource).toBe(esperado.nativeCommandSource)
    })
  }

  it("nativeSlash exige fonte própria (cru sem inventário nativo não faz sentido)", () => {
    for (const [id, m] of Object.entries(MATRIZ)) {
      if (m.nativeSlash) {
        expect(m.nativeCommandSource, `${id} nativo sem fonte`).not.toBeNull()
      }
    }
  })

  it("todo destino do tipo agent está na matriz (agent novo não passa batido)", () => {
    const agents = DESTINATIONS.filter((d) => d.kind === "agent").map((d) => d.id)
    for (const id of agents) {
      if (!(id in MATRIZ)) {
        // agent novo sem decisão explícita: o default honesto é NÃO prometer
        // slash nativo (expande app-side) e não inventar convenção de fonte.
        expect(agentDef(id)?.nativeSlash).toBe(false)
        expect(agentDef(id)?.nativeCommandSource).toBeNull()
      }
    }
  })
})
