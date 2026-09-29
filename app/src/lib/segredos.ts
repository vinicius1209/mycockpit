// Segredos do projeto (ADR-288). O valor vai do campo direto ao Keychain pelo
// Rust e nunca volta à tela; a tela conhece só o nome e quando foi usado.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface Segredo {
  nome: string
  criadoEm: number
  usadoEm: number | null
}

/** O mesmo formato que o Rust aceita (`segredos::nome_valido`). Puro. */
export function nomeDeSegredo(nome: string): string | null {
  if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(nome)) return "Use maiúsculas, números e _, começando por letra (ex.: STRIPE_SECRET_KEY)."
  if (["PATH", "HOME", "USER", "SHELL", "PWD", "TMPDIR", "LANG", "TERM", "LOGNAME"].includes(nome) || nome.startsWith("FROTA_")) {
    return `${nome} é do sistema ou da Frota; escolha outro nome.`
  }
  return null
}

/** A linha que entra na doutrina do turno: só os nomes. Puro. */
export function linhaDosSegredos(nomes: readonly string[]): string | null {
  if (nomes.length === 0) return null
  return `Variáveis de ambiente com segredos deste projeto: ${nomes.join(", ")}. Use pelo nome (ex.: $${nomes[0]}); nunca imprima nem escreva o valor.`
}

export async function segredosDoProjeto(projectPath: string): Promise<Segredo[]> {
  if (!isTauri()) return []
  return invoke<Segredo[]>("segredos_do_projeto", { projectPath })
}

export function salvarSegredo(projectPath: string, nome: string, valor: string): Promise<Segredo[]> {
  return invoke<Segredo[]>("salvar_segredo", { projectPath, nome, valor })
}

export function apagarSegredo(projectPath: string, nome: string): Promise<Segredo[]> {
  return invoke<Segredo[]>("apagar_segredo", { projectPath, nome })
}
