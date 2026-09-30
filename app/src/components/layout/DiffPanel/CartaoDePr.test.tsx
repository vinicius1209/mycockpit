import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { CartaoDePr } from "./CartaoDePr"
import type { PrStatusInfo } from "@/lib/github"

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}))

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn(),
}))

vi.mock("@/lib/avisos", () => ({
  avisar: {
    feito: vi.fn(),
    erro: vi.fn(),
  },
  mensagemDe: (e: unknown) => String(e),
}))

vi.mock("@/lib/sinaisDoDisco", () => ({
  haTurnoNaPasta: () => false,
  avisarGravacao: vi.fn(),
}))

vi.mock("@/lib/gitSync", () => ({
  trocarBranch: vi.fn().mockResolvedValue(undefined),
}))

describe("CartaoDePr", () => {
  it("sem PR na branch renderiza botão padrão de abrir pull request", () => {
    const html = renderToStaticMarkup(
      createElement(CartaoDePr, {
        cwd: "/projeto",
        branch: "main",
        pr: null,
        prUrl: null,
        onAbrirComposer: vi.fn(),
        onLimparPrUrl: vi.fn(),
        onBranchTrocada: vi.fn(),
      }),
    )
    expect(html).toContain("Abrir pull request")
  })

  it("com PR aberto renderiza número, título e base ref", () => {
    const pr: PrStatusInfo = {
      number: 467,
      title: "fix: fallback para marcas sem id no catálogo Olist",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/org/repo/pull/467",
      baseRefName: "develop",
      headRefName: "fix/olist-fallback",
      reviewDecision: "APPROVED",
      checksPassing: 4,
      checksFailing: 0,
      checksPending: 0,
    }
    const html = renderToStaticMarkup(
      createElement(CartaoDePr, {
        cwd: "/projeto",
        branch: "fix/olist-fallback",
        pr,
        prUrl: null,
        onAbrirComposer: vi.fn(),
        onLimparPrUrl: vi.fn(),
        onBranchTrocada: vi.fn(),
      }),
    )
    expect(html).toContain("PR #467 · Aberto")
    expect(html).toContain("fix: fallback para marcas sem id")
    expect(html).toContain("4 checks ok")
    expect(html).toContain("Aprovado")
    expect(html).toContain("develop")
  })

  it("com PR mergeado avisa incorporação e botão para voltar à base", () => {
    const pr: PrStatusInfo = {
      number: 462,
      title: "feat: exportação consolidada de CSV",
      state: "MERGED",
      isDraft: false,
      url: "https://github.com/org/repo/pull/462",
      baseRefName: "main",
      headRefName: "feat/csv",
      reviewDecision: null,
      checksPassing: 2,
      checksFailing: 0,
      checksPending: 0,
    }
    const html = renderToStaticMarkup(
      createElement(CartaoDePr, {
        cwd: "/projeto",
        branch: "feat/csv",
        pr,
        prUrl: null,
        onAbrirComposer: vi.fn(),
        onLimparPrUrl: vi.fn(),
        onBranchTrocada: vi.fn(),
      }),
    )
    expect(html).toContain("PR #462 · Mergeado")
    expect(html).toContain("Esta branch foi incorporada em")
    expect(html).toContain("Voltar para main")
  })

  it("com check falhando destaca o número de falhas", () => {
    const pr: PrStatusInfo = {
      number: 470,
      title: "fix: taxa",
      state: "OPEN",
      isDraft: false,
      url: "https://github.com/org/repo/pull/470",
      baseRefName: "main",
      headRefName: "fix/taxa",
      reviewDecision: "CHANGES_REQUESTED",
      checksPassing: 1,
      checksFailing: 1,
      checksPending: 0,
    }
    const html = renderToStaticMarkup(
      createElement(CartaoDePr, {
        cwd: "/projeto",
        branch: "fix/taxa",
        pr,
        prUrl: null,
        onAbrirComposer: vi.fn(),
        onLimparPrUrl: vi.fn(),
        onBranchTrocada: vi.fn(),
      }),
    )
    expect(html).toContain("1 check falhou")
    expect(html).toContain("Alterações pedidas")
  })
})
