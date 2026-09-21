import { describe, expect, it } from "vitest"

import { CHAVE_APP, CHAVE_APP_LEGADA, migrarChaveDoApp } from "@/lib/chaveDoApp"

/** Storage de mentira, só com o que a migração usa. */
function storage(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial))
  return {
    dados,
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
  }
}

/** Formato REAL do zustand persist v5 deste app (store/app.ts). */
const SALVO = JSON.stringify({ state: { theme: "light", themePreference: "manual" }, version: 5 })

describe("migração da chave do app", () => {
  it("copia o estado legado quando a chave nova não existe", () => {
    const s = storage({ [CHAVE_APP_LEGADA]: SALVO })
    migrarChaveDoApp(s)
    expect(s.getItem(CHAVE_APP)).toBe(SALVO)
  })

  it("COPIA, não move: a chave antiga fica para o rollback", () => {
    const s = storage({ [CHAVE_APP_LEGADA]: SALVO })
    migrarChaveDoApp(s)
    expect(s.getItem(CHAVE_APP_LEGADA)).toBe(SALVO)
  })

  it("não sobrescreve a chave nova se ela já existe", () => {
    const novo = JSON.stringify({ state: { theme: "dark" }, version: 5 })
    const s = storage({ [CHAVE_APP]: novo, [CHAVE_APP_LEGADA]: SALVO })
    migrarChaveDoApp(s)
    expect(s.getItem(CHAVE_APP)).toBe(novo)
  })

  it("instalação nova, sem nada salvo, não cria chave", () => {
    const s = storage()
    migrarChaveDoApp(s)
    expect(s.getItem(CHAVE_APP)).toBeNull()
  })

  it("é idempotente: rodar duas vezes não muda nada", () => {
    const s = storage({ [CHAVE_APP_LEGADA]: SALVO })
    migrarChaveDoApp(s)
    migrarChaveDoApp(s)
    expect(s.dados.size).toBe(2)
    expect(s.getItem(CHAVE_APP)).toBe(SALVO)
  })

  it("storage que explode não derruba o boot", () => {
    const quebrado = {
      getItem: () => {
        throw new Error("modo privado")
      },
      setItem: () => {},
    }
    expect(() => migrarChaveDoApp(quebrado)).not.toThrow()
  })
})
