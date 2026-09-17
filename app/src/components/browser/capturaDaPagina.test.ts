import { describe, expect, it, vi } from "vitest"
import { MAX_ATTACH_COUNT, type Attachment } from "@/lib/attachments"

const invokeMock = vi.fn()
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }))
vi.mock("@/lib/db/conversationDrafts", () => ({
  loadComposerDraft: vi.fn(async () => null),
  saveComposerDraft: vi.fn(async () => {}),
  deleteComposerDraft: vi.fn(async () => {}),
}))

import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"
import {
  anexosComCaptura,
  destinoDaMarcacao,
  linhaDaPagina,
  marcarRegiaoNoRascunho,
} from "./capturaDaPagina"

/** Resposta real do `browser_marcar` contra o Chromium do projeto (17/09/2026). */
const MARCACAO_REAL = {
  attachment: {
    path: "attachments/c-marcacao/marcacao-www-google-com.png",
    name: "marcacao-www-google-com.png",
    kind: "image" as const,
    mime: "image/png",
    bytes: 6_612,
  },
  url: "https://www.google.com/",
  title: "Google",
  regiao: { x: 425, y: 113, largura: 529, altura: 241 },
  descricao: [
    'Marquei uma região na página "Google" (https://www.google.com/), viewport 1200×762: x 425, y 113, 529×241 px.',
    "Elementos na região:",
    '- img "Google" · `#sl1XGe > div > svg`',
    "- div · `#sl1XGe`",
  ].join("\n"),
  elementos: [],
}

const anexo = (n: number): Attachment => ({
  path: `attachments/c1/${n}.png`,
  name: `${n}.png`,
  kind: "image",
  mime: "image/png",
  bytes: 10,
})

describe("captura da página no rascunho", () => {
  it("entra depois dos anexos que já estavam", () => {
    const captura = anexo(9)
    expect(anexosComCaptura([anexo(1)], captura)).toEqual({ anexos: [anexo(1), captura], coube: true })
  })

  it("a mesma captura (mesmo arquivo) não entra duas vezes", () => {
    expect(anexosComCaptura([anexo(9)], anexo(9))).toEqual({ anexos: [anexo(9)], coube: true })
  })

  it("rascunho no teto de anexos recusa em vez de cortar outro", () => {
    const cheio = Array.from({ length: MAX_ATTACH_COUNT }, (_, i) => anexo(i))
    expect(anexosComCaptura(cheio, anexo(99))).toEqual({ anexos: cheio, coube: false })
  })

  it("a linha diz de onde a imagem veio, com a URL já limpa", () => {
    expect(linhaDaPagina({ title: "Jornal de teste", url: "http://localhost:3981/" })).toBe(
      'Página "Jornal de teste" (http://localhost:3981/):',
    )
    expect(linhaDaPagina({ title: "  ", url: "https://app.exemplo.com/painel" })).toBe(
      "Página https://app.exemplo.com/painel:",
    )
  })
})

describe("destino da marcação (B3)", () => {
  it("motor que lê imagem recebe a imagem junto da descrição", () => {
    expect(destinoDaMarcacao(true, [anexo(1)], anexo(9))).toEqual({ anexos: [anexo(1), anexo(9)], aviso: null })
  })

  it("motor sem imagem recebe só a descrição, e a pessoa é avisada", () => {
    expect(destinoDaMarcacao(false, [anexo(1)], anexo(9))).toEqual({
      anexos: [anexo(1)],
      aviso: "Este motor não lê imagem: vai só a descrição da região.",
    })
  })

  it("rascunho cheio mantém os anexos e avisa", () => {
    const cheio = Array.from({ length: MAX_ATTACH_COUNT }, (_, i) => anexo(i))
    expect(destinoDaMarcacao(true, cheio, anexo(99)).aviso).toContain("vai só a descrição")
  })
})

describe("marcação no rascunho (regressão de 17/09/2026)", () => {
  it("vira pílula no rascunho, sem despejar a descrição no editor", async () => {
    const convId = "c-marcacao"
    useChat.setState({ activeId: convId, byId: { [convId]: { agent: "claude-code" } } } as never)
    useComposerDrafts.setState({ byConv: {}, loaded: {} })
    invokeMock.mockResolvedValueOnce(MARCACAO_REAL)

    const ok = await marcarRegiaoNoRascunho("/proj", "alvo", {
      x: 0, y: 0, largura: 10, altura: 10, quadroLargura: 100, quadroAltura: 100,
    })

    const rascunho = useComposerDrafts.getState().byConv[convId]
    expect(ok).toBe(true)
    expect(rascunho?.text ?? "").toBe("")
    expect(rascunho?.blocos).toEqual([
      {
        tipo: "marcacao",
        id: expect.any(String),
        pagina: "Google",
        url: "https://www.google.com/",
        largura: 529,
        altura: 241,
        descricao: MARCACAO_REAL.descricao,
      },
    ])
  })
})
