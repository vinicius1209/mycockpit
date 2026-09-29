import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { HistoricoGit } from "./HistoricoGit"

vi.mock("@/lib/gitSync", () => ({
  historico: vi.fn().mockResolvedValue([
    {
      hash: "1f5933841234567890abcdef1234567890abcdef",
      curto: "1f59338",
      mensagem: "feat(olist): sincronizar estoque com o crm",
      autor: "Vinicius Machado",
      autorEmail: "vinicius@prime.com",
      quando: Date.now() - 3600000,
      naoEnviado: true,
    },
  ]),
  detalhesDoCommit: vi.fn().mockResolvedValue({
    hash: "1f5933841234567890abcdef1234567890abcdef",
    curto: "1f59338",
    mensagem: "feat(olist): sincronizar estoque com o crm",
    corpo: "Descrição longa do commit.",
    autor: "Vinicius Machado",
    autorEmail: "vinicius@prime.com",
    quando: Date.now() - 3600000,
    pais: ["0a47eba"],
    arquivos: [
      {
        caminho: "src/lib/stockSync.ts",
        caminhoAntigo: null,
        status: "modified",
        additions: 20,
        deletions: 5,
        binario: false,
      },
    ],
    totalAdditions: 20,
    totalDeletions: 5,
  }),
  desfazerUltimoCommit: vi.fn().mockResolvedValue(undefined),
  comoErroDeGit: (e: unknown) => ({ tipo: "outro", detalhe: String(e) }),
  quandoDaBranch: () => "hoje",
  remoteUrl: vi.fn().mockResolvedValue("https://github.com/vinicius1209/frota.git"),
  urlDoCommitNaWeb: (url: string | null, hash: string) =>
    url ? `https://github.com/vinicius1209/frota/commit/${hash}` : null,
}))

vi.mock("@/lib/clipboard", () => ({
  copyText: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/avisos", () => ({
  avisar: { feito: vi.fn(), erro: vi.fn() },
}))

vi.mock("@/lib/confirm", () => ({
  confirm: vi.fn().mockResolvedValue(true),
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}))

describe("HistoricoGit", () => {
  it("renderiza a seção fechada por padrão com o título", () => {
    const html = renderToStaticMarkup(
      createElement(HistoricoGit, {
        cwd: "/projeto/teste",
        versao: "main:0:0:0",
      }),
    )
    expect(html).toContain("Histórico")
  })
})
