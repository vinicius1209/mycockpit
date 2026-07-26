// Testes da nota honesta do seletor de permissões: o modo é do PROJETO, mas o
// que ele faz depende do agent que roda a conversa. O bug de contrato que isso
// fecha: "Padrão" prometia "o agente pede antes de agir" em TODOS os agents,
// quando só o Claude (e agora o Codex) têm canal de aprovação.

import { describe, expect, it } from "vitest"
import { permissionNote } from "./permissionNote"

describe("permissionNote", () => {
  it("claude não precisa de nota: o contrato do seletor vale como está", () => {
    expect(permissionNote("claude-code", "padrao")).toBeNull()
    expect(permissionNote("claude-code", "leitura")).toBeNull()
    expect(permissionNote("claude-code", "liberado")).toBeNull()
  })

  it("codex no Padrão informa que o gate existe (app-server)", () => {
    const n = permissionNote("codex", "padrao")
    expect(n?.tone).toBe("info")
    expect(n?.text).toMatch(/aprovação/i)
  })

  it("agy no Padrão AVISA que o modo é ignorado (é o caso enganoso)", () => {
    const n = permissionNote("agy", "padrao")
    expect(n?.tone).toBe("warn")
    expect(n?.text).toMatch(/IGNORA/)
    // e aponta a saída que existe de verdade
    expect(n?.text).toMatch(/Planejar primeiro/)
  })

  it("agy em Leitura avisa que o confinamento é best-effort", () => {
    expect(permissionNote("agy", "leitura")?.tone).toBe("warn")
  })

  it("Liberado não gera nota: os três agents cumprem (ninguém pergunta)", () => {
    for (const a of ["claude-code", "codex", "agy"]) {
      expect(permissionNote(a, "liberado")).toBeNull()
    }
  })

  it("agent desconhecido não inventa nota", () => {
    expect(permissionNote("gemini", "padrao")).toBeNull()
  })
})
