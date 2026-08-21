// O controle ÚNICO de modo, por SSR (`renderToStaticMarkup`, padrão do repo).
// O gesto de abrir e escolher mora em e2e; aqui é o repouso e o que ele conta.
//
// Substitui ComposerExecutionControls.test.tsx, que testava os dois controles
// que o M2 fundiu.

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ModeSelect } from "./ModeSelect"
import { MODOS_CURADOS } from "@/lib/agentModes"
import type { SessionMode } from "@/lib/sessionMode"

const CLAUDE = MODOS_CURADOS["claude-code"].defs

const render = (value: SessionMode, modes = CLAUDE) =>
  renderToStaticMarkup(
    createElement(ModeSelect, { modes, value, onChange: () => {} }),
  )

describe("ModeSelect", () => {
  it("o gatilho mostra o rótulo do modo em vigor", () => {
    expect(render("padrao")).toContain("Pede")
    expect(render("auto")).toContain("Auto")
  })

  it("planejar aparece como MODO no gatilho, não como toggle ao lado", () => {
    expect(render("plan")).toContain("Planejar")
  })

  it("só `Liberado` acende âmbar — o único risco autorizado", () => {
    expect(render("liberado")).toContain("st-warning")
    for (const m of ["padrao", "auto", "plan", "leitura"] as const) {
      expect(render(m), m).not.toContain("st-warning")
    }
  })

  it("sem modo curado pro motor, o controle NÃO aparece", () => {
    // Melhor nada que um seletor vazio prometendo escolha que não existe — o
    // aviso do sino é quem conta o porquê.
    expect(render("padrao", [])).toBe("")
  })

  it("modo em vigor fora da lista não quebra o gatilho", () => {
    // Acontece de verdade: o motor deixou de anunciar o modo que estava
    // valendo. O controle continua clicável em vez de sumir no meio do uso.
    const so = CLAUDE.filter((d) => d.canonico === "plan")
    expect(render("liberado", so)).toContain("Modo")
  })
})
