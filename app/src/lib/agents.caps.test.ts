// Matriz de capacidade por agent — o espelho TS do `supports_attachment` do
// trait Rust (app/src-tauri/src/adapters.rs).
//
// POR QUE ESTE TESTE EXISTE: a capacidade de anexo mora em DOIS lugares. O gate
// real é o Rust (decide o que o agent recebe); o espelho TS existe porque a UI
// valida ANTES do envio (chip vermelho, bloqueio). Ligar só um lado dá um dos
// dois estragos:
//   - só Rust  ⇒ o backend aceitaria, mas o front bloqueia (aconteceu com o agy);
//   - só TS    ⇒ pior: o chip promete e o anexo é DESCARTADO no spawn, calado.
// O teste gêmeo no Rust (`matriz_de_anexo_por_agent`) afirma a MESMA matriz.
// Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { DESTINATIONS, agentCaps, agentEfforts, agentModels } from "./agents"

/** A matriz, escrita UMA vez. O teste Rust repete estes mesmos valores. */
const MATRIZ: Record<string, { image: boolean; pdf: boolean }> = {
  "claude-code": { image: true, pdf: true },
  // Codex: `-i` só aceita PNG/JPEG/GIF/WebP (detecção por magic bytes). PDF em
  // `-i` NÃO dá erro — exit 0, e o arquivo vira o literal "image content" no
  // rollout. O bloqueio é NOSSO, e é o que impede o usuário de achar que enviou.
  codex: { image: true, pdf: false },
  // agy: lê os dois via `view_file` (ponteiro + --add-dir). Melhor esforço.
  agy: { image: true, pdf: true },
}

describe("capacidade de anexo (espelho do trait Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: imagem=${esperado.image} pdf=${esperado.pdf}`, () => {
      expect(agentCaps(id)).toEqual(esperado)
    })
  }

  it("agent desconhecido nega tudo (fail-closed, nunca promete o que não sabe)", () => {
    expect(agentCaps("gemini-inexistente")).toEqual({ image: false, pdf: false })
  })

  it("PDF no Codex segue bloqueado — ele falha em SILÊNCIO se deixarmos passar", () => {
    // regressão de intenção: se alguém "liberar" PDF no codex achando que só
    // faltava permitir, este teste explica por que não.
    expect(agentCaps("codex").pdf).toBe(false)
  })
})

describe("eixo de esforço por agent", () => {
  it("agy não tem eixo de esforço (vem embutido no id do modelo)", () => {
    // é o dado por trás da guarda no composer: sem isto, o RichSelect
    // renderizava uma pílula VAZIA no meio da linha de identidade.
    expect(agentEfforts("agy")).toEqual([])
    // e o modelo dele carrega o nível: "…-flash-low", "…-flash-high"
    const ids = agentModels("agy").map((m) => m.value)
    expect(ids.some((v) => /low|high|medium/i.test(v))).toBe(true)
  })

  it("claude e codex têm eixo de esforço (o seletor deve aparecer)", () => {
    expect(agentEfforts("claude-code").length).toBeGreaterThan(0)
    expect(agentEfforts("codex").length).toBeGreaterThan(0)
  })

  it("todo destino do tipo agent está na matriz (agent novo não passa batido)", () => {
    const agents = DESTINATIONS.filter((d) => d.kind === "agent").map((d) => d.id)
    for (const id of agents) {
      if (!(id in MATRIZ)) {
        // agent novo sem decisão explícita de anexo: o default do trait Rust é
        // negar, então o esperado aqui também é negar.
        expect(agentCaps(id)).toEqual({ image: false, pdf: false })
      }
    }
  })
})
