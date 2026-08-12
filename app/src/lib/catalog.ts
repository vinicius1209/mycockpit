// Camada A da inteligência de modelos: wiring do catálogo dinâmico de preços
// (models.dev, snapshot local mantido pelo Rust). O front só dispara o refresh
// (best-effort: rede falhou = silêncio, o snapshot anterior segue valendo) e lê
// o snapshot. O backend resolve o app_data_dir sozinho — invokes sem argumento.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { useApp } from "@/store/app"

/** Espelha CatalogModel do Rust (snake_case). Preços em US$/1M tokens. */
export interface CatalogModel {
  provider: string
  id: string
  name: string
  input: number | null
  output: number | null
  cache_read: number | null
  context: number | null
  release_date: string | null
}

/** Baixa/atualiza o snapshot do catálogo (rede). null = falhou (best-effort). */
export async function refreshModelsCatalog(): Promise<number | null> {
  if (!isTauri()) return null
  try {
    const n = await invoke<number>("refresh_models_catalog")
    return typeof n === "number" ? n : null
  } catch {
    return null
  }
}

/** Snapshot local do catálogo. [] = indisponível/sem snapshot (nunca lança). */
export async function getModelsCatalog(): Promise<CatalogModel[]> {
  if (!isTauri()) return []
  try {
    const rows = await invoke<CatalogModel[]>("get_models_catalog")
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}

/** Refresh + registro em GlobalSettings (lastCatalogRefresh + catalogCount).
 *  Falha NÃO zera o que já foi registrado; devolve `false` pra quem pediu por
 *  gesto poder dizer que não deu (o boot chama em void, best-effort). */
export async function refreshCatalogIntoSettings(): Promise<boolean> {
  const n = await refreshModelsCatalog()
  if (n === null) return false
  useApp
    .getState()
    .setSettings({ lastCatalogRefresh: Date.now(), catalogCount: n })
  return true
}
