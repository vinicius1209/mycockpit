// Testes da doutrina do projeto (.mycockpit/instructions.md) — o núcleo puro:
// o bloco injetado no prompt e a decisão de QUANDO injetar.

import { describe, expect, it, vi } from "vitest"
import {
  buildDoctrineBlock,
  DOCTRINE_MAX_CHARS,
  DOCTRINE_PATH,
  readDoctrine,
  shouldInjectDoctrine,
} from "./doctrine"

vi.mock("@/lib/db", () => ({ isTauri: () => false }))

describe("buildDoctrineBlock", () => {
  it("envolve o texto num bloco que aponta a fonte", () => {
    const b = buildDoctrineBlock("- Testes em pt-BR.")!
    expect(b.startsWith(`<doutrina fonte="${DOCTRINE_PATH}">`)).toBe(true)
    expect(b.endsWith("</doutrina>")).toBe(true)
    expect(b).toContain("- Testes em pt-BR.")
  })

  it("doutrina vazia ou só espaço NÃO gera bloco", () => {
    // sem isto, um arquivo criado e deixado em branco custaria tokens em todo
    // 1º turno pra dizer nada.
    expect(buildDoctrineBlock("")).toBeNull()
    expect(buildDoctrineBlock("   \n\t\n ")).toBeNull()
  })

  it("texto gigante é cortado E aponta o arquivo (o agent puxa o resto)", () => {
    const gigante = "x".repeat(DOCTRINE_MAX_CHARS + 500)
    const b = buildDoctrineBlock(gigante)!
    expect(b).toContain("[cortado em")
    expect(b).toContain(DOCTRINE_PATH)
    // o corpo cabe no teto (o bloco tem cabeçalho/rodapé além do corpo).
    expect(b.split("\n").find((l) => l.startsWith("xxx"))!.length).toBe(
      DOCTRINE_MAX_CHARS,
    )
  })

  it("texto dentro do teto não ganha aviso de corte", () => {
    expect(buildDoctrineBlock("regra curta")!).not.toContain("[cortado em")
  })
})

describe("shouldInjectDoctrine", () => {
  it("conversa nova: injeta", () => {
    expect(shouldInjectDoctrine("claude-code", false, false)).toBe(true)
    expect(shouldInjectDoctrine("codex", false, false)).toBe(true)
  })

  it("conversa em andamento com resposta: NÃO repete (o resume nativo carrega)", () => {
    expect(shouldInjectDoctrine("claude-code", true, true)).toBe(false)
    expect(shouldInjectDoctrine("codex", true, true)).toBe(false)
  })

  it("1º run morreu antes de responder: re-injeta", () => {
    // mesma exceção da persona: binário ausente derruba o 1º run e a doutrina
    // não pode ficar presa atrás do lock pra sempre.
    expect(shouldInjectDoctrine("claude-code", true, false)).toBe(true)
  })

  it("agy recebe em TODO turno (não tem resume; o recap não carrega o prefixo)", () => {
    expect(shouldInjectDoctrine("agy", true, true)).toBe(true)
    expect(shouldInjectDoctrine("agy", false, false)).toBe(true)
  })
})

describe("readDoctrine fora do Tauri", () => {
  it("degrada pra 'não existe' em vez de lançar", async () => {
    // doutrina é contexto opcional: nenhuma falha aqui pode travar um envio.
    await expect(readDoctrine("/qualquer")).resolves.toEqual({
      exists: false,
      content: "",
      bytes: 0,
    })
  })
})
