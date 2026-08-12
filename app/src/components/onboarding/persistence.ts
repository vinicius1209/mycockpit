// I/O do registro de onboarding. Fica SEPARADO de flow.ts (que é puro) e de
// GlobalSettings (que é preferência do usuário, não progresso de fluxo).
//
// Chave própria no localStorage, do mesmo jeito que `mc.app`: o webview do
// Tauri persiste em disco entre reinícios. Grava e lê devolvendo SUCESSO — o
// chamador precisa saber que falhou pra destravar o latch de fechamento
// (ADR-017: nada de catch silencioso onde alguém espera resultado).

import { parseRecord, type OnboardingRecord } from "./flow"

export const STORAGE_KEY = "mc.onboarding"

/** Lê o registro. null = nunca gravou, storage indisponível ou conteúdo fora do
 *  shape (todos significam a mesma coisa pro fluxo: começa do zero). */
export function readRecord(): OnboardingRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return parseRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Grava o registro. false = NÃO gravou (storage cheio, modo privado, JSON
 *  impossível). O chamador reage; aqui não se engole falha. */
export function writeRecord(record: OnboardingRecord): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

/** Apaga o registro (usado pelo "Refazer onboarding"): sem isso o wizard
 *  reaberto retomaria no último passo concluído em vez de começar. */
export function clearRecord(): boolean {
  try {
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
